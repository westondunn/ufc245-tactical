#!/usr/bin/env node
/**
 * scripts/rescale-percentage-fields.js
 *
 * The ufcstats fighter parser (data/scrapers/ufcstats-fighter.js) returns
 * accuracy/defense fields as 0..1 fractions, but the rest of the codebase
 * (seed.json, UI, predictions) uses 0..100 percentages. Tonight's
 * link-and-backfill-card-fighters.js write incorrectly stored fractions for
 * many fighters. This script converts any 0 < value < 1 in those columns to
 * 0..100 by multiplying by 100 and rounding.
 *
 * Idempotent: rows already in the 0..100 scale (or =0) are left alone.
 *
 * --dry-run prints what it would do; --apply commits.
 *
 * Scope: only fighters on the given event (default: 102).
 */
const { Pool } = require('pg');

const args = process.argv.slice(2);
const EVENT_ID = parseInt((args.find(a => a.startsWith('--event=')) || '--event=102').split('=')[1], 10);
const APPLY = args.includes('--apply');

const PCT_FIELDS = ['str_acc', 'str_def', 'td_acc', 'td_def'];

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  try {
    const fighters = (await pool.query(`
      SELECT DISTINCT f.id, f.name, f.str_acc, f.str_def, f.td_acc, f.td_def
      FROM fighters f
      JOIN fights fight ON (fight.red_fighter_id = f.id OR fight.blue_fighter_id = f.id)
      WHERE fight.event_id = $1
      ORDER BY f.name
    `, [EVENT_ID])).rows;

    const writes = [];
    for (const f of fighters) {
      // If ANY of the four percentage fields is strictly between 0 and 1,
      // the row is in fraction scale — the parser writes everything in 0..1
      // including the 1.0=100% case, which would otherwise be ambiguous
      // with a literal "1%" in the 0..100 scale.
      const inFractionScale = PCT_FIELDS.some(k => {
        const v = Number(f[k]);
        return f[k] != null && v > 0 && v < 1;
      });
      const updates = {};
      for (const k of PCT_FIELDS) {
        const v = f[k];
        if (v == null) continue;
        const num = Number(v);
        if (num > 0 && num < 1) {
          updates[k] = Math.round(num * 100);
        } else if (inFractionScale && num === 1) {
          // 1.0 in a fraction-scale row means 100%
          updates[k] = 100;
        }
      }
      if (Object.keys(updates).length > 0) {
        const cur = Object.fromEntries(PCT_FIELDS.map(k => [k, f[k]]));
        console.log(`${(APPLY ? '[apply]' : '[dry-run]')} ${f.name.padEnd(28)} id=${String(f.id).padEnd(5)}  ${JSON.stringify(cur)} → ${JSON.stringify({ ...cur, ...updates })}`);
        writes.push({ id: f.id, updates });
      }
    }
    console.log(`\n${writes.length} fighter row(s) need rescaling.`);
    if (!APPLY || writes.length === 0) {
      if (!APPLY) console.log('[dry-run] no writes performed.');
      return;
    }
    let updated = 0;
    for (const w of writes) {
      const keys = Object.keys(w.updates);
      const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
      const params = [...keys.map(k => w.updates[k]), w.id];
      const r = await pool.query(`UPDATE fighters SET ${setClause} WHERE id = $${keys.length + 1}`, params);
      updated += r.rowCount;
    }
    console.log(`Applied ${updated} updates.`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
