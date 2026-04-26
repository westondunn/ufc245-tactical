#!/usr/bin/env node
/**
 * data/scrape-results.js — Pull fight results from a ufc.com event detail
 * page and write them to the DB. Each fight gets an upsert into
 * official_fight_outcomes (which also flips fights.winner_id) and the event
 * is then reconciled so user picks pick up scores immediately.
 *
 * Usage:
 *   node data/scrape-results.js <event_id>
 *   node data/scrape-results.js --slug <ufc-slug>
 *   node data/scrape-results.js --all-history     # every history event with open fights
 *   add --dry-run to preview without writing
 *
 * The event needs a stored ufc_slug in seed.json OR explicit --slug. Designed
 * to be re-run safely; matching is by fighter name with an accent-stripped
 * fallback so reruns hit the same rows.
 *
 * Source layout (April 2026):
 *   .c-listing-fight                     — one per fight
 *   .c-listing-fight__corner-name--red   — red fighter
 *   .c-listing-fight__corner-name--blue  — blue fighter
 *   .c-listing-fight__corner-body--red   — wrapper with outcome class
 *     .c-listing-fight__outcome--win | --loss
 *   .c-listing-fight__result-text.method — method ("Decision - Unanimous", "KO/TKO", "Submission")
 *   .c-listing-fight__result-text.round  — round number
 *   .c-listing-fight__result-text.time   — m:ss
 */
if (typeof global.File === 'undefined') {
  global.File = class File extends Blob {
    constructor(chunks, name, options = {}) {
      super(chunks, options);
      this.name = String(name || '');
      this.lastModified = options.lastModified || Date.now();
    }
  };
}

const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.ufc.com';
const UA = 'Mozilla/5.0 (compatible; UFC-Tactical-Dashboard/2.0; +github.com/westondunn/ufc245-tactical)';
const DELAY_MS = 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const ALL_HISTORY = argv.includes('--all-history');
const slugIdx = argv.indexOf('--slug');
const explicitSlug = slugIdx >= 0 ? argv[slugIdx + 1] : null;
const positional = argv.find(a => /^\d+$/.test(a));
const targetEventId = positional ? parseInt(positional, 10) : null;

function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }
function stripAccents(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function normalizeName(s) { return stripAccents(s).toLowerCase().replace(/[^a-z]+/g, ' ').trim(); }

async function fetchPage(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      console.warn(`  [retry ${i + 1}/3] ${e.message}`);
      if (i < 2) await sleep(2000);
      else throw e;
    }
  }
}

function parseFightsFromEventPage(html) {
  const $ = cheerio.load(html);
  const fights = [];
  $('div.c-listing-fight').each((_, el) => {
    const $el = $(el);
    const red = clean($el.find('.c-listing-fight__corner-name--red').first().text());
    const blue = clean($el.find('.c-listing-fight__corner-name--blue').first().text());
    if (!red || !blue) return;
    const redCorner = $el.find('.c-listing-fight__corner-body--red, .c-listing-fight__corner--red').first();
    const blueCorner = $el.find('.c-listing-fight__corner-body--blue, .c-listing-fight__corner--blue').first();
    const redOutcome = redCorner.find('.c-listing-fight__outcome--win').length ? 'win'
                     : redCorner.find('.c-listing-fight__outcome--loss').length ? 'loss' : null;
    const blueOutcome = blueCorner.find('.c-listing-fight__outcome--win').length ? 'win'
                      : blueCorner.find('.c-listing-fight__outcome--loss').length ? 'loss' : null;
    const method = clean($el.find('.c-listing-fight__result-text.method').first().text());
    const round = clean($el.find('.c-listing-fight__result-text.round').first().text());
    const time = clean($el.find('.c-listing-fight__result-text.time').first().text());
    fights.push({ red, blue, redOutcome, blueOutcome, method, round, time });
  });
  return fights;
}

function classifyMethod(text) {
  // ufc.com → fights.method canonicalization. Keep the source string in
  // method_detail when the broad bucket loses information.
  const t = clean(text).toLowerCase();
  if (!t) return { method: null, detail: null };
  if (/decision/.test(t)) return { method: 'Decision', detail: text };
  if (/submission/.test(t)) return { method: 'Submission', detail: text };
  if (/ko|tko/.test(t)) return { method: 'KO/TKO', detail: text };
  if (/dq|disqualif/.test(t)) return { method: 'DQ', detail: text };
  if (/no\s*contest|nc/.test(t)) return { method: 'No Contest', detail: text };
  if (/draw/.test(t)) return { method: 'Draw', detail: text };
  return { method: text.split(' ')[0], detail: text };
}

function buildSlugFromEvent(event) {
  if (!event) return null;
  if (event.ufc_slug) return event.ufc_slug;
  // Last-resort guess from date — same pattern UFC.com uses for fight nights
  if (event.date) {
    const [y, m, d] = event.date.split('-');
    const months = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const monthName = months[parseInt(m, 10) - 1];
    if (monthName) return `ufc-fight-night-${monthName}-${d}-${y}`;
  }
  return null;
}

async function reconcileEvent(db, event, scrapedFights) {
  const card = await db.getEventCard(event.id);
  if (!card || !card.length) {
    console.warn(`  ⚠ Event ${event.id} has no card in DB.`);
    return { matched: 0, missed: 0 };
  }
  // Build name → fight lookup (red key + blue key)
  const fightsByKey = new Map();
  for (const f of card) {
    const r = normalizeName(f.red_name);
    const b = normalizeName(f.blue_name);
    fightsByKey.set(`${r}|${b}`, f);
    fightsByKey.set(`${b}|${r}`, f);   // tolerate corner swap
  }

  const outcomes = [];
  let matched = 0, missed = 0;
  for (const sf of scrapedFights) {
    const r = normalizeName(sf.red);
    const b = normalizeName(sf.blue);
    const fight = fightsByKey.get(`${r}|${b}`) || fightsByKey.get(`${b}|${r}`);
    if (!fight) {
      console.warn(`  ⚠ no DB match for: ${sf.red} vs ${sf.blue}`);
      missed++;
      continue;
    }
    let winnerId = null;
    if (sf.redOutcome === 'win') winnerId = fight.red_id;
    else if (sf.blueOutcome === 'win') winnerId = fight.blue_id;
    const { method, detail } = classifyMethod(sf.method);
    const round = sf.round ? parseInt(sf.round, 10) : null;
    const isFinal = winnerId != null || /draw|no\s*contest|nc/i.test(sf.method);
    outcomes.push({
      fight_id: fight.id,
      red_id: fight.red_id,
      blue_id: fight.blue_id,
      red_name: fight.red_name,
      blue_name: fight.blue_name,
      winner_id: winnerId,
      method,
      method_detail: detail,
      round,
      time: sf.time || null,
      status: isFinal ? 'official' : 'in_progress',
      source: 'scrape-results',
      source_url: `${BASE}/event/${event.ufc_slug || ''}`
    });
    matched++;
  }

  console.log(`  Parsed: matched ${matched} · missed ${missed} (of ${scrapedFights.length})`);

  if (DRY_RUN) {
    console.log('  --dry-run: not writing');
    for (const o of outcomes) {
      const wname = o.winner_id == null ? '—'
                  : o.winner_id === o.red_id ? o.red_name
                  : o.winner_id === o.blue_id ? o.blue_name
                  : `id ${o.winner_id}`;
      console.log(`    fight ${o.fight_id}: ${o.red_name} vs ${o.blue_name} → ${wname} · ${o.method} R${o.round} ${o.time}`);
    }
    return { matched, missed, written: 0 };
  }

  let written = 0;
  for (const o of outcomes) {
    try {
      const saved = await db.upsertOfficialOutcome(o);
      if (saved) written++;
    } catch (e) {
      console.warn(`  ⚠ upsert failed for fight ${o.fight_id}: ${e.message}`);
    }
  }
  await db.save();

  // Score user picks now that fights have winners.
  let reconciled = null;
  try {
    reconciled = await db.reconcilePicksForEvent(event.id);
    await db.save();
  } catch (e) {
    console.warn(`  ⚠ reconcilePicksForEvent failed: ${e.message}`);
  }
  console.log(`  Wrote ${written} outcomes · reconciled ${reconciled ? (reconciled.reconciled_count || 0) : 0} user picks`);
  return { matched, missed, written, reconciled };
}

async function main() {
  const db = require('../db');
  await db.init();

  // Resolve target events.
  let targets = [];
  if (targetEventId) {
    const ev = await db.getEvent(targetEventId);
    if (!ev) { console.error(`Event ${targetEventId} not found.`); process.exit(1); }
    targets = [ev];
  } else if (explicitSlug) {
    targets = [{ id: null, name: explicitSlug, ufc_slug: explicitSlug, date: null }];
  } else if (ALL_HISTORY) {
    const all = await db.getAllEvents();
    targets = all.filter(e => e.state === 'history' && (+e.open_fights) > 0);
    console.log(`Found ${targets.length} history events with open fights.`);
  } else {
    console.error('Usage: node data/scrape-results.js <event_id> | --slug <slug> | --all-history [--dry-run]');
    process.exit(1);
  }

  // Hydrate ufc_slug from seed.json when the DB doesn't carry it (we don't
  // store ufc_slug in the events table — yet).
  const seedPath = path.join(__dirname, 'seed.json');
  let seed = null;
  if (fs.existsSync(seedPath)) {
    try { seed = JSON.parse(fs.readFileSync(seedPath, 'utf8')); } catch {}
  }
  const slugByEventId = new Map();
  if (seed && Array.isArray(seed.events)) {
    for (const e of seed.events) if (e && e.id && e.ufc_slug) slugByEventId.set(e.id, e.ufc_slug);
  }

  let i = 0;
  for (const ev of targets) {
    i++;
    if (!ev.ufc_slug && ev.id) ev.ufc_slug = slugByEventId.get(ev.id);
    if (!ev.ufc_slug) ev.ufc_slug = buildSlugFromEvent(ev);
    if (!ev.ufc_slug) { console.warn(`[${i}/${targets.length}] ${ev.name}: no slug, skipping`); continue; }
    console.log(`\n[${i}/${targets.length}] ${ev.name || ev.ufc_slug} → /event/${ev.ufc_slug}`);
    if (i > 1) await sleep(DELAY_MS);
    let html;
    try { html = await fetchPage(`${BASE}/event/${ev.ufc_slug}`); }
    catch (e) { console.warn(`  ⚠ fetch failed: ${e.message}`); continue; }
    const fights = parseFightsFromEventPage(html);
    if (!fights.length) { console.warn('  ⚠ parser found 0 fights — selector regression?'); continue; }
    if (!ev.id) {
      console.log(`  Parsed ${fights.length} fights (no event id, --slug-only mode prints summary):`);
      fights.forEach(f => console.log(`    ${f.red} (${f.redOutcome}) vs ${f.blue} (${f.blueOutcome}) — ${f.method} R${f.round} ${f.time}`));
      continue;
    }
    await reconcileEvent(db, ev, fights);
  }
}

main().catch(err => { console.error('scrape-results failed:', err); process.exit(1); });
