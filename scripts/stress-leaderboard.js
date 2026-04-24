#!/usr/bin/env node
/**
 * scripts/stress-leaderboard.js — Leaderboard latency stress test
 *
 * Creates N synthetic users, writes ~P picks per user across the M most-recent
 * events, reconciles everything, then times the getLeaderboard() query over
 * K runs. Prints p50 / p95 / max / mean.
 *
 * Usage (file-backed sqlite so picks persist between script and any running server):
 *   DB_PATH=/tmp/ufc-stress.db node scripts/stress-leaderboard.js
 *   DB_PATH=/tmp/ufc-stress.db USERS=200 PICKS=15 EVENTS=5 RUNS=100 \
 *     node scripts/stress-leaderboard.js
 *
 * Defaults: 100 users × 12 picks × 5 events × 50 timed runs.
 *
 * Idempotent: deletes prior 'stress-' named users before re-seeding.
 */
const db = require('../db');

const USERS  = parseInt(process.env.USERS  || '100', 10);
const PICKS  = parseInt(process.env.PICKS  || '12',  10);
const EVENTS = parseInt(process.env.EVENTS || '5',   10);
const RUNS   = parseInt(process.env.RUNS   || '50',  10);

function percentile(sorted, p){
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main(){
  if (!process.env.DB_PATH) {
    console.error('✗ DB_PATH is required (the stress data goes into a real sqlite file).');
    console.error('  Example: DB_PATH=/tmp/ufc-stress.db node scripts/stress-leaderboard.js');
    process.exit(1);
  }
  console.log(`Stress config: ${USERS} users × ${PICKS} picks × ${EVENTS} events × ${RUNS} runs\n`);

  await db.init();

  // Clean prior stress users (prefix "stress-")
  const existing = await db.allRows("SELECT id FROM users WHERE display_name LIKE 'stress-%'");
  for (const r of existing) await db.deleteUser(r.id);

  // Events — most-recent N
  const events = await db.allRows(
    "SELECT id, date FROM events WHERE date IS NOT NULL ORDER BY date DESC LIMIT ?",
    [EVENTS]
  );
  if (!events.length) { console.error('✗ No events found.'); process.exit(1); }

  // Seed users
  const t0 = Date.now();
  const users = [];
  for (let i = 0; i < USERS; i++) {
    users.push(await db.createUser({ display_name: `stress-${i.toString().padStart(4,'0')}`, avatar_key: 'a1' }));
  }
  console.log(`  ${USERS} users created in ${Date.now() - t0} ms`);

  // For each event, grab a few fights, null their winners to permit picks,
  // fan out user picks, restore winners, reconcile.
  const t1 = Date.now();
  let picksWritten = 0;
  for (const ev of events) {
    const fights = await db.allRows(
      "SELECT id, red_fighter_id, blue_fighter_id, winner_id FROM fights WHERE event_id = ? AND winner_id IS NOT NULL LIMIT ?",
      [ev.id, Math.ceil(PICKS / EVENTS) + 2]
    );
    if (!fights.length) continue;

    // Ingest a throw-away prediction per fight so pick snapshots have data
    for (const f of fights) {
      await db.upsertPrediction({
        fight_id: f.id,
        red_fighter_id: f.red_fighter_id,
        blue_fighter_id: f.blue_fighter_id,
        red_win_prob: 0.6,
        blue_win_prob: 0.4,
        model_version: 'stress-v0',
        feature_hash: null,
        predicted_at: new Date().toISOString(),
        event_date: ev.date,
        is_stale: 0
      });
      await db.run('UPDATE fights SET winner_id = NULL WHERE id = ?', [f.id]);
    }
    for (const u of users) {
      // Each user makes ~PICKS/EVENTS picks per event, up to the number of fights available
      const n = Math.min(Math.ceil(PICKS / EVENTS), fights.length);
      for (let i = 0; i < n; i++) {
        const f = fights[i];
        const pickedId = Math.random() < 0.65 ? f.winner_id
          : (f.winner_id === f.red_fighter_id ? f.blue_fighter_id : f.red_fighter_id);
        try {
          await db.upsertPick({
            user_id: u.id,
            event_id: ev.id,
            fight_id: f.id,
            picked_fighter_id: pickedId,
            confidence: 40 + Math.floor(Math.random() * 55),
            method_pick: null,
            round_pick: null,
            notes: null
          });
          picksWritten++;
        } catch { /* skip */ }
      }
    }
    for (const f of fights) {
      await db.run('UPDATE fights SET winner_id = ? WHERE id = ?', [f.winner_id, f.id]);
    }
    await db.reconcilePicksForEvent(ev.id);
  }
  await db.save();
  console.log(`  ${picksWritten} picks written + reconciled in ${((Date.now() - t1)/1000).toFixed(1)} s`);

  // Time getLeaderboard
  console.log(`\nTiming getLeaderboard({ limit: 50 }) over ${RUNS} runs...`);
  const timings = [];
  for (let i = 0; i < RUNS; i++) {
    const t = process.hrtime.bigint();
    const rows = await db.getLeaderboard({ limit: 50 });
    const elapsedNs = Number(process.hrtime.bigint() - t);
    timings.push(elapsedNs / 1e6); // ms
    if (i === 0) console.log(`  (returned ${rows.length} rows on first call)`);
  }
  timings.sort((a, b) => a - b);
  const mean = timings.reduce((s, v) => s + v, 0) / timings.length;
  console.log('\nLatency distribution (ms):');
  console.log(`  min    ${timings[0].toFixed(2)}`);
  console.log(`  p50    ${percentile(timings, 50).toFixed(2)}`);
  console.log(`  p95    ${percentile(timings, 95).toFixed(2)}`);
  console.log(`  p99    ${percentile(timings, 99).toFixed(2)}`);
  console.log(`  max    ${timings[timings.length - 1].toFixed(2)}`);
  console.log(`  mean   ${mean.toFixed(2)}`);

  // Event-scoped leaderboard
  console.log(`\nTiming getLeaderboard({ event_id, limit: 50 }) over ${RUNS} runs...`);
  const eventTimings = [];
  const ev = events[0];
  for (let i = 0; i < RUNS; i++) {
    const t = process.hrtime.bigint();
    await db.getLeaderboard({ event_id: ev.id, limit: 50 });
    eventTimings.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  eventTimings.sort((a, b) => a - b);
  console.log(`  p50    ${percentile(eventTimings, 50).toFixed(2)}`);
  console.log(`  p95    ${percentile(eventTimings, 95).toFixed(2)}`);
  console.log(`  max    ${eventTimings[eventTimings.length - 1].toFixed(2)}`);

  // Cleanup
  for (const u of users) await db.deleteUser(u.id);
  await db.save();
  console.log('\n  cleanup: stress users removed.');
}

main().catch(err => { console.error(err); process.exit(1); });
