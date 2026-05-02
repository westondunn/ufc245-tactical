#!/usr/bin/env node
/**
 * scripts/correct-fighter-drift-2026-05-09.js
 *
 * Drift corrections for event 103 (Chimaev vs Strickland, 2026-05-09)
 * identified by verify-card-fighters.js diffing the prod DB against ufcstats
 * after the rescale pass. ufcstats is canonical for career stats; these are
 * legitimate updates following the fighters' most recent bouts.
 *
 * --dry-run by default; pass --apply to commit.
 */
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const tag = APPLY ? '[apply]' : '[dry-run]';

const CORRECTIONS = [
  { id: 5,  name: 'Alexander Volkov', changes: {
      slpm:    [3.72, 4.78],
      str_acc: [46,   57],
      sapm:    [3.52, 2.86],
      str_def: [56,   53],
      td_avg:  [0.25, 0.57],
      td_acc:  [28,   66],
    }},
  { id: 116, name: 'Khamzat Chimaev', changes: {
      slpm:    [4.35, 4.04],
      sapm:    [2.17, 2.32],
      str_def: [62,   43],
      td_acc:  [62,   55],
      td_def:  [92,   85],
      sub_avg: [1.3,  1.8],
    }},
  { id: 28,  name: 'Sean Strickland', changes: {
      slpm:    [5.78, 6.04],
      str_acc: [47,   42],
      sapm:    [4.72, 4.57],
      td_acc:  [50,   64],
      sub_avg: [0,    0.2],
    }},
  { id: 659, name: 'Joel Álvarez', changes: {
      height_cm: [188, 191],
    }},
];

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  try {
    let totalUpdates = 0, skipped = 0;
    for (const c of CORRECTIONS) {
      console.log(`\n${c.name} (id ${c.id}):`);
      const cur = (await pool.query('SELECT * FROM fighters WHERE id = $1', [c.id])).rows[0];
      if (!cur) { console.log(`  ✗ not found`); skipped++; continue; }
      for (const [col, [oldV, newV]] of Object.entries(c.changes)) {
        const curVal = typeof cur[col] === 'string' ? cur[col] : Number(cur[col]);
        const oldNorm = typeof oldV === 'string' ? oldV : Number(oldV);
        if (curVal === Number(newV)) { console.log(`  ${col}: already ${newV} → skip`); continue; }
        if (curVal !== oldNorm) {
          console.log(`  ${col}: current=${JSON.stringify(curVal)} doesn't match expected=${JSON.stringify(oldV)} → SKIP`);
          skipped++;
          continue;
        }
        console.log(`  ${tag} ${col}: ${JSON.stringify(oldV)} → ${JSON.stringify(newV)}`);
        if (APPLY) {
          const r = await pool.query(
            `UPDATE fighters SET ${col} = $1 WHERE id = $2 AND ${col} = $3`,
            [newV, c.id, oldV]
          );
          totalUpdates += r.rowCount;
        }
      }
    }
    console.log(`\n${APPLY ? `Applied ${totalUpdates} update(s).` : 'Dry-run complete.'}`);
    if (skipped > 0) console.log(`Skipped ${skipped} field(s).`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
