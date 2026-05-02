#!/usr/bin/env node
/**
 * scripts/backfill-fighter-nationality.js
 *
 * Backfills fighters.nationality where it's NULL. Two strategies tried in order:
 *   1. ufc.com athlete page → parse .c-bio__field for "Place of Birth" /
 *      "Hometown" / "Fights Out Of", split on ", " and take the country tail.
 *   2. (planned) wiki fallback — not yet implemented; flagged but skipped.
 *
 * Slug is derived from the fighter name (lowercase, NFD-stripped,
 * non-alphanumeric → "-"). UFC.com uses that exact convention. Returns 404 →
 * skip. Returns a real page but no recognisable bio field → skip.
 *
 * Idempotent + dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   $env:DATABASE_URL = '...'
 *   $env:PGSSLMODE = 'require'
 *   node scripts/backfill-fighter-nationality.js --event=102 --dry-run
 *   node scripts/backfill-fighter-nationality.js --event=102 --apply
 *   node scripts/backfill-fighter-nationality.js --all --apply       # ALL fighters with NULL nationality
 *
 * Polite to ufc.com: 1 s between requests.
 */
const { Pool } = require('pg');
const cheerio = require('cheerio');
const { fetchPage } = require('../data/scrapers/http');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL = args.includes('--all');
const eventArg = args.find(a => a.startsWith('--event='));
const EVENT_ID = eventArg ? parseInt(eventArg.split('=')[1], 10) : null;
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : 0; })();

if (!ALL && !EVENT_ID) {
  console.error('Specify --event=<id> or --all');
  process.exit(2);
}

const log = (...a) => console.log(APPLY ? '[apply]' : '[dry-run]', ...a);

function slugify(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// "Brisbane, Australia" → "Australia"; "Coconut Creek, FL, USA" → "USA"
// "Brazil" → "Brazil". Stripping leading commas and trailing whitespace.
function lastCommaToken(s) {
  if (!s) return null;
  const parts = String(s).split(',').map(p => p.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

// Map common variants to canonical country names matched by flags.js.
const NORMALIZE = new Map([
  ['usa', 'United States'], ['u.s.a.', 'United States'], ['us', 'United States'],
  ['uk', 'United Kingdom'], ['great britain', 'United Kingdom'],
  ['england', 'England'], ['scotland', 'Scotland'], ['wales', 'Wales'],
  ['northern ireland', 'Northern Ireland'],
]);

function normalizeCountry(s) {
  if (!s) return null;
  const k = s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (NORMALIZE.has(k)) return NORMALIZE.get(k);
  return s.trim();
}

function parseAthletePageForCountry(html) {
  const $ = cheerio.load(html);
  // Preferred order — these labels appear on most ufc.com athlete pages.
  const wanted = ['place of birth', 'hometown', 'fights out of', 'born', 'birthplace'];
  const found = {};
  $('.c-bio__field').each((_, el) => {
    const label = $(el).find('.c-bio__label').text().replace(/\s+/g, ' ').trim().toLowerCase();
    const value = $(el).find('.c-bio__text').text().replace(/\s+/g, ' ').trim();
    if (!label || !value) return;
    if (wanted.includes(label)) found[label] = value;
  });
  for (const k of wanted) {
    if (found[k]) {
      const country = lastCommaToken(found[k]);
      if (country) return { country: normalizeCountry(country), source_label: k, raw: found[k] };
    }
  }
  return null;
}

async function fetchOnce(url) {
  try {
    return await fetchPage(url, { retries: 1, delayMs: 1000 });
  } catch (e) {
    if (String(e.message).includes('HTTP 404')) return null;
    throw e;
  }
}

async function resolveCountryFor(name) {
  const slug = slugify(name);
  if (!slug) return { country: null, reason: 'empty-slug' };
  const url = `https://www.ufc.com/athlete/${slug}`;
  const html = await fetchOnce(url);
  if (!html) return { country: null, reason: '404', url };
  const parsed = parseAthletePageForCountry(html);
  if (!parsed) return { country: null, reason: 'no-bio-field', url };
  return { country: parsed.country, reason: 'ok', url, source_label: parsed.source_label, raw: parsed.raw };
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  let rows;
  if (EVENT_ID) {
    const q = `
      SELECT DISTINCT f.id, f.name, f.nationality
      FROM fighters f
      JOIN fights ft ON (ft.red_fighter_id = f.id OR ft.blue_fighter_id = f.id)
      WHERE ft.event_id = $1
        AND (f.nationality IS NULL OR f.nationality = '')
      ORDER BY f.name
    `;
    rows = (await p.query(q, [EVENT_ID])).rows;
  } else {
    const q = `
      SELECT id, name, nationality
      FROM fighters
      WHERE nationality IS NULL OR nationality = ''
      ORDER BY id
      ${LIMIT ? 'LIMIT ' + LIMIT : ''}
    `;
    rows = (await p.query(q)).rows;
  }

  console.log(`${rows.length} fighter(s) with NULL nationality${EVENT_ID ? ` on event ${EVENT_ID}` : ' (all)'}`);
  if (!rows.length) { await p.end(); return; }

  let resolved = 0, skipped = 0, applied = 0;
  for (const r of rows) {
    try {
      const out = await resolveCountryFor(r.name);
      if (!out.country) {
        skipped++;
        log(`SKIP ${r.id} ${r.name} → ${out.reason}${out.url ? ' ' + out.url : ''}`);
        continue;
      }
      resolved++;
      log(`SET  ${r.id} ${r.name} → "${out.country}" (from ${out.source_label}: "${out.raw}")`);
      if (APPLY) {
        const upd = await p.query(
          'UPDATE fighters SET nationality = $1 WHERE id = $2 AND (nationality IS NULL OR nationality = \'\')',
          [out.country, r.id]
        );
        applied += upd.rowCount;
      }
    } catch (e) {
      skipped++;
      log(`ERR  ${r.id} ${r.name} → ${e.message}`);
    }
  }

  console.log(`\nResolved=${resolved} Skipped=${skipped} ${APPLY ? `Applied=${applied}` : 'Apply=off (dry-run)'}`);
  await p.end();
}

main().catch(e => { console.error(e); process.exit(1); });
