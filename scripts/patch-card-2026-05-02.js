#!/usr/bin/env node
/**
 * scripts/patch-card-2026-05-02.js
 *
 * One-shot patch for last-minute roster changes on UFC Fight Night:
 * Della Maddalena vs. Prates (event 102, 2026-05-02). Idempotent — safe to
 * re-run; prints what it would do (and skips) when a change is already applied.
 *
 * Uses a direct pg Pool so it does not invoke ensureSchema() over the remote
 * connection (that pass is slow against Railway's public Postgres host).
 *
 * Changes (vs ufcstats.com card on the morning of the event):
 *   1. Fight 757: blue_fighter_id 651 (Sean Sharaf) → 320 (Louie Sutherland)
 *      Existing predictions vs Sharaf are marked is_stale=1.
 *   2. New fighter: Ollie Schmid (Featherweight)
 *   3. New fight: Marwan Rahiki (id 742) vs Ollie Schmid, Featherweight, prelim
 *
 * Run:
 *   $env:DATABASE_URL = (...DATABASE_PUBLIC_URL...)
 *   $env:PGSSLMODE = 'require'
 *   node scripts/patch-card-2026-05-02.js --dry-run
 *   node scripts/patch-card-2026-05-02.js
 */
const { Pool } = require('pg');

const EVENT_ID = 102;
const TUIVASA_FIGHT_ID = 757;
const SHARAF_FIGHTER_ID = 651;
const SUTHERLAND_FIGHTER_ID = 320;
const RAHIKI_FIGHTER_ID = 742;
const SCHMID_FIGHTER_NAME = 'Ollie Schmid';

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
    // ── 1. Tuivasa fight: Sharaf → Sutherland ──
    const fight = await oneRow(
      `SELECT id, red_fighter_id, blue_fighter_id, red_name, blue_name FROM fights WHERE id = $1`,
      [TUIVASA_FIGHT_ID]
    );
    if (!fight) { console.error(`ERROR: fight ${TUIVASA_FIGHT_ID} not found`); process.exit(3); }

    if (fight.blue_fighter_id === SUTHERLAND_FIGHTER_ID) {
      log(`fight ${TUIVASA_FIGHT_ID} already has Sutherland — skipping`);
    } else if (fight.blue_fighter_id !== SHARAF_FIGHTER_ID) {
      console.error(`ERROR: fight ${TUIVASA_FIGHT_ID} blue_fighter_id is ${fight.blue_fighter_id}, expected ${SHARAF_FIGHTER_ID} (Sharaf). Aborting to avoid clobbering an unknown change.`);
      process.exit(4);
    } else {
      log(`fight ${TUIVASA_FIGHT_ID}: blue ${fight.blue_name} (id ${fight.blue_fighter_id}) → Louie Sutherland (id ${SUTHERLAND_FIGHTER_ID})`);
      if (!DRY) {
        await q(
          `UPDATE fights SET blue_fighter_id = $1, blue_name = 'Louie Sutherland'
           WHERE id = $2 AND blue_fighter_id = $3`,
          [SUTHERLAND_FIGHTER_ID, TUIVASA_FIGHT_ID, SHARAF_FIGHTER_ID]
        );
      }
    }

    // ── 2. Stale-mark predictions made vs Sharaf ──
    const stalePreds = await allRows(
      `SELECT id, model_version FROM predictions
       WHERE fight_id = $1 AND blue_fighter_id = $2 AND is_stale = 0`,
      [TUIVASA_FIGHT_ID, SHARAF_FIGHTER_ID]
    );
    if (stalePreds.length === 0) {
      log('no live predictions vs Sharaf to stale-mark');
    } else {
      log(`stale-marking ${stalePreds.length} prediction(s):`, stalePreds.map(p => p.id).join(', '));
      if (!DRY) {
        await q(
          `UPDATE predictions SET is_stale = 1
           WHERE fight_id = $1 AND blue_fighter_id = $2`,
          [TUIVASA_FIGHT_ID, SHARAF_FIGHTER_ID]
        );
      }
    }

    // ── 3. Ensure Ollie Schmid fighter row exists ──
    let schmid = await oneRow(`SELECT id, name FROM fighters WHERE name = $1`, [SCHMID_FIGHTER_NAME]);
    let schmidId;
    if (schmid) {
      schmidId = schmid.id;
      log(`fighter Ollie Schmid already present (id ${schmidId})`);
    } else {
      const max = await oneRow(`SELECT COALESCE(MAX(id), 0) AS m FROM fighters`);
      schmidId = Number(max.m) + 1;
      log(`creating fighter Ollie Schmid with id ${schmidId} (Featherweight)`);
      if (!DRY) {
        await q(
          `INSERT INTO fighters (id, name, weight_class) VALUES ($1, $2, 'Featherweight')`,
          [schmidId, SCHMID_FIGHTER_NAME]
        );
      }
    }

    // ── 4. Ensure Rahiki vs Schmid fight row exists ──
    const existingRahiki = await oneRow(
      `SELECT id, red_fighter_id, blue_fighter_id, red_name, blue_name
       FROM fights
       WHERE event_id = $1 AND (
         (red_fighter_id = $2 AND blue_fighter_id = $3) OR
         (red_fighter_id = $3 AND blue_fighter_id = $2)
       )`,
      [EVENT_ID, RAHIKI_FIGHTER_ID, schmidId]
    );
    if (existingRahiki) {
      log(`Rahiki vs Schmid fight already exists (id ${existingRahiki.id}) — skipping`);
    } else {
      const max = await oneRow(`SELECT COALESCE(MAX(id), 0) AS m FROM fights`);
      const newFightId = Number(max.m) + 1;
      log(`creating fight ${newFightId}: Marwan Rahiki vs Ollie Schmid (Featherweight, event ${EVENT_ID}, prelim card_position 4)`);
      if (!DRY) {
        await q(
          `INSERT INTO fights
             (id, event_id, red_fighter_id, blue_fighter_id, red_name, blue_name,
              weight_class, card_position, is_main, is_title)
           VALUES ($1, $2, $3, $4, 'Marwan Rahiki', $5, 'Featherweight', 4, 0, 0)`,
          [newFightId, EVENT_ID, RAHIKI_FIGHTER_ID, schmidId, SCHMID_FIGHTER_NAME]
        );
      }
    }

    console.log(DRY ? '\n[dry-run] no changes written.' : '\nDone.');
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
