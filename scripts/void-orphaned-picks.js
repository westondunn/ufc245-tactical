#!/usr/bin/env node
/**
 * scripts/void-orphaned-picks.js
 *
 * Voids picks whose picked_fighter_id is no longer either corner of their
 * fight (orphaned by late card swaps): correct=NULL, method/round_correct=NULL,
 * points=0, actual_winner_id=NULL. Parameterized by event — supersedes the
 * per-event dated copies (void-orphaned-picks-2026-05-02.js was the last).
 *
 * reconcilePicksForEvent now voids orphaned picks itself and keeps them
 * voided on every re-run, so this script is only needed to clean up rows
 * mis-scored before that guard existed, or to fix them up immediately
 * without waiting for the next reconcile.
 *
 * Orphaned picks are voided unconditionally (the UPDATE is idempotent):
 * a never-scored pick is indistinguishable from an already-voided one, so
 * skipping "already voided" rows would silently skip everything pre-event.
 *
 * Run:
 *   $env:DATABASE_URL = (...DATABASE_PUBLIC_URL...)
 *   node scripts/void-orphaned-picks.js --event 105 --dry-run
 *   node scripts/void-orphaned-picks.js --event 105
 */
const { getPool } = require('./_db');

const DRY = process.argv.includes('--dry-run');
const eventArgIdx = process.argv.indexOf('--event');
const EVENT_ID = eventArgIdx > -1 ? Number(process.argv[eventArgIdx + 1]) : NaN;
if (!Number.isInteger(EVENT_ID) || EVENT_ID <= 0) {
  console.error('Usage: node scripts/void-orphaned-picks.js --event <event_id> [--dry-run]');
  process.exit(2);
}

async function main() {
  const pool = getPool();
  const q = (sql, params = []) => pool.query(sql, params);

  try {
    const orphaned = await q(`
      SELECT p.id, p.user_id, p.fight_id, p.picked_fighter_id,
             p.locked_at, p.correct, p.points,
             f.red_fighter_id, f.blue_fighter_id, f.red_name, f.blue_name,
             fighters.name AS picked_name
      FROM user_picks p
      JOIN fights f ON f.id = p.fight_id
      LEFT JOIN fighters ON fighters.id = p.picked_fighter_id
      WHERE p.event_id = $1
        AND p.picked_fighter_id IS DISTINCT FROM f.red_fighter_id
        AND p.picked_fighter_id IS DISTINCT FROM f.blue_fighter_id
    `, [EVENT_ID]);

    if (orphaned.rows.length === 0) {
      console.log('No orphaned picks for event', EVENT_ID, '- nothing to void.');
      return;
    }

    console.log(`Found ${orphaned.rows.length} orphaned pick(s):`);
    for (const r of orphaned.rows) {
      const status = r.correct === null && Number(r.points) === 0 ? ' [already in voided state]' : '';
      console.log(
        `  pick ${r.id}: user ${r.user_id} picked ${r.picked_name} (id ${r.picked_fighter_id}) ` +
        `for fight ${r.fight_id} (${r.red_name} vs ${r.blue_name})${status}`
      );
    }

    console.log(`\n${DRY ? '[dry-run] would void' : '[apply] voiding'} ${orphaned.rows.length} pick(s).`);
    if (!DRY) {
      const ids = orphaned.rows.map(r => r.id);
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
