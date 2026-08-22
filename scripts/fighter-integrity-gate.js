#!/usr/bin/env node
'use strict';

const dbMod = require('../db/sqlite.js');

async function main() {
  await dbMod.init();

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const windowEnd = new Date(now.getTime() + 36 * 60 * 60 * 1000);
  const windowEndStr = windowEnd.toISOString().slice(0, 10);

  console.log(`UTC now: ${now.toISOString()}`);
  console.log(`Window: ${todayStr} to ${windowEndStr}`);

  const allEvents = dbMod.getAllEvents();
  console.log(`Total events in DB: ${allEvents.length}`);

  if (!allEvents.length) {
    console.log('STATUS: no_events_in_db');
    process.exit(0);
  }

  const upcoming = allEvents
    .filter(e => e.date >= todayStr)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  console.log(`Upcoming events (>= ${todayStr}): ${upcoming.length}`);
  upcoming.slice(0, 5).forEach(e =>
    console.log(`  [${e.id}] ${e.name} on ${e.date} (start_time: ${e.start_time || 'none'})`)
  );

  const imminentEvent = upcoming.find(e => {
    if (e.start_time) {
      const st = new Date(e.start_time);
      return st >= now && st <= windowEnd;
    }
    return e.date >= todayStr && e.date <= windowEndStr;
  });

  if (!imminentEvent) {
    console.log(`STATUS: no_imminent_event`);
    const next = upcoming[0];
    if (next) {
      console.log(`Next upcoming event: [${next.id}] ${next.name} on ${next.date}`);
    }
    process.exit(0);
  }

  console.log(`\nImminent event: [${imminentEvent.id}] ${imminentEvent.name} on ${imminentEvent.date}`);

  const card = dbMod.getEventCard(imminentEvent.id);
  console.log(`Card fights: ${card.length}`);

  const fighterMap = new Map();
  for (const fight of card) {
    for (const prefix of ['red', 'blue']) {
      const id = fight[`${prefix}_id`];
      if (id != null && !fighterMap.has(id)) {
        fighterMap.set(id, {
          id,
          name: fight[`${prefix}_name`],
          height_cm: fight[`${prefix}_height`],
          reach_cm: fight[`${prefix}_reach`],
          stance: fight[`${prefix}_stance`],
          slpm: fight[`${prefix}_slpm`],
          str_acc: fight[`${prefix}_str_acc`],
          sapm: fight[`${prefix}_sapm`],
          str_def: fight[`${prefix}_str_def`],
          td_avg: fight[`${prefix}_td_avg`],
          td_acc: fight[`${prefix}_td_acc`],
          td_def: fight[`${prefix}_td_def`],
          sub_avg: fight[`${prefix}_sub_avg`],
          ufcstats_hash: null,
        });
      }
    }
  }

  for (const [id, fighter] of fighterMap) {
    const f = dbMod.getFighter(id);
    if (f) fighter.ufcstats_hash = f.ufcstats_hash || null;
  }

  const fighters = Array.from(fighterMap.values());
  console.log(`Unique fighters on card: ${fighters.length}`);

  const CORE_FIELDS = ['height_cm', 'reach_cm', 'stance', 'slpm', 'str_acc', 'str_def', 'td_avg', 'td_def'];
  const ALL_STAT_FIELDS = ['height_cm', 'reach_cm', 'stance', 'slpm', 'str_acc', 'sapm', 'str_def', 'td_avg', 'td_acc', 'td_def', 'sub_avg'];

  const results = fighters.map(f => {
    const hash_missing = f.ufcstats_hash == null;
    const core_missing_fields = CORE_FIELDS.filter(field => f[field] == null);
    const core_missing = core_missing_fields.length > 0;
    const null_count = ALL_STAT_FIELDS.filter(field => f[field] == null).length;
    const completely_empty = null_count >= 6;
    return { id: f.id, name: f.name, hash_missing, core_missing, core_missing_fields, completely_empty, null_count };
  });

  const violations = results.filter(r => r.hash_missing || r.core_missing);
  const anyBlock = violations.some(r => r.completely_empty);

  let hoursUntilStart = null;
  if (imminentEvent.start_time) {
    hoursUntilStart = +((new Date(imminentEvent.start_time) - now) / 3600000).toFixed(1);
  } else {
    const eventMidnight = new Date(imminentEvent.date + 'T00:00:00Z');
    hoursUntilStart = +((eventMidnight - now) / 3600000).toFixed(1);
  }

  const output = {
    status: violations.length > 0 ? 'integrity_violation' : 'all_clear',
    event: {
      id: imminentEvent.id,
      name: imminentEvent.name,
      date: imminentEvent.date,
      hours_until_start: hoursUntilStart,
    },
    total_fighters: fighters.length,
    violations,
    severity: anyBlock ? 'block' : 'warn',
  };

  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(output, null, 2));
}

main().catch(e => {
  console.error('FATAL:', e.message, e.stack);
  process.exit(1);
});
