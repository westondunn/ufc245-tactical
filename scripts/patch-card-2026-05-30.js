#!/usr/bin/env node
/**
 * scripts/patch-card-2026-05-30.js
 *
 * One-shot patch for late card movement on UFC Fight Night:
 * Song Yadong vs Deiveson Figueiredo (event 105, Galaxy Arena Macao,
 * 2026-05-30). Idempotent — safe to re-run; prints what it would do
 * (and skips) when a change is already applied. All writes run in one
 * transaction: any abort mid-run rolls back cleanly.
 *
 * Uses a direct pg Pool so it does not invoke ensureSchema() over the
 * remote connection (that pass is slow against Railway's public host).
 *
 * Changes (vs ufcstats.com / ufc.com on the morning of the event):
 *   1. Fight 794 (Welterweight): red 673 (Muslim Salikhov) →
 *      red 877 (Carlston Harris). Stale-mark predictions vs Salikhov
 *      and neutralize pick-model snapshots on the fight.
 *   2. Fight 799 (Flyweight → Bantamweight): blue 418 (Jesus Aguilar)
 *      → blue 669 (Luis Gurule); weight_class moves up to Bantamweight.
 *      Stale-mark predictions vs Aguilar and neutralize snapshots.
 *   3. New fighters: Ding Meng (Welterweight), José Souza
 *      (Welterweight), Zhu Kangjie (Featherweight), Rodrigo Vera
 *      (Featherweight). (Carlston Harris and Luis Gurule already
 *      exist in the fighters table.)
 *   4. New fights inserted on event 105:
 *      - Ding Meng vs José Souza (Welterweight, card_position 8)
 *      - Zhu Kangjie vs Rodrigo Vera (Featherweight, card_position 12)
 *   5. Card-position renumber to match the live ufc.com ordering:
 *        790  Song vs Figueiredo            1   (was 1) — unchanged
 *        791  Zhang vs Menifield            2   (was 2) — unchanged
 *        792  Pavlovich vs Teixeira         3   (was 3) — unchanged
 *        793  Asakura vs Smotherman         4   (was 4) — unchanged
 *        794  Matthews vs Harris            5   (was 5) — unchanged
 *        796  Perez vs Sumudaerji           6   (was 7)
 *        798  Lee vs Dias                   7   (was 9)
 *        NEW  Meng vs Souza                 8   (insert)
 *        800  Aoriqileng vs Haddon          9   (was 11)
 *        799  Tsuruya vs Gurule            10   (was 10) — unchanged
 *        795  Hill vs Xiong                11   (was 6)
 *        NEW  Zhu vs Vera                  12   (insert)
 *        797  Lookboonmee vs Amorim        13   (was 8)
 *
 * New fighter/fight ids are pinned to the values hardcoded in
 * data/seed.json (fighters 2704-2707, fights 8810-8811) so prod and
 * fresh-seeded databases agree on which id names which row. The script
 * aborts (before writing, thanks to the transaction) if a pinned id is
 * already taken by a different row — that means the prod id-space has
 * drifted from seed and must be reconciled by hand first.
 *
 * Run:
 *   $env:DATABASE_URL = (...DATABASE_PUBLIC_URL...)
 *   node scripts/patch-card-2026-05-30.js --dry-run
 *   node scripts/patch-card-2026-05-30.js
 *   (PGSSLMODE=disable is honored for non-SSL targets, e.g. local rehearsal.)
 *
 * Required follow-ups after apply (also printed on success):
 *   1. node scripts/void-orphaned-picks.js --event 105
 *   2. POST /api/admin/save on the main app — its cache has no TTL, so a
 *      running server keeps serving the old card from memory until then.
 *   3. POST /admin/predict-event?event_id=105 on the predictions service —
 *      scheduled jobs skip event-day cards, so nothing else re-predicts.
 */
const { getPool } = require('./_db');

const EVENT_ID = 105;

// ── Fighter swaps (existing rows in fighters table) ──
const MATTHEWS_FIGHT_ID = 794;
const SALIKHOV_ID  = 673;   // out
const HARRIS_ID    = 877;   // in

const TSURUYA_FIGHT_ID = 799;
const AGUILAR_ID   = 418;   // out
const GURULE_ID    = 669;   // in
const TSURUYA_NEW_WC = 'Bantamweight'; // moves up from Flyweight

// ── New fighters to ensure exist (ids pinned to data/seed.json) ──
const NEW_FIGHTERS = [
  { id: 2704, name: 'Ding Meng',    weight_class: 'Welterweight' },
  { id: 2705, name: 'José Souza',   weight_class: 'Welterweight' },
  { id: 2706, name: 'Zhu Kangjie',  weight_class: 'Featherweight' },
  { id: 2707, name: 'Rodrigo Vera', weight_class: 'Featherweight' },
];

// ── New fight insertions, after fighter rows exist (ids pinned to data/seed.json) ──
const NEW_FIGHTS = [
  { id: 8810, red_name: 'Ding Meng',   blue_name: 'José Souza',   weight_class: 'Welterweight',  card_position: 8  },
  { id: 8811, red_name: 'Zhu Kangjie', blue_name: 'Rodrigo Vera', weight_class: 'Featherweight', card_position: 12 },
];

// ── Card-position renumber for existing fights (id → new position) ──
const POSITION_MAP = {
  790: 1,
  791: 2,
  792: 3,
  793: 4,
  794: 5,
  796: 6,
  798: 7,
  800: 9,
  799: 10,
  795: 11,
  797: 13,
};

const DRY = process.argv.includes('--dry-run');
const log = (...a) => console.log(DRY ? '[dry-run]' : '[apply]', ...a);
const fail = (code, msg) => { const e = new Error(msg); e.exitCode = code; throw e; };
const stripAccents = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

async function main() {
  const pool = getPool();
  const client = await pool.connect();

  const q = (sql, params = []) => client.query(sql, params);
  const oneRow = async (sql, params) => (await q(sql, params)).rows[0] || null;
  const allRows = async (sql, params) => (await q(sql, params)).rows;

  // Locked picks on a swapped fight keep model-agreement snapshots taken
  // against the pre-swap prediction; neutralize them so modelUpsetBonus
  // can't score agreement with a matchup that never happened.
  const neutralizeSnapshots = async (fightId) => {
    const n = await oneRow(
      `SELECT COUNT(*)::int AS c FROM pick_model_snapshots
       WHERE user_agreed_with_model IS NOT NULL
         AND user_pick_id IN (SELECT id FROM user_picks WHERE fight_id = $1)`,
      [fightId]
    );
    if (!Number(n.c)) { log(`no pick-model snapshots to neutralize on fight ${fightId}`); return; }
    log(`neutralizing ${n.c} pick-model snapshot(s) on fight ${fightId} (agreement was vs the pre-swap prediction)`);
    if (!DRY) {
      await q(
        `UPDATE pick_model_snapshots SET user_agreed_with_model = NULL
         WHERE user_agreed_with_model IS NOT NULL
           AND user_pick_id IN (SELECT id FROM user_picks WHERE fight_id = $1)`,
        [fightId]
      );
    }
  };

  try {
    if (!DRY) await q('BEGIN');

    // ── 1. Matthews fight: Salikhov → Harris (red corner) ──
    const f794 = await oneRow(
      `SELECT id, red_fighter_id, blue_fighter_id, red_name, blue_name FROM fights WHERE id = $1`,
      [MATTHEWS_FIGHT_ID]
    );
    if (!f794) fail(3, `fight ${MATTHEWS_FIGHT_ID} not found`);

    if (f794.red_fighter_id === HARRIS_ID) {
      log(`fight ${MATTHEWS_FIGHT_ID} already has Harris as red — skipping`);
    } else if (f794.red_fighter_id !== SALIKHOV_ID) {
      fail(4, `fight ${MATTHEWS_FIGHT_ID} red_fighter_id is ${f794.red_fighter_id}, expected ${SALIKHOV_ID} (Salikhov). Aborting to avoid clobbering an unknown change (transaction rolled back).`);
    } else {
      log(`fight ${MATTHEWS_FIGHT_ID}: red ${f794.red_name} (id ${f794.red_fighter_id}) → Carlston Harris (id ${HARRIS_ID})`);
      if (!DRY) {
        await q(
          `UPDATE fights SET red_fighter_id = $1, red_name = 'Carlston Harris'
           WHERE id = $2 AND red_fighter_id = $3`,
          [HARRIS_ID, MATTHEWS_FIGHT_ID, SALIKHOV_ID]
        );
      }
    }

    const stale794 = await allRows(
      `SELECT id, model_version FROM predictions
       WHERE fight_id = $1 AND (red_fighter_id = $2 OR blue_fighter_id = $2) AND is_stale = 0`,
      [MATTHEWS_FIGHT_ID, SALIKHOV_ID]
    );
    if (stale794.length === 0) {
      log('no live predictions vs Salikhov to stale-mark');
    } else {
      log(`stale-marking ${stale794.length} prediction(s) vs Salikhov:`, stale794.map(p => p.id).join(', '));
      if (!DRY) {
        await q(
          `UPDATE predictions SET is_stale = 1
           WHERE fight_id = $1 AND (red_fighter_id = $2 OR blue_fighter_id = $2)`,
          [MATTHEWS_FIGHT_ID, SALIKHOV_ID]
        );
      }
    }

    await neutralizeSnapshots(MATTHEWS_FIGHT_ID);

    // ── 2. Tsuruya fight: Aguilar → Gurule (blue corner) + weight class change ──
    const f799 = await oneRow(
      `SELECT id, red_fighter_id, blue_fighter_id, red_name, blue_name, weight_class FROM fights WHERE id = $1`,
      [TSURUYA_FIGHT_ID]
    );
    if (!f799) fail(3, `fight ${TSURUYA_FIGHT_ID} not found`);

    if (f799.blue_fighter_id === GURULE_ID) {
      log(`fight ${TSURUYA_FIGHT_ID} already has Gurule as blue — skipping fighter swap`);
    } else if (f799.blue_fighter_id !== AGUILAR_ID) {
      fail(4, `fight ${TSURUYA_FIGHT_ID} blue_fighter_id is ${f799.blue_fighter_id}, expected ${AGUILAR_ID} (Aguilar). Aborting to avoid clobbering an unknown change (transaction rolled back).`);
    } else {
      log(`fight ${TSURUYA_FIGHT_ID}: blue ${f799.blue_name} (id ${f799.blue_fighter_id}) → Luis Gurule (id ${GURULE_ID})`);
      if (!DRY) {
        await q(
          `UPDATE fights SET blue_fighter_id = $1, blue_name = 'Luis Gurule'
           WHERE id = $2 AND blue_fighter_id = $3`,
          [GURULE_ID, TSURUYA_FIGHT_ID, AGUILAR_ID]
        );
      }
    }

    if (f799.weight_class === TSURUYA_NEW_WC) {
      log(`fight ${TSURUYA_FIGHT_ID} weight_class already ${TSURUYA_NEW_WC} — skipping wc change`);
    } else {
      log(`fight ${TSURUYA_FIGHT_ID}: weight_class ${JSON.stringify(f799.weight_class)} → ${JSON.stringify(TSURUYA_NEW_WC)}`);
      if (!DRY) {
        await q(
          `UPDATE fights SET weight_class = $1 WHERE id = $2`,
          [TSURUYA_NEW_WC, TSURUYA_FIGHT_ID]
        );
      }
    }

    const stale799 = await allRows(
      `SELECT id, model_version FROM predictions
       WHERE fight_id = $1 AND (red_fighter_id = $2 OR blue_fighter_id = $2) AND is_stale = 0`,
      [TSURUYA_FIGHT_ID, AGUILAR_ID]
    );
    if (stale799.length === 0) {
      log('no live predictions vs Aguilar to stale-mark');
    } else {
      log(`stale-marking ${stale799.length} prediction(s) vs Aguilar:`, stale799.map(p => p.id).join(', '));
      if (!DRY) {
        await q(
          `UPDATE predictions SET is_stale = 1
           WHERE fight_id = $1 AND (red_fighter_id = $2 OR blue_fighter_id = $2)`,
          [TSURUYA_FIGHT_ID, AGUILAR_ID]
        );
      }
    }

    await neutralizeSnapshots(TSURUYA_FIGHT_ID);

    // ── 3. Ensure new fighter rows exist (ids pinned to seed.json) ──
    const fighterIdByName = {};
    for (const nf of NEW_FIGHTERS) {
      // Accent/case-insensitive lookup: scrapers store names as scraped
      // (ufcstats often unaccented), so exact equality would insert
      // duplicates like the seed's "José Aldo" / "Jose Aldo" pair.
      const existing = await oneRow(
        `SELECT id, name FROM fighters WHERE lower(name) IN (lower($1), lower($2))`,
        [nf.name, stripAccents(nf.name)]
      );
      if (existing) {
        fighterIdByName[nf.name] = existing.id;
        log(`fighter ${nf.name} already present (id ${existing.id}${existing.name !== nf.name ? `, stored as ${JSON.stringify(existing.name)}` : ''})`);
        continue;
      }
      const idHolder = await oneRow(`SELECT id, name FROM fighters WHERE id = $1`, [nf.id]);
      if (idHolder) {
        fail(6, `fighter id ${nf.id} (pinned for ${nf.name} to match data/seed.json) is already taken by ${JSON.stringify(idHolder.name)} — prod id-space has drifted from seed; reconcile before re-running.`);
      }
      fighterIdByName[nf.name] = nf.id;
      log(`creating fighter ${nf.name} with id ${nf.id} (${nf.weight_class})`);
      if (!DRY) {
        await q(
          `INSERT INTO fighters (id, name, weight_class) VALUES ($1, $2, $3)`,
          [nf.id, nf.name, nf.weight_class]
        );
      }
    }

    // ── 4. Ensure new fight rows exist on event 105 (ids pinned to seed.json) ──
    for (const nf of NEW_FIGHTS) {
      const redId = fighterIdByName[nf.red_name];
      const blueId = fighterIdByName[nf.blue_name];
      if (!redId || !blueId) fail(5, `missing fighter id for ${nf.red_name} or ${nf.blue_name}`);
      const existing = await oneRow(
        `SELECT id, red_fighter_id, blue_fighter_id, red_name, blue_name, card_position
         FROM fights
         WHERE event_id = $1 AND (
           (red_fighter_id = $2 AND blue_fighter_id = $3) OR
           (red_fighter_id = $3 AND blue_fighter_id = $2)
         )`,
        [EVENT_ID, redId, blueId]
      );
      if (existing) {
        log(`fight ${nf.red_name} vs ${nf.blue_name} already exists (id ${existing.id}, pos ${existing.card_position}) — skipping insert`);
        continue;
      }
      const idHolder = await oneRow(
        `SELECT id, event_id, red_name, blue_name FROM fights WHERE id = $1`,
        [nf.id]
      );
      if (idHolder) {
        fail(6, `fight id ${nf.id} (pinned for ${nf.red_name} vs ${nf.blue_name} to match data/seed.json) is already taken by ${idHolder.red_name} vs ${idHolder.blue_name} (event ${idHolder.event_id}) — prod id-space has drifted from seed; reconcile before re-running.`);
      }
      log(`creating fight ${nf.id}: ${nf.red_name} vs ${nf.blue_name} (${nf.weight_class}, event ${EVENT_ID}, card_position ${nf.card_position})`);
      if (!DRY) {
        await q(
          `INSERT INTO fights
             (id, event_id, red_fighter_id, blue_fighter_id, red_name, blue_name,
              weight_class, card_position, is_main, is_title)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0)`,
          [nf.id, EVENT_ID, redId, blueId, nf.red_name, nf.blue_name, nf.weight_class, nf.card_position]
        );
      }
    }

    // ── 5. Renumber existing card positions on event 105 ──
    const rows = await allRows(
      `SELECT id, card_position, red_name, blue_name FROM fights WHERE event_id = $1`,
      [EVENT_ID]
    );
    const currentPos = new Map(rows.map(r => [r.id, r.card_position]));
    let touched = 0;
    for (const [idStr, newPos] of Object.entries(POSITION_MAP)) {
      const fid = Number(idStr);
      const cur = currentPos.get(fid);
      if (cur === undefined) {
        log(`  fight ${fid} not on event ${EVENT_ID} — skipping position update`);
        continue;
      }
      if (cur === newPos) continue;
      const row = rows.find(r => r.id === fid);
      log(`  fight ${fid} (${row.red_name} vs ${row.blue_name}): card_position ${cur} → ${newPos}`);
      if (!DRY) {
        await q(
          `UPDATE fights SET card_position = $1 WHERE id = $2 AND event_id = $3`,
          [newPos, fid, EVENT_ID]
        );
      }
      touched++;
    }
    if (touched === 0) log('  card positions already correct — nothing to renumber');

    if (!DRY) await q('COMMIT');

    console.log(DRY
      ? '\n[dry-run] no changes written.'
      : [
          '',
          'Done. Required follow-ups:',
          `  1. node scripts/void-orphaned-picks.js --event ${EVENT_ID}  (void picks on dropped fighters)`,
          '  2. POST /api/admin/save on the main app — its cache has no TTL, so a',
          '     running server keeps serving the old card from memory until then.',
          `  3. POST /admin/predict-event?event_id=${EVENT_ID} on the predictions service —`,
          '     scheduled jobs skip event-day cards, so nothing else re-predicts today.',
        ].join('\n'));
  } catch (e) {
    if (!DRY) await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(e => {
  console.error(e.exitCode ? `ERROR: ${e.message}` : e);
  process.exit(e.exitCode || 1);
});
