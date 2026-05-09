#!/usr/bin/env node
/**
 * scripts/backfill-card-fight-stats.js
 *
 * Backfill fight_stats + round_stats for every prior UFC bout (in our DB)
 * involving a fighter on tonight's card (event 103) where has_stats=0 and
 * ufcstats_hash is set. ~184 fights at 1s/scrape ≈ 3 min.
 *
 * Why: prediction features use per-fight stat aggregations from fight_stats.
 * Several card fighters (Stephens, Álvarez, Rębecki, Amosov, Gomis, Buckley)
 * had 0-2 stat rows so career averages collapsed to 0 and skewed predictions.
 *
 * Idempotent: ON CONFLICT DO UPDATE on both tables; skips rows that already
 * have has_stats=1.
 *
 * --dry-run by default; --apply to write.
 */
const { Pool } = require('pg');
const { fetchFight } = require('../data/scrapers/ufcstats-fight');

const APPLY = process.argv.includes('--apply');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function nameKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

async function upsertFightStatsRow(pool, s) {
  await pool.query(
    `INSERT INTO fight_stats
       (fight_id,fighter_id,sig_str_landed,sig_str_attempted,total_str_landed,total_str_attempted,takedowns_landed,takedowns_attempted,knockdowns,sub_attempts,control_time_sec,head_landed,body_landed,leg_landed,distance_landed,clinch_landed,ground_landed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (fight_id, fighter_id) DO UPDATE SET
       sig_str_landed=EXCLUDED.sig_str_landed, sig_str_attempted=EXCLUDED.sig_str_attempted,
       total_str_landed=EXCLUDED.total_str_landed, total_str_attempted=EXCLUDED.total_str_attempted,
       takedowns_landed=EXCLUDED.takedowns_landed, takedowns_attempted=EXCLUDED.takedowns_attempted,
       knockdowns=EXCLUDED.knockdowns, sub_attempts=EXCLUDED.sub_attempts, control_time_sec=EXCLUDED.control_time_sec`,
    [
      s.fight_id, s.fighter_id, s.sig_str_landed||0, s.sig_str_attempted||0,
      s.total_str_landed||0, s.total_str_attempted||0, s.takedowns_landed||0,
      s.takedowns_attempted||0, s.knockdowns||0, s.sub_attempts||0, s.control_time_sec||0,
      0, 0, 0, 0, 0, 0
    ]
  );
}

async function upsertRoundStatsRow(pool, fight_id, fighter_id, rs) {
  await pool.query(
    `INSERT INTO round_stats
       (fight_id,fighter_id,round,kd,sig_str_landed,sig_str_attempted,total_str_landed,total_str_attempted,td_landed,td_attempted,sub_att,reversal,ctrl_sec,head_landed,head_attempted,body_landed,body_attempted,leg_landed,leg_attempted,distance_landed,distance_attempted,clinch_landed,clinch_attempted,ground_landed,ground_attempted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
     ON CONFLICT (fight_id, fighter_id, round) DO UPDATE SET
       kd=EXCLUDED.kd, sig_str_landed=EXCLUDED.sig_str_landed, sig_str_attempted=EXCLUDED.sig_str_attempted,
       total_str_landed=EXCLUDED.total_str_landed, total_str_attempted=EXCLUDED.total_str_attempted,
       td_landed=EXCLUDED.td_landed, td_attempted=EXCLUDED.td_attempted, sub_att=EXCLUDED.sub_att,
       reversal=EXCLUDED.reversal, ctrl_sec=EXCLUDED.ctrl_sec,
       head_landed=EXCLUDED.head_landed, head_attempted=EXCLUDED.head_attempted,
       body_landed=EXCLUDED.body_landed, body_attempted=EXCLUDED.body_attempted,
       leg_landed=EXCLUDED.leg_landed, leg_attempted=EXCLUDED.leg_attempted,
       distance_landed=EXCLUDED.distance_landed, distance_attempted=EXCLUDED.distance_attempted,
       clinch_landed=EXCLUDED.clinch_landed, clinch_attempted=EXCLUDED.clinch_attempted,
       ground_landed=EXCLUDED.ground_landed, ground_attempted=EXCLUDED.ground_attempted`,
    [
      fight_id, fighter_id, rs.round, rs.kd||0,
      rs.sig_str_landed||0, rs.sig_str_attempted||0,
      rs.total_str_landed||0, rs.total_str_attempted||0,
      rs.td_landed||0, rs.td_attempted||0, rs.sub_att||0, rs.reversal||0, rs.ctrl_sec||0,
      rs.head_landed||0, rs.head_attempted||0,
      rs.body_landed||0, rs.body_attempted||0,
      rs.leg_landed||0, rs.leg_attempted||0,
      rs.distance_landed||0, rs.distance_attempted||0,
      rs.clinch_landed||0, rs.clinch_attempted||0,
      rs.ground_landed||0, rs.ground_attempted||0
    ]
  );
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  let scraped = 0, ingested = 0, fsRows = 0, rsRows = 0, failed = 0;
  try {
    const targets = (await pool.query(`
      WITH card AS (
        SELECT DISTINCT f.id FROM fighters f
        JOIN fights fight ON (fight.red_fighter_id=f.id OR fight.blue_fighter_id=f.id)
        WHERE fight.event_id=103
      )
      SELECT DISTINCT fi.id, fi.event_id, fi.red_fighter_id, fi.blue_fighter_id,
             fi.red_name, fi.blue_name, fi.ufcstats_hash
        FROM fights fi
       WHERE fi.has_stats = 0
         AND fi.ufcstats_hash IS NOT NULL
         AND (fi.red_fighter_id IN (SELECT id FROM card)
              OR fi.blue_fighter_id IN (SELECT id FROM card))
       ORDER BY fi.event_id DESC, fi.id DESC
    `)).rows;

    console.log(`Targets: ${targets.length} prior bouts to scrape (${APPLY ? 'APPLY' : 'DRY-RUN'})\n`);

    for (let i = 0; i < targets.length; i++) {
      const f = targets[i];
      try {
        const detail = await fetchFight(f.ufcstats_hash);
        scraped++;

        // Map scraped sides to local fighter ids by name match.
        const sideToId = {};
        for (let s = 0; s < detail.fighters.length; s++) {
          const fname = nameKey(detail.fighters[s].name);
          if (fname === nameKey(f.red_name)) sideToId[s] = f.red_fighter_id;
          else if (fname === nameKey(f.blue_name)) sideToId[s] = f.blue_fighter_id;
        }
        if (sideToId[0] == null) sideToId[0] = f.red_fighter_id;
        if (sideToId[1] == null) sideToId[1] = f.blue_fighter_id;

        const fsList = (detail.fight_stats || []).map(fs => ({
          fight_id: f.id,
          fighter_id: sideToId[fs.fighter_idx],
          ...fs,
        })).filter(x => x.fighter_id != null);

        if (APPLY) {
          for (const fs of fsList) {
            await upsertFightStatsRow(pool, fs);
            fsRows++;
          }
          for (const rs of (detail.round_stats || [])) {
            const fid = sideToId[rs.fighter_idx];
            if (fid == null) continue;
            await upsertRoundStatsRow(pool, f.id, fid, rs);
            rsRows++;
          }
          await pool.query(`UPDATE fights SET has_stats = 1 WHERE id = $1`, [f.id]);
          ingested++;
        }

        if ((i+1) % 20 === 0 || i === targets.length-1) {
          console.log(`  [${i+1}/${targets.length}] ${f.red_name} vs ${f.blue_name} (event ${f.event_id}) — scraped ok`);
        }
      } catch (e) {
        failed++;
        console.log(`  [${i+1}/${targets.length}] FAILED ${f.red_name} vs ${f.blue_name}: ${e.message}`);
      }
      await sleep(1000);
    }

    console.log(`\nDone. scraped=${scraped} failed=${failed}` +
                (APPLY ? ` ingested_fights=${ingested} fight_stats_rows=${fsRows} round_stats_rows=${rsRows}` : ''));
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
