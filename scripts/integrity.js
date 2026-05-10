#!/usr/bin/env node
'use strict';
/**
 * scripts/integrity.js — CLI for the data-integrity issue tracker
 *
 * Usage:
 *   npm run integrity scan
 *   npm run integrity list [--category=X] [--severity=Y] [--status=open|resolved]
 *   npm run integrity resolve <id> --resolution=fixed|wont_fix|duplicate [--note=...]
 *   npm run integrity resolve-batch --category=X [--subject-ids=1,2,3]
 *                                   --resolution=fixed|wont_fix|duplicate [--note=...]
 */
const db = require('../db');
const { runIntegrityScan, listIssues, getSummary, resolveOne, resolveBatch } = require('../data/integrity/runner');

function parseArgs(argv) {
  const args = { _: [] };
  for (const a of argv) {
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) args[a.slice(2, eq)] = a.slice(eq + 1);
      else args[a.slice(2)] = true;
    } else {
      args._.push(a);
    }
  }
  return args;
}

function col(str, width) {
  const s = String(str ?? '');
  return s.length >= width ? s.slice(0, width - 1) + '…' : s.padEnd(width);
}

async function cmdScan() {
  console.log('[integrity] running all scanners…');
  const result = await runIntegrityScan();
  console.log(`run_id   : ${result.run_id}`);
  console.log(`opened   : ${result.opened}`);
  console.log(`refreshed: ${result.refreshed}`);
  console.log(`resolved : ${result.resolved}`);
  if (Object.keys(result.by_category).length > 0) {
    console.log('\nBy category:');
    for (const [cat, counts] of Object.entries(result.by_category)) {
      const { opened, refreshed, resolved } = counts;
      if (opened + refreshed + resolved > 0) {
        console.log(`  ${cat.padEnd(32)} opened=${opened} refreshed=${refreshed} resolved=${resolved}`);
      }
    }
  }

  console.log('\nSummary (open issues):');
  const summary = await getSummary();
  const open = summary.filter(r => Number(r.open) > 0);
  if (open.length === 0) {
    console.log('  (none)');
  } else {
    console.log(`  ${'category'.padEnd(32)} ${'sev'.padEnd(6)} ${'open'.padEnd(6)} total`);
    for (const r of open) {
      console.log(`  ${r.category.padEnd(32)} ${String(r.severity).padEnd(6)} ${String(r.open).padEnd(6)} ${r.total}`);
    }
  }
}

async function cmdList(args) {
  const opts = {};
  if (args.category) opts.category = args.category;
  if (args.severity) opts.severity = args.severity;
  if (args.status)   opts.status   = args.status;
  opts.limit  = parseInt(args.limit  || '100', 10);
  opts.offset = parseInt(args.offset || '0',   10);
  const rows = await listIssues(opts);
  if (rows.length === 0) { console.log('(no issues)'); return; }
  console.log(`${'id'.padEnd(6)} ${'sev'.padEnd(5)} ${'category'.padEnd(28)} ${'sub_id'.padEnd(10)} ${'first_seen'.padEnd(20)} details`);
  console.log('-'.repeat(110));
  for (const r of rows) {
    const det = r.details ? String(r.details).slice(0, 40) : '';
    const fs  = String(r.first_seen_at || '').slice(0, 19);
    console.log(`${col(r.id, 6)} ${col(r.severity, 5)} ${col(r.category, 28)} ${col(r.subject_id, 10)} ${col(fs, 20)} ${det}`);
  }
  console.log(`\n${rows.length} issue(s)`);
}

async function cmdResolve(args) {
  const id = parseInt(args._[1], 10);
  if (!Number.isFinite(id)) { console.error('Usage: integrity resolve <id> --resolution=fixed|wont_fix|duplicate'); process.exit(1); }
  const resolution = args.resolution;
  const note = args.note || undefined;
  try {
    const r = await resolveOne(id, { resolution, note });
    console.log(`Resolved issue #${id}: ${JSON.stringify(r)}`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

async function cmdResolveBatch(args) {
  const category   = args.category;
  const resolution = args.resolution;
  const note       = args.note || undefined;
  const subjectIds = args['subject-ids']
    ? String(args['subject-ids']).split(',').map(s => s.trim()).filter(Boolean)
    : undefined;
  try {
    const r = await resolveBatch({ category, subject_ids: subjectIds, resolution, note });
    console.log(`Batch resolved: ${JSON.stringify(r)}`);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

async function main() {
  await db.init();
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  switch (cmd) {
    case 'scan':           await cmdScan();         break;
    case 'list':           await cmdList(args);     break;
    case 'resolve':        await cmdResolve(args);  break;
    case 'resolve-batch':  await cmdResolveBatch(args); break;
    default:
      console.log('Usage: npm run integrity <scan|list|resolve|resolve-batch> [options]');
      process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
