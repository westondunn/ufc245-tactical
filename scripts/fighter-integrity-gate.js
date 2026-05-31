'use strict';
/**
 * Fighter integrity gate — read-only DB check before live events.
 * Exits 0 with status 'no_imminent_event' or 'all_clear', non-zero on error.
 * On violations: prints JSON result to stdout for the caller to act on.
 */

async function main() {
  let rows, eventRow;
  const CORE = ['height_cm','reach_cm','stance','slpm','str_acc','str_def','td_avg','td_def'];
  const ALL11 = ['height_cm','reach_cm','stance','slpm','str_acc','sapm','str_def','td_avg','td_acc','td_def','sub_avg'];

  const now = new Date();
  const plus36h = new Date(now.getTime() + 36 * 60 * 60 * 1000);
  const todayStr = now.toISOString().split('T')[0];
  const plus36Str = plus36h.toISOString().split('T')[0];

  if (process.env.DATABASE_URL) {
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    console.error(`[integrity-gate] PostgreSQL connected; window ${todayStr} → ${plus36Str}`);

    const evtRes = await client.query(
      `SELECT id, name, date FROM events WHERE date >= $1 AND date <= $2 ORDER BY date ASC LIMIT 1`,
      [todayStr, plus36Str]
    );
    if (evtRes.rows.length === 0) {
      console.log(JSON.stringify({ status: 'no_imminent_event' }));
      await client.end(); return;
    }
    eventRow = evtRes.rows[0];
    const fightersRes = await client.query(`
      SELECT DISTINCT f.id, f.name, f.ufcstats_hash,
        f.height_cm, f.reach_cm, f.stance,
        f.slpm, f.str_acc, f.str_def, f.td_avg, f.td_def,
        f.sapm, f.td_acc, f.sub_avg
      FROM fights fi
      JOIN fighters f ON f.id = fi.red_fighter_id OR f.id = fi.blue_fighter_id
      WHERE fi.event_id = $1
      ORDER BY f.name
    `, [eventRow.id]);
    rows = fightersRes.rows;
    await client.end();

  } else {
    // SQLite fallback via project db module
    console.error(`[integrity-gate] No DATABASE_URL; using in-memory SQLite (seed data); window ${todayStr} → ${plus36Str}`);
    const { init, oneRow, allRows } = require('../db/sqlite.js');
    await init();

    eventRow = oneRow(
      `SELECT id, name, date FROM events WHERE date >= ? AND date <= ? ORDER BY date ASC LIMIT 1`,
      [todayStr, plus36Str]
    );
    if (!eventRow) {
      console.log(JSON.stringify({ status: 'no_imminent_event', note: 'seed data — no DATABASE_URL set' }));
      return;
    }

    rows = allRows(`
      SELECT DISTINCT f.id, f.name, f.ufcstats_hash,
        f.height_cm, f.reach_cm, f.stance,
        f.slpm, f.str_acc, f.str_def, f.td_avg, f.td_def,
        f.sapm, f.td_acc, f.sub_avg
      FROM fights fi
      JOIN fighters f ON f.id = fi.red_fighter_id OR f.id = fi.blue_fighter_id
      WHERE fi.event_id = ?
      ORDER BY f.name
    `, [eventRow.id]);
  }

  console.error(`[integrity-gate] Event: "${eventRow.name}" (${eventRow.date}), fighters on card: ${rows.length}`);

  const gaps = [];
  for (const f of rows) {
    const hash_missing = !f.ufcstats_hash;
    const missing_core = CORE.filter(c => f[c] === null || f[c] === undefined || f[c] === '');
    const missing_all11 = ALL11.filter(c => f[c] === null || f[c] === undefined || f[c] === '');
    const core_missing = missing_core.length > 0;
    const completely_empty = missing_all11.length >= 6;
    if (hash_missing || core_missing) {
      gaps.push({ id: f.id, name: f.name, hash_missing, core_missing_fields: missing_core, completely_empty });
    }
  }

  const eventDate = new Date(eventRow.date + 'T00:00:00Z');
  const hoursUntil = Math.round((eventDate - now) / 3600000);
  const hasSeed = !process.env.DATABASE_URL;

  const result = {
    status: gaps.length > 0 ? 'integrity_violation' : 'all_clear',
    event: { id: eventRow.id, name: eventRow.name, date: eventRow.date, hours_until: hoursUntil },
    fighters_checked: rows.length,
    gaps,
    severity: gaps.some(g => g.completely_empty) ? 'block' : gaps.length > 0 ? 'warn' : null,
    db_source: hasSeed ? 'seed_sqlite_no_database_url' : 'postgresql'
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(e => {
  console.error('[integrity-gate] FATAL:', e.message, e.stack);
  process.exit(1);
});
