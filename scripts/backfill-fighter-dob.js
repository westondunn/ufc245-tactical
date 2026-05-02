#!/usr/bin/env node
/**
 * scripts/backfill-fighter-dob.js
 *
 * Fills fighters.dob when NULL, using ufcstats.com as the source. Two paths:
 *   1. ufcstats_hash already set → fetch the fighter detail page, parse DOB.
 *   2. ufcstats_hash missing     → search ufcstats by surname; only link if
 *      exactly one exact-normalized-name match, then fetch + parse.
 *
 * Idempotent + dry-run by default. --apply to write. --limit=N to cap a run.
 *
 * Usage:
 *   $env:DATABASE_URL = "..."
 *   $env:PGSSLMODE = 'require'
 *   node scripts/backfill-fighter-dob.js --dry-run                  # all
 *   node scripts/backfill-fighter-dob.js --apply --limit=300        # cap at 300
 *   node scripts/backfill-fighter-dob.js --event=102 --apply        # one event
 *
 * Polite to ufcstats.com: 1 s between requests.
 */
const { Pool } = require('pg');
const cheerio = require('cheerio');
const { parseFighterPage } = require('../data/scrapers/ufcstats-fighter');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const eventArg = args.find(a => a.startsWith('--event='));
const EVENT_ID = eventArg ? parseInt(eventArg.split('=')[1], 10) : null;
const LIMIT = (() => { const a = args.find(x => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : 0; })();

const log = (...a) => console.log(APPLY ? '[apply]' : '[dry-run]', ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalizeName(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'UFC-Tactical-Dashboard/2.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function searchUfcstatsByLastToken(name) {
  const tokens = String(name || '').split(/\s+/).filter(Boolean);
  const lastToken = tokens[tokens.length - 1] || name;
  const q = encodeURIComponent(lastToken);
  const html = await fetchHtml(`http://ufcstats.com/statistics/fighters/search?query=${q}`);
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $('tr.b-statistics__table-row').each((_, row) => {
    const cells = $(row).find('td.b-statistics__table-col');
    if (cells.length < 2) return;
    const linkEl = $(row).find('a.b-link').first();
    const href = linkEl.attr('href') || '';
    const m = href.match(/fighter-details\/([a-f0-9]{16})/);
    if (!m) return;
    const hash = m[1];
    if (seen.has(hash)) return;
    seen.add(hash);
    const first = $(cells[0]).text().trim();
    const last = $(cells[1]).text().trim();
    out.push({ hash, name: `${first} ${last}`.replace(/\s+/g, ' ').trim() });
  });
  return out;
}

function pickExactMatch(candidates, target) {
  const t = normalizeName(target);
  const exact = candidates.filter(c => normalizeName(c.name) === t);
  if (exact.length === 1) return exact[0];
  return null;
}

async function fetchProfile(hash) {
  const html = await fetchHtml(`http://ufcstats.com/fighter-details/${hash}`);
  return parseFighterPage(html, hash);
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  let q;
  let params = [];
  if (EVENT_ID) {
    q = `SELECT DISTINCT f.id, f.name, f.dob, f.ufcstats_hash
         FROM fighters f
         JOIN fights ft ON (ft.red_fighter_id = f.id OR ft.blue_fighter_id = f.id)
         WHERE ft.event_id = $1 AND (f.dob IS NULL OR f.dob = '')
         ORDER BY f.name`;
    params = [EVENT_ID];
  } else {
    q = `SELECT id, name, dob, ufcstats_hash
         FROM fighters
         WHERE dob IS NULL OR dob = ''
         ORDER BY (ufcstats_hash IS NULL), id
         ${LIMIT ? 'LIMIT ' + LIMIT : ''}`;
  }
  const rows = (await p.query(q, params)).rows;
  console.log(`${rows.length} fighter(s) without DOB${EVENT_ID ? ` on event ${EVENT_ID}` : ''}${LIMIT ? ` (limit ${LIMIT})` : ''}`);
  if (!rows.length) { await p.end(); return; }

  let resolved = 0, applied = 0, linked = 0, skipped = 0, errored = 0;
  for (const r of rows) {
    try {
      let hash = r.ufcstats_hash;
      if (!hash) {
        const cands = await searchUfcstatsByLastToken(r.name);
        const m = pickExactMatch(cands, r.name);
        await sleep(1000);
        if (!m) {
          skipped++;
          log(`SKIP id=${r.id} ${r.name} → ${cands.length === 0 ? 'no candidates' : `${cands.length} non-exact`}`);
          continue;
        }
        hash = m.hash;
        linked++;
      }

      const prof = await fetchProfile(hash);
      await sleep(1000);
      const dob = prof && prof.dob;
      if (!dob) {
        skipped++;
        log(`SKIP id=${r.id} ${r.name} → no DOB on ufcstats`);
        continue;
      }
      resolved++;
      log(`SET  id=${r.id} ${r.name} → dob=${dob}${r.ufcstats_hash ? '' : ` (linking hash=${hash})`}`);
      if (APPLY) {
        const updates = ['dob = $1'];
        const vals = [dob];
        if (!r.ufcstats_hash) {
          updates.push(`ufcstats_hash = $${vals.length + 1}`);
          vals.push(hash);
        }
        vals.push(r.id);
        const idIdx = vals.length;
        const upd = await p.query(
          `UPDATE fighters SET ${updates.join(', ')} WHERE id = $${idIdx} AND (dob IS NULL OR dob = '')`,
          vals
        );
        applied += upd.rowCount;
      }
    } catch (e) {
      errored++;
      log(`ERR  id=${r.id} ${r.name} → ${e.message}`);
    }
  }

  console.log(`\nResolved=${resolved}  Linked=${linked}  Skipped=${skipped}  Errored=${errored}  ${APPLY ? `Applied=${applied}` : 'Apply=off (dry-run)'}`);
  await p.end();
}

main().catch(e => { console.error(e); process.exit(1); });
