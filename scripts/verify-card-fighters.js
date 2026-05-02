#!/usr/bin/env node
/**
 * scripts/verify-card-fighters.js
 *
 * Read-only audit of every fighter on a given event's card. For each fighter
 * it (a) prints completeness gaps in the DB, then (b) when the fighter has a
 * ufcstats_hash, re-scrapes the ufcstats fighter page and diffs the
 * career-stat / physical fields against the DB row.
 *
 * Usage:
 *   $env:DATABASE_URL = ...
 *   $env:PGSSLMODE = 'require'
 *   node scripts/verify-card-fighters.js --event=102
 *   node scripts/verify-card-fighters.js --event=102 --no-scrape   # DB-only check
 *
 * Polite to ufcstats.com — 1 s delay between scrapes (~30 s for a 13-fight card).
 *
 * Writes nothing. Reports drift; you decide what to fix.
 */
const { Pool } = require('pg');
const { parseFighterPage } = require('../data/scrapers/ufcstats-fighter');

const args = process.argv.slice(2);
const EVENT_ID = parseInt((args.find(a => a.startsWith('--event=')) || '--event=102').split('=')[1], 10);
const NO_SCRAPE = args.includes('--no-scrape');

const FIGHTER_FIELDS = [
  'name', 'nickname', 'height_cm', 'reach_cm', 'stance', 'weight_class',
  'nationality', 'dob', 'slpm', 'str_acc', 'sapm', 'str_def',
  'td_avg', 'td_acc', 'td_def', 'sub_avg', 'headshot_url', 'body_url',
  'ufcstats_hash',
];
const CORE_FIELDS = ['height_cm', 'reach_cm', 'stance', 'slpm', 'str_acc', 'str_def', 'td_avg', 'td_def'];
// DB stores accuracy/defense as 0..100 percentages (per seed.json convention);
// the ufcstats parser returns 0..1 fractions. Multiply scraped → 0..100 to
// compare apples-to-apples.
const PCT_FIELDS_SCRAPED_FRACTION = new Set(['str_acc', 'str_def', 'td_acc', 'td_def']);
const DRIFT_TOLERANCE = {
  slpm: 0.1, sapm: 0.1, td_avg: 0.1, sub_avg: 0.1,
  str_acc: 2, str_def: 2, td_acc: 3, td_def: 3,  // 0..100 scale, ±2-3 pp
  height_cm: 1, reach_cm: 1,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isMissing(v) { return v === null || v === undefined || v === ''; }

function diffField(name, dbVal, scrapedVal) {
  if (isMissing(scrapedVal)) return null;
  if (isMissing(dbVal)) return { kind: 'missing', db: dbVal, scraped: scrapedVal };
  // Unit-normalize: parser returns fractions for percentage fields; DB stores 0..100.
  let scrapedNorm = scrapedVal;
  if (PCT_FIELDS_SCRAPED_FRACTION.has(name) && typeof scrapedVal === 'number') {
    scrapedNorm = Math.round(scrapedVal * 100);
  }
  const dbNum = Number(dbVal);
  if (typeof dbNum === 'number' && !isNaN(dbNum) && typeof scrapedNorm === 'number') {
    const tol = DRIFT_TOLERANCE[name] || 0.001;
    if (Math.abs(dbNum - scrapedNorm) > tol) return { kind: 'drift', db: dbVal, scraped: scrapedNorm };
    return null;
  }
  if (String(dbVal).toLowerCase() === String(scrapedNorm).toLowerCase()) return null;
  return { kind: 'mismatch', db: dbVal, scraped: scrapedNorm };
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('ERROR: DATABASE_URL required.'); process.exit(2); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    // Pull every fighter on the event
    const fightersRes = await pool.query(`
      SELECT DISTINCT f.*
      FROM fighters f
      JOIN fights fight ON (fight.red_fighter_id = f.id OR fight.blue_fighter_id = f.id)
      WHERE fight.event_id = $1
      ORDER BY f.name
    `, [EVENT_ID]);
    const fighters = fightersRes.rows;

    console.log(`\n=== Event ${EVENT_ID}: ${fighters.length} fighter(s) on card ===\n`);

    const issues = [];

    for (const f of fighters) {
      const missing = CORE_FIELDS.filter(k => isMissing(f[k]));
      const allMissing = FIGHTER_FIELDS.filter(k => isMissing(f[k]));
      const status = missing.length === 0 ? 'OK' : `missing ${missing.length}/${CORE_FIELDS.length} core`;
      console.log(`${f.name.padEnd(28)}  id=${String(f.id).padEnd(5)}  hash=${f.ufcstats_hash || '—'.padEnd(16)}  ${status}`);
      if (allMissing.length > 0) {
        console.log(`    missing: ${allMissing.join(', ')}`);
      }
      if (missing.length > 0) {
        issues.push({ id: f.id, name: f.name, kind: 'missing_core', fields: missing });
      }
      if (!f.ufcstats_hash) {
        console.log(`    ⚠ no ufcstats_hash — can't verify career stats`);
        issues.push({ id: f.id, name: f.name, kind: 'no_ufcstats_hash' });
      }
    }

    if (NO_SCRAPE) {
      console.log('\n[--no-scrape] DB-only check complete.');
      summarize(issues);
      return;
    }

    // Scrape and diff for fighters with a hash
    console.log(`\n=== Scraping ufcstats for fighters with ufcstats_hash (1s delay between) ===\n`);
    const withHash = fighters.filter(f => f.ufcstats_hash);
    for (const f of withHash) {
      const url = `http://ufcstats.com/fighter-details/${f.ufcstats_hash}`;
      let html;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'UFC-Tactical-Dashboard/2.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        html = await res.text();
      } catch (e) {
        console.log(`${f.name.padEnd(28)}  SCRAPE FAILED: ${e.message}`);
        issues.push({ id: f.id, name: f.name, kind: 'scrape_failed', error: e.message });
        await sleep(1000);
        continue;
      }
      const scraped = parseFighterPage(html, f.ufcstats_hash);
      const diffs = {};
      const compareFields = ['name', 'height_cm', 'reach_cm', 'stance', 'dob',
                             'slpm', 'str_acc', 'sapm', 'str_def',
                             'td_avg', 'td_acc', 'td_def', 'sub_avg'];
      for (const k of compareFields) {
        const d = diffField(k, f[k], scraped[k]);
        if (d) diffs[k] = d;
      }
      const driftKeys = Object.keys(diffs);
      if (driftKeys.length === 0) {
        console.log(`${f.name.padEnd(28)}  ✓ matches ufcstats`);
      } else {
        console.log(`${f.name.padEnd(28)}  ⚠ ${driftKeys.length} field(s) differ:`);
        for (const k of driftKeys) {
          const d = diffs[k];
          console.log(`    ${k}: db=${JSON.stringify(d.db)}  →  ufcstats=${JSON.stringify(d.scraped)}  [${d.kind}]`);
        }
        issues.push({ id: f.id, name: f.name, kind: 'drift', diffs });
      }
      await sleep(1000);
    }

    summarize(issues);
  } finally {
    await pool.end();
  }
}

function summarize(issues) {
  console.log(`\n=== Summary ===`);
  console.log(`Total issues: ${issues.length}`);
  const byKind = {};
  for (const i of issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
  for (const [k, n] of Object.entries(byKind)) console.log(`  ${k}: ${n}`);
}

main().catch(e => { console.error(e); process.exit(1); });
