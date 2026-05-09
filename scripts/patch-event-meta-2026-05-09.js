#!/usr/bin/env node
/**
 * scripts/patch-event-meta-2026-05-09.js
 *
 * Tonight (UFC 328 / event 103) audit found two display-layer data bugs in prod:
 *   1. Recent scraper concatenated venue into `city` and state into `country`
 *      for events 103/104/106. Repair to clean values.
 *   2. Two title fights on event 103 have " Title" appended to `weight_class`
 *      (and a few historical fights do too). The `is_title` flag already
 *      carries that meaning, so strip the suffix.
 *
 * --dry-run by default; pass --apply to commit.
 */
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const tag = APPLY ? '[apply]' : '[dry-run]';

// (id, expected_city, expected_country, new_city, new_country)
const EVENT_FIXES = [
  { id: 103, city: ['Prudential Center Newark',  'Newark'],
              country: ['NJ United States',       'United States'] },
  { id: 104, city: ['Meta APEX Las Vegas',        'Las Vegas'],
              country: ['NV United States',       'United States'] },
  { id: 105, city: ['Galaxy Arena Macao',         'Macao'],
              country: [null,                     'China'] },
  { id: 106, city: ['Meta APEX Las Vegas',        'Las Vegas'],
              country: ['NV United States',       'United States'] },
];

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  let updates = 0, skipped = 0;
  try {
    console.log('=== A. Event city/country fixes ===');
    for (const e of EVENT_FIXES) {
      const cur = (await pool.query('SELECT id,name,city,country FROM events WHERE id=$1', [e.id])).rows[0];
      if (!cur) { console.log(`  event ${e.id}: not found → skip`); skipped++; continue; }
      console.log(`\n  event ${e.id} (${cur.name}):`);
      for (const col of ['city', 'country']) {
        const [oldV, newV] = e[col];
        if (cur[col] === newV) { console.log(`    ${col}: already ${JSON.stringify(newV)} → skip`); continue; }
        if (cur[col] !== oldV) {
          console.log(`    ${col}: current=${JSON.stringify(cur[col])} doesn't match expected=${JSON.stringify(oldV)} → SKIP`);
          skipped++;
          continue;
        }
        console.log(`    ${tag} ${col}: ${JSON.stringify(oldV)} → ${JSON.stringify(newV)}`);
        if (APPLY) {
          // Use IS NOT DISTINCT FROM so NULL old-values match correctly.
          const r = await pool.query(
            `UPDATE events SET ${col} = $1 WHERE id = $2 AND ${col} IS NOT DISTINCT FROM $3`,
            [newV, e.id, oldV]
          );
          updates += r.rowCount;
        }
      }
    }

    console.log('\n=== B. Strip " Title" suffix from fights.weight_class ===');
    const dirty = await pool.query(
      `SELECT id, event_id, red_name, blue_name, weight_class, is_title
         FROM fights
        WHERE (weight_class LIKE '% Title' OR weight_class LIKE '% Interim Title')
          AND weight_class NOT LIKE 'BMF%'
        ORDER BY event_id DESC, card_position DESC NULLS LAST`
    );
    for (const r of dirty.rows) {
      // Strip trailing " Title" or " Interim Title".
      const cleaned = r.weight_class
        .replace(/\s+Interim Title\s*$/i, '')
        .replace(/\s+Title\s*$/i, '');
      console.log(`  fight ${r.id} (event ${r.event_id}, ${r.red_name} vs ${r.blue_name}):`);
      console.log(`    ${tag} weight_class: ${JSON.stringify(r.weight_class)} → ${JSON.stringify(cleaned)}  (is_title=${r.is_title})`);
      if (APPLY) {
        const u = await pool.query(
          `UPDATE fights SET weight_class = $1 WHERE id = $2 AND weight_class = $3`,
          [cleaned, r.id, r.weight_class]
        );
        updates += u.rowCount;
      }
    }

    console.log(`\n${APPLY ? `Applied ${updates} update(s).` : 'Dry-run complete.'}`);
    if (skipped > 0) console.log(`Skipped ${skipped}.`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
