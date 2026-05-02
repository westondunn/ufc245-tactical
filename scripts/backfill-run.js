#!/usr/bin/env node
/**
 * scripts/backfill-run.js
 *
 * Usage:
 *   npm run backfill                 # dispatch latest audit run
 *   npm run backfill -- --dry-run    # log decisions without writing
 *   npm run backfill -- --run=<id>   # use a specific audit run_id
 */
const db = require('../db');
const { runBackfill } = require('../data/backfill/dispatcher');
const auditApi = require('../data/audit/api');

function parseArgs(argv) {
  const out = { run: null, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--run=')) out.run = a.slice('--run='.length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  await db.init();
  let runId = args.run;
  if (!runId) runId = await auditApi.getLatestCompleteRunId();
  if (!runId) {
    console.error('No audit run found. Run `npm run audit` first.');
    process.exit(2);
  }
  console.log(`Backfilling against run_id=${runId} dry_run=${args.dryRun}`);
  const result = await runBackfill({ runId, dryRun: args.dryRun });
  console.log(`\nBackfill: auto=${result.auto} queued=${result.queued} rejected=${result.rejected} errors=${result.errors.length}`);
  for (const e of result.errors) {
    console.log(`  ERR ${e.gap.table}.${e.gap.column} id=${e.gap.row_id}: ${e.error}`);
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
