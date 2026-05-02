#!/usr/bin/env node
/**
 * scripts/void-orphaned-picks-2026-05-02.js
 *
 * Companion to scripts/patch-card-2026-05-02.js. Finds picks whose
 * picked_fighter_id is no longer either side of their fight (orphaned by
 * the late-card swap) and voids them: correct=NULL, points=0, *_correct=NULL.
 *
 * Tonight's known case: fight 757 swapped Sharaf (651) → Sutherland (320).
 * Any pick on fight 757 with picked_fighter_id=651 is now orphaned; without
 * this fix, reconcilePicksForEvent would score those picks as `correct=0`
 * (silent penalty for picking a fighter who was scratched).
 *
 * Idempotent — picks already voided (correct=NULL && points=0) are skipped.
 *
 * Run:
 *   $env:DATABASE_URL = (...DATABASE_PUBLIC_URL...)
 *   $env:PGSSLMODE = 'require'
 *   node scripts/void-orphaned-picks-2026-05-02.js --dry-run
 *   node scripts/void-orphaned-picks-2026-05-02.js
 */
const { Pool } = require('pg');

const EVENT_ID = 102;
const DRY = process.argv.includes('--dry-run');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL required.');
    process.exit(2);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  const q = (sql, params = []) => pool.query(sql, params);

  try {
    // Find orphaned picks for any fight in the event.
    const orphaned = await q(`
      SELECT p.id, p.user_id, p.fight_id, p.picked_fighter_id,
             p.locked_at, p.correct, p.points,
             f.red_fighter_id, f.blue_fighter_id, f.red_name, f.blue_name,
             fighters.name AS picked_name
      FROM user_picks p
      JOIN fights f ON f.id = p.fight_id
      LEFT JOIN fighters ON fighters.id = p.picked_fighter_id
      WHERE p.event_id = $1
        AND p.picked_fighter_id NOT IN (f.red_fighter_id, f.blue_fighter_id)
    `, [EVENT_ID]);

    if (orphaned.rows.length === 0) {
      console.log('No orphaned picks for event', EVENT_ID, '- nothing to void.');
      return;
    }

    console.log(`Found ${orphaned.rows.length} orphaned pick(s):`);
    for (const r of orphaned.rows) {
      const status = r.correct === null && Number(r.points) === 0 ? ' [already voided]' : '';
      console.log(
        `  pick ${r.id}: user ${r.user_id} picked ${r.picked_name} (id ${r.picked_fighter_id}) ` +
        `for fight ${r.fight_id} (${r.red_name} vs ${r.blue_name})${status}`
      );
    }

    // Filter to picks that actually need updating.
    const toVoid = orphaned.rows.filter(r => !(r.correct === null && Number(r.points) === 0));
    if (toVoid.length === 0) {
      console.log('\nAll already voided — nothing to do.');
      return;
    }

    console.log(`\n${DRY ? '[dry-run] would void' : '[apply] voiding'} ${toVoid.length} pick(s).`);
    if (!DRY) {
      const ids = toVoid.map(r => r.id);
      const result = await q(`
        UPDATE user_picks
        SET correct = NULL, method_correct = NULL, round_correct = NULL,
            points = 0, actual_winner_id = NULL
        WHERE id = ANY($1::bigint[])
      `, [ids]);
      console.log(`Voided ${result.rowCount} pick(s).`);
    }
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
