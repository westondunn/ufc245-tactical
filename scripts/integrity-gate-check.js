/**
 * Fighter-integrity gate — checks next imminent event (within 36 hours)
 * for missing ufcstats_hash and core stats fields.
 *
 * This is a READ-ONLY diagnostic script; it writes no fighter data.
 *
 * Exit codes:
 *   0  → all_clear or no_imminent_event
 *   1  → integrity violations found (caller handles GitHub issue creation)
 *   2  → runtime error (DB unreachable, etc.)
 */

'use strict';

const path = require('path');
const fs   = require('fs');

async function main() {
  let dbModule;
  try {
    dbModule = require('../db/index');
  } catch (e) {
    console.error('FATAL: could not load db adapter:', e.message);
    process.exit(2);
  }

  // db module may expose connect/init or be directly callable
  let db;
  try {
    if (typeof dbModule.connect === 'function') {
      db = await dbModule.connect();
    } else if (typeof dbModule.init === 'function') {
      db = await dbModule.init();
      if (!db) db = dbModule;
    } else {
      db = dbModule;
    }
  } catch (e) {
    console.error('FATAL: db init failed:', e.message);
    process.exit(2);
  }

  const now = new Date();
  const todayUTC  = now.toISOString().slice(0, 10);
  const cutoffUTC = new Date(now.getTime() + 36 * 60 * 60 * 1000).toISOString().slice(0, 10);

  console.error(`[integrity-gate] now=${now.toISOString()} window=${todayUTC}..${cutoffUTC}`);

  // Helper: unified query for postgres (db.query), better-sqlite3 (db.all), and sql.js (db.exec)
  async function execQuery(pgSql, sqliteSql, params) {
    if (typeof db.query === 'function') {
      const r = await db.query(pgSql, params);
      return r.rows || r;
    } else if (typeof db.all === 'function') {
      return await new Promise((res, rej) =>
        db.all(sqliteSql, params, (err, rows) => err ? rej(err) : res(rows))
      );
    } else if (typeof db.exec === 'function') {
      const result = db.exec(sqliteSql);
      if (!result || !result[0]) return [];
      const cols = result[0].columns;
      return result[0].values.map(row =>
        Object.fromEntries(cols.map((c, i) => [c, row[i]]))
      );
    }
    throw new Error('Unknown DB adapter — no query/all/exec method found');
  }

  // --- 1. Find next imminent event ---
  let events;
  try {
    events = await execQuery(
      `SELECT id, name, date, start_time FROM events
       WHERE date >= $1 AND date <= $2
       ORDER BY date ASC, id ASC LIMIT 1`,
      `SELECT id, name, date, start_time FROM events
       WHERE date >= '${todayUTC}' AND date <= '${cutoffUTC}'
       ORDER BY date ASC, id ASC LIMIT 1`,
      [todayUTC, cutoffUTC]
    );
  } catch (e) {
    console.error('FATAL: event query failed:', e.message);
    process.exit(2);
  }

  if (!events || events.length === 0) {
    console.error('[integrity-gate] status=no_imminent_event');
    console.log(JSON.stringify({ status: 'no_imminent_event' }));
    process.exit(0);
  }

  const event = events[0];
  const hoursUntil = event.start_time
    ? Math.round((new Date(event.start_time) - now) / 36e5)
    : null;

  console.error(`[integrity-gate] event: id=${event.id} name="${event.name}" date=${event.date}`);

  // --- 2. Fetch fighters on this card ---
  const CORE_FIELDS = ['height_cm','reach_cm','stance','slpm','str_acc','str_def','td_avg','td_def'];
  const ALL_STATS   = ['height_cm','reach_cm','stance','slpm','str_acc','sapm','str_def','td_avg','td_acc','td_def','sub_avg'];

  let fighters;
  try {
    fighters = await execQuery(
      `SELECT DISTINCT f.id, f.name, f.ufcstats_hash,
         f.height_cm, f.reach_cm, f.stance,
         f.slpm, f.str_acc, f.sapm, f.str_def,
         f.td_avg, f.td_acc, f.td_def, f.sub_avg
       FROM fighters f
       JOIN fights fi ON (fi.red_fighter_id = f.id OR fi.blue_fighter_id = f.id)
       WHERE fi.event_id = $1
       ORDER BY f.name ASC`,
      `SELECT DISTINCT f.id, f.name, f.ufcstats_hash,
         f.height_cm, f.reach_cm, f.stance,
         f.slpm, f.str_acc, f.sapm, f.str_def,
         f.td_avg, f.td_acc, f.td_def, f.sub_avg
       FROM fighters f
       JOIN fights fi ON (fi.red_fighter_id = f.id OR fi.blue_fighter_id = f.id)
       WHERE fi.event_id = ${event.id}
       ORDER BY f.name ASC`,
      [event.id]
    );
  } catch (e) {
    console.error('FATAL: fighter query failed:', e.message);
    process.exit(2);
  }

  if (!fighters || fighters.length === 0) {
    console.error('[integrity-gate] no fighters found for event card — treating as no_imminent_event');
    console.log(JSON.stringify({ status: 'no_imminent_event', note: 'no fighters linked to event' }));
    process.exit(0);
  }

  console.error(`[integrity-gate] ${fighters.length} fighters on card`);

  // --- 3. Evaluate integrity ---
  const violations = [];
  for (const f of fighters) {
    const hashMissing  = f.ufcstats_hash == null || f.ufcstats_hash === '';
    const missingCore  = CORE_FIELDS.filter(field => f[field] == null || f[field] === '');
    const missingAll   = ALL_STATS.filter(field  => f[field] == null || f[field] === '');
    const coreMissing  = missingCore.length > 0;
    const completelyEmpty = missingAll.length >= 6;

    if (hashMissing || coreMissing) {
      violations.push({
        id: f.id,
        name: f.name,
        hash_missing: hashMissing,
        core_missing: coreMissing,
        completely_empty: completelyEmpty,
        missing_core_fields: missingCore,
        missing_all_fields: missingAll,
      });
    }
  }

  if (violations.length === 0) {
    console.error('[integrity-gate] status=all_clear');
    console.log(JSON.stringify({ status: 'all_clear', event, total_fighters: fighters.length }));
    process.exit(0);
  }

  const anyCompletelyEmpty = violations.some(v => v.completely_empty);
  const severity = anyCompletelyEmpty ? 'block' : 'warn';

  console.error(`[integrity-gate] VIOLATIONS: ${violations.length}/${fighters.length} fighters severity=${severity}`);
  violations.forEach(v =>
    console.error(`  - ${v.name} (id=${v.id}): hash_missing=${v.hash_missing} completely_empty=${v.completely_empty} missing=[${v.missing_core_fields.join(',')}]`)
  );

  const result = {
    status: 'violation',
    severity,
    event: { id: event.id, name: event.name, date: event.date, hours_until: hoursUntil },
    total_fighters: fighters.length,
    violations,
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
}

main().catch(e => {
  console.error('FATAL unexpected error:', e.stack);
  process.exit(2);
});
