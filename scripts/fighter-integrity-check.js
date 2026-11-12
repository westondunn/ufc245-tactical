/**
 * Fighter integrity gate — read-only check against production DB.
 * Checks next imminent event (within 36h of now) for missing ufcstats_hash
 * or missing core stats fields.
 */

'use strict';

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('[integrity-gate] FATAL: DATABASE_URL not set');
  process.exit(1);
}

function pgConfig(connectionString) {
  const sslMode = String(process.env.PGSSLMODE || '').toLowerCase();
  const sslEnv = String(process.env.PGSSL || '').toLowerCase();
  const disableSSL = sslMode === 'disable' || sslEnv === 'false' || /sslmode=disable/i.test(connectionString);
  const requireSSL = sslMode === 'require' || sslEnv === 'true' || /sslmode=require/i.test(connectionString);
  const ssl = disableSSL ? false : (requireSSL ? { rejectUnauthorized: false } : undefined);
  return { connectionString, ssl, max: 2 };
}

async function main() {
  const pool = new Pool(pgConfig(DATABASE_URL));

  try {
    // Test connectivity
    await pool.query('SELECT 1');

    const now = new Date();
    const todayUTC = now.toISOString().slice(0, 10);
    const plus36h = new Date(now.getTime() + 36 * 60 * 60 * 1000);
    const plus36hDate = plus36h.toISOString().slice(0, 10);

    // Find next event in [today, today+36h]
    const eventRes = await pool.query(
      `SELECT id, name, date, start_time, timezone
       FROM events
       WHERE date >= $1 AND date <= $2
       ORDER BY date ASC, id ASC
       LIMIT 1`,
      [todayUTC, plus36hDate]
    );

    if (!eventRes.rows.length) {
      console.log(JSON.stringify({ status: 'no_imminent_event', checked_at: now.toISOString() }));
      process.exit(0);
    }

    const event = eventRes.rows[0];
    const eventDate = new Date(event.date + 'T00:00:00Z');
    const hoursUntil = Math.max(0, Math.round((eventDate - now) / (1000 * 60 * 60)));

    // Get all fighters on this event's card
    const fightersRes = await pool.query(
      `SELECT DISTINCT
         f.id,
         f.name,
         f.ufcstats_hash,
         f.height_cm,
         f.reach_cm,
         f.stance,
         f.slpm,
         f.str_acc,
         f.str_def,
         f.td_avg,
         f.td_def,
         f.sapm,
         f.td_acc,
         f.sub_avg
       FROM fights fi
       JOIN fighters f ON f.id = fi.red_fighter_id OR f.id = fi.blue_fighter_id
       WHERE fi.event_id = $1
       ORDER BY f.name ASC`,
      [event.id]
    );

    const fighters = fightersRes.rows;

    if (!fighters.length) {
      console.log(JSON.stringify({ status: 'no_fighters_on_card', event_id: event.id, event_name: event.name }));
      process.exit(0);
    }

    // Core fields per the task spec
    const CORE_FIELDS = ['height_cm', 'reach_cm', 'stance', 'slpm', 'str_acc', 'str_def', 'td_avg', 'td_def'];
    // Extended fields for completely_empty check
    const EXTENDED_FIELDS = ['height_cm', 'reach_cm', 'stance', 'slpm', 'str_acc', 'sapm', 'str_def', 'td_avg', 'td_acc', 'td_def', 'sub_avg'];

    const gaps = [];
    for (const f of fighters) {
      const hashMissing = f.ufcstats_hash == null;
      const missingCore = CORE_FIELDS.filter(col => f[col] == null);
      const coreMissing = missingCore.length > 0;
      const missingExtended = EXTENDED_FIELDS.filter(col => f[col] == null);
      const completelyEmpty = missingExtended.length >= 6;

      if (hashMissing || coreMissing) {
        gaps.push({
          id: f.id,
          name: f.name,
          hash_missing: hashMissing,
          core_missing: coreMissing,
          missing_core_fields: missingCore,
          missing_extended_count: missingExtended.length,
          completely_empty: completelyEmpty,
        });
      }
    }

    const result = {
      event: {
        id: event.id,
        name: event.name,
        date: event.date,
        hours_until: hoursUntil,
      },
      total_fighters: fighters.length,
      fighters_with_gaps: gaps.length,
      has_completely_empty: gaps.some(g => g.completely_empty),
      gaps,
    };

    if (gaps.length === 0) {
      result.status = 'all_clear';
      console.log(JSON.stringify(result));
      process.exit(0);
    }

    result.status = 'integrity_violation';
    result.severity = result.has_completely_empty ? 'block' : 'warn';
    console.log(JSON.stringify(result));
    process.exit(2); // exit 2 = violations found (not an error)

  } catch (err) {
    console.error('[integrity-gate] DB error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
