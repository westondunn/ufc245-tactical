#!/usr/bin/env node
/**
 * scripts/patch-card-2026-05-30.js
 *
 * One-shot patch for late card movement on UFC Fight Night:
 * Song Yadong vs Deiveson Figueiredo (event 105, Galaxy Arena Macao,
 * 2026-05-30). Idempotent — safe to re-run; prints what it would do
 * (and skips) when a change is already applied.
 *
 * Uses a direct pg Pool so it does not invoke ensureSchema() over the
 * remote connection (that pass is slow against Railway's public host).
 *
 * Changes (vs ufcstats.com / ufc.com on the morning of the event):
 *   1. Fight 794 (Welterweight): red 673 (Muslim Salikhov) →
 *      red 877 (Carlston Harris). Stale-mark predictions vs Salikhov.
 *   2. Fight 799 (Flyweight → Bantamweight): blue 418 (Jesus Aguilar)
 *      → blue 669 (Luis Gurule); weight_class moves up to Bantamweight.
 *      Stale-mark predictions vs Aguilar.
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
 * Companion script scripts/void-orphaned-picks-2026-05-30.js voids
 * any user_picks whose picked_fighter_id is no longer either corner
 * after the swaps above. Run that after this script.
 *
 * Run:
 *   $env:DATABASE_URL = (...DATABASE_PUBLIC_URL...)
 *   $env:PGSSLMODE = 'require'
 *   node scripts/patch-card-2026-05-30.js --dry-run
 *   node scripts/patch-card-2026-05-30.js
 */
const { Pool } = require('pg');

const EVENT_ID = 105;

// ── Fighter swaps (existing rows in fighters table) ──
const MATTHEWS_FIGHT_ID = 794;
const SALIKHOV_ID  = 673;   // out
const HARRIS_ID    = 877;   // in

const TSURUYA_FIGHT_ID = 799;
const AGUILAR_ID   = 418;   // out
const GURULE_ID    = 669;   // in
const TSURUYA_NEW_WC = 'Bantamweight'; // moves up from Flyweight

// ── New fighters to ensure exist ──
const NEW_FIGHTERS = [
  { name: 'Ding Meng',     weight_class: 'Welterweight' },
  { name: 'José Souza',    weight_class: 'Welterweight' },
  { name: 'Zhu Kangjie',   weight_class: 'Featherweight' },
  { name: 'Rodrigo Vera',  weight_class: 'Featherweight' },
];

// ── New fight insertions (after fighter rows exist) ──
const NEW_FIGHTS = [
  { red_name: 'Ding Meng',   blue_name: 'José Souza',    weight_class: 'Welterweight', card_position: 8  },
  { red_name: 'Zhu Kangjie', blue_name: 'Rodrigo Vera',  weight_class: 'Featherweight', card_position: 12 },
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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL required (this script is prod-only).');
    process.exit(2);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  const q = (sql, params = []) => pool.query(sql, params);
  const oneRow = async (sql, params) => (await q(sql, params)).rows[0] || null;
  const allRows = async (sql, params) => (await q(sql, params)).rows;

  try {
    // ── 1. Matthews fight: Salikhov → Harris (red corner) ──
    const f794 = await oneRow(
      `SELECT id, red_fighter_id, blue_fighter_id, red_name, blue_name FROM fights WHERE id = $1`,
      [MATTHEWS_FIGHT_ID]
    );
    if (!f794) { console.error(`ERROR: fight ${MATTHEWS_FIGHT_ID} not found`); process.exit(3); }

    if (f794.red_fighter_id === HARRIS_ID) {
      log(`fight ${MATTHEWS_FIGHT_ID} already has Harris as red — skipping`);
    } else if (f794.red_fighter_id !== SALIKHOV_ID) {
      console.error(`ERROR: fight ${MATTHEWS_FIGHT_ID} red_fighter_id is ${f794.red_fighter_id}, expected ${SALIKHOV_ID} (Salikhov). Aborting to avoid clobbering an unknown change.`);
      process.exit(4);
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

    // ── 2. Tsuruya fight: Aguilar → Gurule (blue corner) + weight class change ──
    const f799 = await oneRow(
      `SELECT id, red_fighter_id, blue_fighter_id, red_name, blue_name, weight_class FROM fights WHERE id = $1`,
      [TSURUYA_FIGHT_ID]
    );
    if (!f799) { console.error(`ERROR: fight ${TSURUYA_FIGHT_ID} not found`); process.exit(3); }

    if (f799.blue_fighter_id === GURULE_ID) {
      log(`fight ${TSURUYA_FIGHT_ID} already has Gurule as blue — skipping fighter swap`);
    } else if (f799.blue_fighter_id !== AGUILAR_ID) {
      console.error(`ERROR: fight ${TSURUYA_FIGHT_ID} blue_fighter_id is ${f799.blue_fighter_id}, expected ${AGUILAR_ID} (Aguilar). Aborting to avoid clobbering an unknown change.`);
      process.exit(4);
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

    // ── 3. Ensure new fighter rows exist ──
    const fighterIdByName = {};
    for (const nf of NEW_FIGHTERS) {
      const existing = await oneRow(`SELECT id, name FROM fighters WHERE name = $1`, [nf.name]);
      if (existing) {
        fighterIdByName[nf.name] = existing.id;
        log(`fighter ${nf.name} already present (id ${existing.id})`);
        continue;
      }
      const max = await oneRow(`SELECT COALESCE(MAX(id), 0) AS m FROM fighters`);
      const newId = Number(max.m) + 1;
      fighterIdByName[nf.name] = newId;
      log(`creating fighter ${nf.name} with id ${newId} (${nf.weight_class})`);
      if (!DRY) {
        await q(
          `INSERT INTO fighters (id, name, weight_class) VALUES ($1, $2, $3)`,
          [newId, nf.name, nf.weight_class]
        );
      }
    }

    // ── 4. Ensure new fight rows exist on event 105 ──
    for (const nf of NEW_FIGHTS) {
      const redId = fighterIdByName[nf.red_name];
      const blueId = fighterIdByName[nf.blue_name];
      if (!redId || !blueId) {
        if (DRY) {
          log(`would create fight ${nf.red_name} vs ${nf.blue_name} — fighter IDs not resolved yet in dry-run, will be assigned on apply`);
          continue;
        }
        console.error(`ERROR: missing fighter id for ${nf.red_name} or ${nf.blue_name}`);
        process.exit(5);
      }
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
      const max = await oneRow(`SELECT COALESCE(MAX(id), 0) AS m FROM fights`);
      const newFightId = Number(max.m) + 1;
      log(`creating fight ${newFightId}: ${nf.red_name} vs ${nf.blue_name} (${nf.weight_class}, event ${EVENT_ID}, card_position ${nf.card_position})`);
      if (!DRY) {
        await q(
          `INSERT INTO fights
             (id, event_id, red_fighter_id, blue_fighter_id, red_name, blue_name,
              weight_class, card_position, is_main, is_title)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0)`,
          [newFightId, EVENT_ID, redId, blueId, nf.red_name, nf.blue_name, nf.weight_class, nf.card_position]
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

    console.log(DRY ? '\n[dry-run] no changes written.' : '\nDone. Now run scripts/void-orphaned-picks-2026-05-30.js to handle picks on dropped fighters.');
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
