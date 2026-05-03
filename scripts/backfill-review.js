#!/usr/bin/env node
/**
 * scripts/backfill-review.js — interactive review of pending_backfill rows.
 *
 * Usage:
 *   npm run backfill:review
 *   npm run backfill:review -- --auto-approve-cosmetic
 *
 * Each pending row prompts a/r/s/d/q. Approve performs a conditional UPDATE
 * (only writes if the current value still matches what was queued).
 */
const readline = require('readline');
const db = require('../db');
const { approveBackfill, rejectBackfill, parseValue } = require('../data/backfill/review');

function parseArgs(argv) {
  const out = { autoApproveCosmetic: false };
  for (const a of argv.slice(2)) {
    if (a === '--auto-approve-cosmetic') out.autoApproveCosmetic = true;
  }
  return out;
}

function pRun(sql, params) {
  try { return Promise.resolve(db.run(sql, params)); }
  catch (e) { return Promise.reject(e); }
}
function pAllRows(sql, params) {
  try { return Promise.resolve(db.allRows(sql, params)); }
  catch (e) { return Promise.reject(e); }
}
function pOneRow(sql, params) {
  try { return Promise.resolve(db.oneRow(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

function prompt(rl, q) {
  return new Promise(resolve => rl.question(q, ans => resolve(ans.trim().toLowerCase())));
}

async function main() {
  const args = parseArgs(process.argv);
  await db.init();
  const rows = await pAllRows(`SELECT * FROM pending_backfill WHERE status='pending' ORDER BY created_at`);
  if (rows.length === 0) {
    console.log('Queue empty.');
    process.exit(0);
  }

  if (args.autoApproveCosmetic) {
    let applied = 0, skipped = 0;
    for (const r of rows) {
      const cosmetic = r.source === 'ufc-com-athlete' && /_url$/.test(r.column_name);
      if (!cosmetic) { skipped++; continue; }
      const res = await approveBackfill(r.id, { actor: 'cli' });
      if (res.applied) applied++;
      else console.log(`  skip: ${r.table_name}.${r.column_name} id=${r.row_id} (${res.reason})`);
    }
    console.log(`Auto-approved cosmetic: applied=${applied} skipped=${skipped}`);
    process.exit(0);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let i = 0;
  for (const r of rows) {
    i++;
    console.log(`\n[${i} of ${rows.length}] ${r.table_name}.${r.column_name}  id=${r.row_id}`);
    console.log(`  current:  ${r.current_value === null ? 'NULL' : r.current_value}`);
    console.log(`  proposed: ${r.proposed_value}  (source: ${r.source}${r.source_url ? ', ' + r.source_url : ''})`);
    console.log(`  reason:   ${r.reason || ''}`);
    const ans = await prompt(rl, '  [a]pprove  [r]eject  [s]kip  [d]etails  [q]uit: ');
    if (ans === 'q') break;
    if (ans === 's') continue;
    if (ans === 'd') {
      console.log(JSON.stringify({ ...r, source_diff: parseValue(r.source_diff_json) }, null, 2));
      i--;
      continue;
    }
    if (ans === 'a') {
      const res = await approveBackfill(r.id, { actor: 'cli' });
      console.log(res.applied ? '  ✓ applied' : `  ✗ ${res.reason}`);
    }
    if (ans === 'r') {
      await rejectBackfill(r.id, { actor: 'cli' });
      console.log('  ✗ rejected');
    }
  }
  rl.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
