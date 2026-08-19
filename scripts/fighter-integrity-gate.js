/**
 * Fighter integrity gate — read-only check.
 * Checks next event within 36 hours for missing ufcstats_hash or core stats.
 */
const TODAY_UTC = new Date('2026-08-19T00:00:00Z');
const CUTOFF_UTC = new Date(TODAY_UTC.getTime() + 36 * 3600 * 1000);

const CORE_FIELDS = ['height_cm','reach_cm','stance','slpm','str_acc','str_def','td_avg','td_def'];
const ALL_STAT_FIELDS = ['height_cm','reach_cm','stance','slpm','str_acc','sapm','str_def','td_avg','td_acc','td_def','sub_avg'];

async function main() {
  const db = require('../db/index');
  await db.init();

  const events = await db.allRows(
    `SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date ASC LIMIT 1`,
    [TODAY_UTC.toISOString().slice(0,10), CUTOFF_UTC.toISOString().slice(0,10)]
  );

  if (!events || events.length === 0) {
    console.log(JSON.stringify({ status: 'no_imminent_event' }));
    return;
  }

  const event = events[0];
  const eventDate = new Date(event.date + 'T00:00:00Z');
  const hoursUntil = Math.round((eventDate - TODAY_UTC) / 3600000);

  const fighters = await db.allRows(`
    SELECT DISTINCT f.*
    FROM fighters f
    JOIN fights fi ON (fi.red_fighter_id = f.id OR fi.blue_fighter_id = f.id)
    WHERE fi.event_id = ?
  `, [event.id]);

  if (!fighters || fighters.length === 0) {
    console.log(JSON.stringify({ status: 'no_imminent_event', note: 'event found but no fighters on card' }));
    return;
  }

  const gaps = [];
  for (const f of fighters) {
    const hashMissing = !f.ufcstats_hash;
    const missingCore = CORE_FIELDS.filter(field => f[field] == null);
    const missingAll = ALL_STAT_FIELDS.filter(field => f[field] == null);
    const completelyEmpty = missingAll.length >= 6;

    if (hashMissing || missingCore.length > 0) {
      gaps.push({
        id: f.id,
        name: f.name,
        hash_missing: hashMissing,
        core_missing: missingCore,
        completely_empty: completelyEmpty,
        missing_stat_count: missingAll.length
      });
    }
  }

  const severity = gaps.some(g => g.completely_empty) ? 'block' : 'warn';

  console.log(JSON.stringify({
    status: gaps.length > 0 ? 'integrity_violation' : 'all_clear',
    event: { id: event.id, name: event.name, date: event.date, hours_until: hoursUntil },
    fighter_count: fighters.length,
    gaps,
    severity: gaps.length > 0 ? severity : null
  }, null, 2));
}

main().catch(err => {
  process.stderr.write('DB_ERROR: ' + err.message + '\n');
  process.exit(1);
});
