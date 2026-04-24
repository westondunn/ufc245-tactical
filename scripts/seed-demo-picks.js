#!/usr/bin/env node
/**
 * scripts/seed-demo-picks.js — Local dev helper
 *
 * Writes 3 demo users with picks across UFC 245 (+ earlier events if
 * present in the seed), then reconciles all picks so the History and
 * Leaderboard views have real data to render. Idempotent — existing
 * demo users are deleted and re-inserted.
 *
 * Usage:
 *   DB_PATH=/tmp/ufc-picks-demo.db node scripts/seed-demo-picks.js
 *   DB_PATH=/tmp/ufc-picks-demo.db ENABLE_PICKS=true \
 *     ADMIN_KEY=test PORT=3100 node server.js
 */
const db = require('../db');

const DEMO_USERS = [
  { display_name: 'Weston',      avatar_key: 'a7' },
  { display_name: 'Friend A',    avatar_key: 'a1' },
  { display_name: 'Friend B',    avatar_key: 'a3' },
  { display_name: 'Sharp Eye',   avatar_key: 'a5' }
];

function chance(p){ return Math.random() < p; }
function pick(arr){ return arr[Math.floor(Math.random() * arr.length)]; }

async function main(){
  if (!process.env.DB_PATH) {
    console.error('✗ DB_PATH is required so picks persist to disk.');
    console.error('  Example: DB_PATH=/tmp/ufc-picks-demo.db node scripts/seed-demo-picks.js');
    process.exit(1);
  }

  await db.init();

  // Wipe prior demo users (by name match), then re-create
  for (const u of DEMO_USERS) {
    const existing = await db.allRows('SELECT id FROM users WHERE display_name = ?', [u.display_name]);
    for (const r of existing) await db.deleteUser(r.id);
  }
  const users = [];
  for (const u of DEMO_USERS) {
    users.push(await db.createUser(u));
  }

  // Target: every user makes picks on up to N events' fights
  const events = await db.allRows("SELECT id, number, name, date FROM events ORDER BY date DESC LIMIT 5");
  if (!events.length) {
    console.error('✗ No events in DB. Run a seeded DB first.');
    process.exit(1);
  }

  // Strategy: temporarily null each fight's winner so upsertPick accepts it,
  // write the pick, restore the winner, then reconcile the event once.
  for (const ev of events) {
    const fights = await db.allRows(
      'SELECT id, red_fighter_id, blue_fighter_id, winner_id, method, round FROM fights WHERE event_id = ? AND winner_id IS NOT NULL',
      [ev.id]
    );
    if (!fights.length) continue;

    for (const f of fights) {
      const origWinner = f.winner_id;
      await db.run('UPDATE fights SET winner_id = NULL WHERE id = ?', [f.id]);

      for (const u of users) {
        if (chance(0.25)) continue; // sparse picks — not every user picks every fight

        // Choose fighter: 70% of users favor the actual winner (realistic)
        const pickedId = chance(0.7) ? origWinner
          : (origWinner === f.red_fighter_id ? f.blue_fighter_id : f.red_fighter_id);
        const conf = 40 + Math.floor(Math.random() * 55);
        const methodPick = chance(0.55) ? pick(['KO/TKO', 'SUB', 'DEC']) : null;
        const roundPick  = chance(0.4) ? pick([1, 2, 3, 4, 5]) : null;

        try {
          await db.upsertPick({
            user_id: u.id,
            event_id: ev.id,
            fight_id: f.id,
            picked_fighter_id: pickedId,
            confidence: conf,
            method_pick: methodPick,
            round_pick: roundPick,
            notes: null
          });
        } catch (e) { /* skip on error */ }
      }

      await db.run('UPDATE fights SET winner_id = ? WHERE id = ?', [origWinner, f.id]);
    }

    const r = await db.reconcilePicksForEvent(ev.id);
    console.log(`  UFC ${ev.number || '—'} · ${ev.date}: reconciled=${r.reconciled}, points=${r.points_awarded}`);
  }

  await db.save();
  console.log('\nDemo users:');
  for (const u of users) {
    const stats = await db.getUserStats(u.id);
    console.log(`  ${u.display_name.padEnd(12)} → ${u.id}  (${stats.total_picks} picks · ${stats.points} pts)`);
  }
  console.log('\nDone. Start server with:');
  console.log(`  DB_PATH=${process.env.DB_PATH} ENABLE_PICKS=true ADMIN_KEY=test PORT=3100 node server.js`);
  console.log('\nThen paste one of the IDs above into the Picks profile "Switch profile" flow.');
}

main().catch(err => { console.error(err); process.exit(1); });
