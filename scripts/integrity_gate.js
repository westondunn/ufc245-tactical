#!/usr/bin/env node
/**
 * Fighter integrity gate — run before each imminent UFC event.
 * Read-only against the DB. No code changes, no commits.
 * Exits 0 on clean or no_imminent_event; exits 1 on DB/tool failure.
 */
'use strict';

const TODAY_UTC = process.env.CHECK_DATE || new Date().toISOString().slice(0, 10);
const WINDOW_HOURS = 36;

async function main() {
  const dbModule = require('../db/sqlite.js');
  await dbModule.init({ seedPath: './data/seed.json' });

  const todayMs = new Date(TODAY_UTC + 'T00:00:00Z').getTime();
  const windowEnd = new Date(todayMs + WINDOW_HOURS * 60 * 60 * 1000);
  const windowEndDate = windowEnd.toISOString().slice(0, 10);

  const events = dbModule.allRows(
    `SELECT e.* FROM events e
     WHERE e.date >= ? AND e.date <= ?
     ORDER BY e.date ASC, e.start_time ASC
     LIMIT 1`,
    [TODAY_UTC, windowEndDate]
  );

  if (!events || events.length === 0) {
    console.log(JSON.stringify({ status: 'no_imminent_event', checked_at: TODAY_UTC }));
    return;
  }

  const event = events[0];
  const eventDateMs = new Date(
    event.start_time || (event.date + 'T23:00:00Z')
  ).getTime();
  const hoursUntil = Math.round((eventDateMs - Date.now()) / 3600000);

  // Get all fighters on this event's card
  const fighters = dbModule.allRows(
    `SELECT DISTINCT
       f.id, f.name,
       f.ufcstats_hash,
       f.height_cm, f.reach_cm, f.stance,
       f.slpm, f.str_acc, f.str_def,
       f.td_avg, f.td_def,
       f.sapm, f.td_acc, f.sub_avg
     FROM fighters f
     JOIN fights fi ON (fi.red_fighter_id = f.id OR fi.blue_fighter_id = f.id)
     WHERE fi.event_id = ?
     ORDER BY f.name ASC`,
    [event.id]
  );

  const CORE_FIELDS = ['height_cm', 'reach_cm', 'stance', 'slpm', 'str_acc', 'str_def', 'td_avg', 'td_def'];
  const ALL_STAT_FIELDS = ['height_cm', 'reach_cm', 'stance', 'slpm', 'str_acc', 'sapm', 'str_def', 'td_avg', 'td_acc', 'td_def', 'sub_avg'];

  const results = fighters.map(f => {
    const hash_missing = f.ufcstats_hash == null;
    const missing_core = CORE_FIELDS.filter(col => f[col] == null);
    const missing_all = ALL_STAT_FIELDS.filter(col => f[col] == null);
    return {
      id: f.id,
      name: f.name,
      hash_missing,
      core_missing: missing_core.length > 0,
      completely_empty: missing_all.length >= 6,
      missing_core_fields: missing_core,
      missing_all_count: missing_all.length,
    };
  });

  const violations = results.filter(r => r.hash_missing || r.core_missing);
  const hasBlock = results.some(r => r.completely_empty);
  const severity = hasBlock ? 'block' : 'warn';

  console.log(JSON.stringify({
    status: violations.length > 0 ? 'integrity_violation' : 'all_clear',
    severity: violations.length > 0 ? severity : null,
    event: {
      id: event.id,
      name: event.name,
      date: event.date,
      hours_until_start: hoursUntil,
    },
    total_fighters: fighters.length,
    violations_count: violations.length,
    violations,
    all_results: results,
  }, null, 2));
}

main().catch(e => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
