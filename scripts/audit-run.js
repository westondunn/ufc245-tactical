#!/usr/bin/env node
/**
 * scripts/audit-run.js — manual `npm run audit`.
 *
 * Usage:
 *   npm run audit
 *   npm run audit -- --scope=event:110
 *   npm run audit -- --scope=upcoming-roster
 *   npm run audit -- --json
 */
const db = require('../db');
const { runAudit } = require('../data/audit/runner');

function parseArgs(argv) {
  const out = { scope: null, json: false };
  for (const a of argv.slice(2)) {
    if (a === '--json') out.json = true;
    else if (a.startsWith('--scope=')) out.scope = a.slice('--scope='.length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  await db.init();
  const result = await runAudit({ scope: args.scope, triggerSource: 'cli' });
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log(`\nAudit ${result.run_id} — status=${result.status} duration=${result.duration_ms}ms`);
    console.log(`Snapshots: ${result.summary.length}, errors: ${result.errors.length}`);
    if (result.errors.length) {
      for (const e of result.errors) console.log(`  ERR ${e.table}.${e.column}/${e.scope}: ${e.error}`);
    }
    const sorted = [...result.summary].sort((a, b) => a.coverage_pct - b.coverage_pct).slice(0, 10);
    console.log('\nLowest coverage:');
    for (const s of sorted) {
      const pct = (s.coverage_pct * 100).toFixed(1);
      console.log(`  ${pct}%  ${s.table_name}.${s.column_name}  scope=${s.scope}  (${s.non_null_rows}/${s.total_rows})`);
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
