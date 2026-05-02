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

function parseValue(jsonStr) {
  if (jsonStr === null || jsonStr === undefined) return null;
  try { return JSON.parse(jsonStr); } catch { return jsonStr; }
}

async function applyApproved(row) {
  const proposed = parseValue(row.proposed_value);
  const expected = parseValue(row.current_value);

  const r = await pOneRow(
    `SELECT ${row.column_name} AS v FROM ${row.table_name} WHERE id = ?`,
    [row.row_id]
  );
  if (!r) {
    await pRun(`UPDATE pending_backfill SET status='superseded', resolved_at=? WHERE id=?`,
      [new Date().toISOString(), row.id]);
    return { applied: false, reason: 'row no longer exists' };
  }
  const cur = r.v;
  const expectedNorm = expected == null ? null : expected;
  const curNorm = cur == null ? null : cur;
  if (expectedNorm !== curNorm) {
    await pRun(`UPDATE pending_backfill SET status='superseded', resolved_at=? WHERE id=?`,
      [new Date().toISOString(), row.id]);
    return { applied: false, reason: 'current value changed since queue entry' };
  }

  if (cur === null || cur === undefined) {
    await pRun(`UPDATE ${row.table_name} SET ${row.column_name} = ? WHERE id = ? AND ${row.column_name} IS NULL`,
      [proposed, row.row_id]);
  } else {
    await pRun(`UPDATE ${row.table_name} SET ${row.column_name} = ? WHERE id = ? AND ${row.column_name} = ?`,
      [proposed, row.row_id, cur]);
  }
  await pRun(`UPDATE pending_backfill SET status='applied', applied_at=?, resolved_at=? WHERE id=?`,
    [new Date().toISOString(), new Date().toISOString(), row.id]);
  return { applied: true };
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
      const res = await applyApproved(r);
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
      const res = await applyApproved(r);
      console.log(res.applied ? '  ✓ applied' : `  ✗ ${res.reason}`);
    }
    if (ans === 'r') {
      await pRun(`UPDATE pending_backfill SET status='rejected', resolved_at=? WHERE id=?`,
        [new Date().toISOString(), r.id]);
      console.log('  ✗ rejected');
    }
  }
  rl.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
