#!/usr/bin/env node
/**
 * scripts/link-and-backfill-card-fighters.js
 *
 * For every fighter on a given event:
 *   1. If ufcstats_hash is missing, search ufcstats by name. If exactly one
 *      strong-match candidate is found, propose linking the hash. Ambiguous
 *      matches (multiple candidates, or zero) are flagged and SKIPPED.
 *   2. If ufcstats_hash is now known (pre-existing or just linked), fetch the
 *      fighter profile page and propose field-by-field backfills for any
 *      missing-or-drifted physical / career-stat fields.
 *
 * Idempotent + dry-run by default. Pass --apply to actually write.
 *
 * Usage:
 *   $env:DATABASE_URL = ...
 *   $env:PGSSLMODE = 'require'
 *   node scripts/link-and-backfill-card-fighters.js --event=102 --dry-run
 *   node scripts/link-and-backfill-card-fighters.js --event=102 --apply
 *
 * Polite to ufcstats.com: 1 s between requests.
 */
const { Pool } = require('pg');
const cheerio = require('cheerio');
const { parseFighterPage } = require('../data/scrapers/ufcstats-fighter');

const args = process.argv.slice(2);
const EVENT_ID = parseInt((args.find(a => a.startsWith('--event=')) || '--event=102').split('=')[1], 10);
const APPLY = args.includes('--apply');
const log = (...a) => console.log(APPLY ? '[apply]' : '[dry-run]', ...a);

// Fields we'll write when missing. Skip overwrites when current value is set
// (gap-fill only — same posture as data/backfill/gate.js 'safe' class).
const BACKFILL_FIELDS = [
  'height_cm', 'reach_cm', 'stance', 'dob',
  'slpm', 'str_acc', 'sapm', 'str_def',
  'td_avg', 'td_acc', 'td_def', 'sub_avg',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const isMissing = v => v === null || v === undefined || v === '';

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'UFC-Tactical-Dashboard/2.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

function normalizeName(s) {
  // NFD-decompose so combining marks (diacritics) split into base+mark, then
  // strip the marks. Catches "Peričić" ↔ "Pericic" without the matcher caring.
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function searchUfcstats(name) {
  // The search endpoint only matches a single token. Use the last token of
  // the name (almost always the most distinctive — surname). Caller then
  // filters by full-name match.
  const tokens = String(name || '').split(/\s+/).filter(Boolean);
  const lastToken = tokens[tokens.length - 1] || name;
  const q = encodeURIComponent(lastToken);
  const html = await fetchHtml(`http://ufcstats.com/statistics/fighters/search?query=${q}`);
  const $ = cheerio.load(html);
  const candidates = [];
  $('tr.b-statistics__table-row').each((_, row) => {
    const cells = $(row).find('td.b-statistics__table-col');
    if (cells.length < 2) return;
    const linkEl = $(row).find('a.b-link').first();
    const href = linkEl.attr('href') || '';
    const m = href.match(/fighter-details\/([a-f0-9]{16})/);
    if (!m) return;
    const hash = m[1];
    const first = $(cells[0]).text().trim();
    const last = $(cells[1]).text().trim();
    const fullName = `${first} ${last}`.replace(/\s+/g, ' ').trim();
    if (fullName.length < 2) return;  // skip the header row's empty cells
    candidates.push({ hash, name: fullName });
  });
  // Dedupe by hash.
  const seen = new Set();
  return candidates.filter(c => seen.has(c.hash) ? false : (seen.add(c.hash), true));
}

function pickStrongMatch(candidates, queryName) {
  const target = normalizeName(queryName);
  // Strong match: exact normalized-name match. Otherwise return null.
  const exact = candidates.filter(c => normalizeName(c.name) === target);
  if (exact.length === 1) return { match: exact[0], reason: 'exact-name' };
  if (exact.length > 1) return { match: null, reason: `${exact.length} exact-name candidates` };
  return { match: null, reason: candidates.length === 0 ? 'no candidates' : `${candidates.length} non-exact candidates` };
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('ERROR: DATABASE_URL required.'); process.exit(2); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  try {
    const fightersRes = await pool.query(`
      SELECT DISTINCT f.*
      FROM fighters f
      JOIN fights fight ON (fight.red_fighter_id = f.id OR fight.blue_fighter_id = f.id)
      WHERE fight.event_id = $1
      ORDER BY f.name
    `, [EVENT_ID]);
    const fighters = fightersRes.rows;
    console.log(`\n=== Event ${EVENT_ID}: ${fighters.length} fighter(s) ===\n`);

    let linked = 0, ambiguous = 0, profileBackfilled = 0, noHash = 0;
    const proposedWrites = [];

    for (const f of fighters) {
      let hash = f.ufcstats_hash;

      // ── Step 1: link if missing ──
      if (!hash) {
        let candidates;
        try { candidates = await searchUfcstats(f.name); }
        catch (e) {
          console.log(`${f.name.padEnd(28)}  search failed: ${e.message}`);
          noHash++;
          await sleep(1000);
          continue;
        }
        const { match, reason } = pickStrongMatch(candidates, f.name);
        if (!match) {
          console.log(`${f.name.padEnd(28)}  no strong match (${reason}; candidates: ${candidates.map(c => c.name).join(', ') || 'none'})`);
          ambiguous++;
          await sleep(1000);
          continue;
        }
        log(`link ${f.name} (id ${f.id}) → ufcstats_hash ${match.hash}`);
        proposedWrites.push({
          sql: `UPDATE fighters SET ufcstats_hash = $1 WHERE id = $2 AND ufcstats_hash IS NULL`,
          params: [match.hash, f.id],
        });
        hash = match.hash;
        linked++;
        await sleep(1000);
      }

      // ── Step 2: backfill from profile ──
      let profile;
      try {
        const html = await fetchHtml(`http://ufcstats.com/fighter-details/${hash}`);
        profile = parseFighterPage(html, hash);
      } catch (e) {
        console.log(`${f.name.padEnd(28)}  profile fetch failed: ${e.message}`);
        await sleep(1000);
        continue;
      }
      const updates = {};
      for (const k of BACKFILL_FIELDS) {
        if (isMissing(f[k]) && !isMissing(profile[k])) updates[k] = profile[k];
      }
      const keys = Object.keys(updates);
      if (keys.length > 0) {
        log(`backfill ${f.name} (id ${f.id}): ${keys.map(k => `${k}=${JSON.stringify(updates[k])}`).join(', ')}`);
        const setClauses = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
        const conditions = keys.map(k => `${k} IS NULL`).join(' AND ');
        proposedWrites.push({
          sql: `UPDATE fighters SET ${setClauses} WHERE id = $${keys.length + 1} AND (${conditions})`,
          params: [...keys.map(k => updates[k]), f.id],
        });
        profileBackfilled++;
      } else {
        console.log(`${f.name.padEnd(28)}  ✓ no backfill needed`);
      }
      await sleep(1000);
    }

    console.log(`\n=== Summary ===`);
    console.log(`Fighters: ${fighters.length}`);
    console.log(`Newly linkable hashes: ${linked}`);
    console.log(`Profile backfills proposed: ${profileBackfilled}`);
    console.log(`Ambiguous / no-match (skipped): ${ambiguous}`);
    console.log(`Other no-hash (search failed): ${noHash}`);
    console.log(`Total writes proposed: ${proposedWrites.length}`);

    if (!APPLY) {
      console.log('\n[dry-run] no writes performed. Re-run with --apply to commit.');
      return;
    }

    if (proposedWrites.length === 0) {
      console.log('\nNothing to write.');
      return;
    }
    let writes = 0;
    for (const w of proposedWrites) {
      const res = await pool.query(w.sql, w.params);
      writes += res.rowCount;
    }
    console.log(`\nApplied ${writes} row updates.`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
