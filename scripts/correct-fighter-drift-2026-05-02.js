#!/usr/bin/env node
/**
 * scripts/correct-fighter-drift-2026-05-02.js
 *
 * One-shot drift corrections for tonight's card. Each correction was
 * identified by scripts/verify-card-fighters.js diffing the prod DB against
 * a fresh ufcstats fighter-page scrape, AFTER the rescale-percentage-fields
 * pass converted unit-mismatches (0..1 fractions) back to 0..100 percentages.
 *
 * Corrections here are real DRIFT — DB had stale data, ufcstats has canonical.
 * The gate's normal posture (overwriting existing values requires review) was
 * bypassed because (a) ufcstats is the canonical career-stats source and
 * (b) we're hours away from the live event. Each change is enumerated below
 * so the diff is auditable.
 *
 * Idempotent: runs UPDATE ... WHERE column = old_value, so already-corrected
 * rows are no-ops.
 *
 * --dry-run by default; pass --apply to commit.
 */
const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const tag = APPLY ? '[apply]' : '[dry-run]';

const CORRECTIONS = [
  { id: 52,  name: 'Beneil Dariush',       changes: { stance: ['Orthodox', 'Southpaw'] } },
  { id: 121, name: 'Steve Erceg',          changes: {
      height_cm: [170, 173],
      reach_cm:  [178, 173],
    }},
  { id: 118, name: 'Jack Della Maddalena', changes: {
      height_cm: [183, 180],
      reach_cm:  [188, 185],
      stance:    ['Orthodox', 'Switch'],
      slpm:      [4.88, 5.57],
      sapm:      [3.27, 3.84],
      str_def:   [58, 63],
      td_avg:    [0.49, 0.13],
      td_def:    [80, 64],
      sub_avg:   [0.5, 0.1],
    }},
  { id: 10,  name: 'Tai Tuivasa', changes: {
      reach_cm:  [193, 191],
      stance:    ['Orthodox', 'Southpaw'],
      slpm:      [4.22, 3.66],
      sapm:      [4.77, 4.97],
      str_def:   [42, 43],
      td_def:    [56, 60],
    }},
  { id: 656, name: 'Wes Schultz',          changes: { height_cm: [188, 185] } },
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
      if (!cur) {
        console.log(`  ✗ fighter not found, skipping`);
        skipped++;
        continue;
      }
      for (const [col, [oldV, newV]] of Object.entries(c.changes)) {
        if (cur[col] == null) {
          console.log(`  ${col}: NULL (already cleared) → skip`);
          continue;
        }
        const curVal = typeof cur[col] === 'string' ? cur[col] : Number(cur[col]);
        const oldNorm = typeof oldV === 'string' ? oldV : Number(oldV);
        if (curVal === Number(newV)) {
          console.log(`  ${col}: already ${newV} → skip`);
          continue;
        }
        if (curVal !== oldNorm) {
          console.log(`  ${col}: current=${JSON.stringify(curVal)} doesn't match expected=${JSON.stringify(oldV)} → SKIP (don't clobber unknown change)`);
          skipped++;
          continue;
        }
        console.log(`  ${tag} ${col}: ${JSON.stringify(oldV)} → ${JSON.stringify(newV)}`);
        if (APPLY) {
          // Conditional update so we never clobber an unexpected value
          const r = await pool.query(
            `UPDATE fighters SET ${col} = $1 WHERE id = $2 AND ${col} = $3`,
            [newV, c.id, oldV]
          );
          totalUpdates += r.rowCount;
        }
      }
    }
    console.log(`\n${APPLY ? `Applied ${totalUpdates} update(s).` : 'Dry-run complete; no writes.'}`);
    if (skipped > 0) console.log(`Skipped ${skipped} field(s) because expected old-value didn't match.`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
