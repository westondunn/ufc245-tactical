#!/usr/bin/env node
/**
 * data/scrape-upcoming.js — Pull upcoming UFC event cards from ufc.com and
 * MERGE them into the existing data/seed.json (does not overwrite).
 *
 * UFCStats.com only publishes completed events, so for Picks to have upcoming
 * fights to offer, we need to scrape the official ufc.com event schedule.
 * Events here have no results (winner_id = null, method = null, etc.).
 *
 * Usage:
 *   node data/scrape-upcoming.js                    # merge upcoming events into seed.json
 *   node data/scrape-upcoming.js --dry-run          # show what would be added, don't write
 *
 * The script is idempotent: re-running won't create duplicates.
 * Event identity: name (case-insensitive) — UFC 328 or "UFC Fight Night: Sterling vs Zalal"
 * Fighter identity: name OR ufc_slug (when present)
 */
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.ufc.com';
const DELAY_MS = 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DRY_RUN = process.argv.includes('--dry-run');

const UA = 'Mozilla/5.0 (compatible; UFC-Tactical-Dashboard/2.0; +github.com/westondunn/ufc245-tactical)';

async function fetchPage(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (e) {
      console.warn(`  [retry ${i+1}/${retries}] ${e.message}`);
      if (i < retries - 1) await sleep(2000);
      else throw e;
    }
  }
}

function clean(s){ return (s || '').replace(/\s+/g, ' ').trim(); }

function parseUfcNumber(title){
  // "UFC 328: Nunes vs X" → 328;  "UFC Fight Night: ..." → null
  const m = clean(title).match(/^UFC\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function isoDateFromTimestamp(tsSec){
  if (!tsSec) return null;
  const d = new Date(parseInt(tsSec, 10) * 1000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Parse /events page → list of event stubs { slug, title, date, venue, city? }
 * We pull all events visible on the page (past + upcoming). Caller filters
 * by date to decide which to fetch in detail.
 */
async function fetchEventList(){
  console.log(`[1/3] Fetching event list from ${BASE}/events …`);
  const html = await fetchPage(`${BASE}/events`);
  const $ = cheerio.load(html);
  const events = [];

  $('article.c-card-event--result').each((_, art) => {
    const $a = $(art).find('.c-card-event--result__headline a').first();
    const href = $a.attr('href') || '';
    const slug = href.replace(/^\/event\//, '').replace(/\/$/, '');
    if (!slug) return;
    const title = clean($a.text());

    const dateEl = $(art).find('.c-card-event--result__date').first();
    const mainTs = dateEl.attr('data-main-card-timestamp');
    const date = isoDateFromTimestamp(mainTs);

    const venue = clean($(art).find('.field--name-taxonomy-term-title h5').first().text());
    const location = clean($(art).find('.c-card-event--result__location').text());

    events.push({ slug, title, date, venue, location });
  });

  console.log(`  Parsed ${events.length} events from the page.`);
  return events;
}

/**
 * Parse an event detail page → list of fights in card order.
 * Each fight: { red_name, red_slug, blue_name, blue_slug, weight_class, is_title, is_main, card_position }
 */
async function fetchEventCard(slug){
  const url = `${BASE}/event/${slug}`;
  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const fights = [];
  let position = 0;

  $('div.c-listing-fight, li.l-listing__item .c-listing-fight').each((_, el) => {
    const red = $(el).find('.c-listing-fight__corner-name--red a').first();
    const blue = $(el).find('.c-listing-fight__corner-name--blue a').first();
    // Fallback if no <a> (fighter without a profile page)
    const redName = red.length ? clean(red.text()) : clean($(el).find('.c-listing-fight__corner-name--red').text());
    const blueName = blue.length ? clean(blue.text()) : clean($(el).find('.c-listing-fight__corner-name--blue').text());
    if (!redName || !blueName) return;

    const redHref = red.attr('href') || '';
    const blueHref = blue.attr('href') || '';
    const redSlug = redHref.split('/').pop();
    const blueSlug = blueHref.split('/').pop();

    const wcText = clean($(el).find('.c-listing-fight__class-text').first().text())
      || clean($(el).find('[class*="weight-class"]').first().text());
    const weight_class = wcText ? wcText.replace(/\s+bout.*/i, '') : null;
    const is_title = /title/i.test(wcText);

    position++;
    fights.push({
      red_name: redName,
      blue_name: blueName,
      red_slug: redSlug,
      blue_slug: blueSlug,
      weight_class,
      is_title: is_title ? 1 : 0,
      is_main: position === 1 ? 1 : 0,
      card_position: position
    });
  });

  return fights;
}

/**
 * Merge upcoming events/fights/fighters into seed.json.
 * Returns { added_events, added_fights, added_fighters } counts.
 */
async function run(){
  const seedPath = path.join(__dirname, 'seed.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  console.log(`Current seed: ${seed.events.length} events, ${seed.fights.length} fights, ${seed.fighters.length} fighters`);

  const events = await fetchEventList();
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter(e => (e.date || '') >= today);
  console.log(`  ${upcoming.length} of ${events.length} events are upcoming (date >= ${today})`);

  // Existing event index by normalized name
  const normName = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const seedEventByName = new Map();
  for (const e of seed.events) seedEventByName.set(normName(e.name), e);

  // Fighter index by name (case-insensitive) and by ufc_slug if present
  const seedFighterByName = new Map();
  for (const f of seed.fighters) {
    seedFighterByName.set(normName(f.name), f);
  }

  let nextEventId = Math.max(0, ...seed.events.map(e => e.id)) + 1;
  let nextFightId = Math.max(0, ...seed.fights.map(f => f.id)) + 1;
  let nextFighterId = Math.max(0, ...seed.fighters.map(f => f.id)) + 1;

  const addedEvents = [];
  const addedFights = [];
  const addedFighters = [];

  for (let idx = 0; idx < upcoming.length; idx++) {
    const ev = upcoming[idx];
    const existing = seedEventByName.get(normName(ev.title));
    if (existing) {
      console.log(`  skip (exists): ${ev.title}`);
      continue;
    }

    console.log(`[2/3] ${idx + 1}/${upcoming.length} Fetching card: ${ev.title}`);
    await sleep(DELAY_MS);
    let card = [];
    try { card = await fetchEventCard(ev.slug); }
    catch (e) { console.warn(`    ⚠ Failed: ${e.message}`); continue; }
    if (!card.length) { console.warn(`    ⚠ Empty card, skipping`); continue; }

    const number = parseUfcNumber(ev.title);
    const [city, country] = (ev.location || '').split(',').map(s => clean(s));
    const eventRow = {
      id: nextEventId++,
      number: number || null,
      name: ev.title,
      date: ev.date || null,
      venue: ev.venue || null,
      city: city || null,
      country: country || null,
      ufcstats_hash: null,
      ufc_slug: ev.slug
    };
    addedEvents.push(eventRow);

    for (const bout of card) {
      const redExisting = seedFighterByName.get(normName(bout.red_name));
      const blueExisting = seedFighterByName.get(normName(bout.blue_name));

      let redId = redExisting ? redExisting.id : null;
      let blueId = blueExisting ? blueExisting.id : null;

      if (!redId) {
        const stub = {
          id: nextFighterId++,
          name: bout.red_name,
          nickname: null, height_cm: null, reach_cm: null,
          stance: null, weight_class: bout.weight_class, nationality: null,
          dob: null, slpm: null, str_acc: null, sapm: null, str_def: null,
          td_avg: null, td_acc: null, td_def: null, sub_avg: null,
          ufcstats_hash: null, ufc_slug: bout.red_slug
        };
        addedFighters.push(stub);
        seedFighterByName.set(normName(stub.name), stub);
        redId = stub.id;
      }
      if (!blueId) {
        const stub = {
          id: nextFighterId++,
          name: bout.blue_name,
          nickname: null, height_cm: null, reach_cm: null,
          stance: null, weight_class: bout.weight_class, nationality: null,
          dob: null, slpm: null, str_acc: null, sapm: null, str_def: null,
          td_avg: null, td_acc: null, td_def: null, sub_avg: null,
          ufcstats_hash: null, ufc_slug: bout.blue_slug
        };
        addedFighters.push(stub);
        seedFighterByName.set(normName(stub.name), stub);
        blueId = stub.id;
      }

      addedFights.push({
        id: nextFightId++,
        event_id: eventRow.id,
        event_number: number || null,
        red_fighter_id: redId,
        blue_fighter_id: blueId,
        red_name: bout.red_name,
        blue_name: bout.blue_name,
        weight_class: bout.weight_class,
        is_title: bout.is_title,
        is_main: bout.is_main,
        card_position: bout.card_position,
        method: null, method_detail: null,
        round: null, time: null, time_format: null,
        winner_id: null, referee: null,
        has_stats: 0, ufcstats_hash: null
      });
    }
    console.log(`    added ${card.length} fights`);
  }

  console.log('\n[3/3] Merge summary:');
  console.log(`  + ${addedEvents.length} events`);
  console.log(`  + ${addedFights.length} fights`);
  console.log(`  + ${addedFighters.length} fighter stubs`);
  if (addedEvents.length) {
    console.log('\nNew upcoming events:');
    for (const e of addedEvents) console.log(`  UFC ${e.number || '—'} · ${e.date} · ${e.name}`);
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: not writing seed.json');
    return;
  }

  if (!addedEvents.length && !addedFights.length && !addedFighters.length) {
    console.log('\nNothing new — seed.json unchanged.');
    return;
  }

  seed.events.push(...addedEvents);
  seed.fights.push(...addedFights);
  seed.fighters.push(...addedFighters);
  if (!seed._meta) seed._meta = {};
  seed._meta.upcoming_scraped_at = new Date().toISOString();
  seed._meta.events_count = seed.events.length;
  seed._meta.fights_count = seed.fights.length;
  seed._meta.fighters_count = seed.fighters.length;

  fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2));
  console.log(`\n  ✓ seed.json updated (${seed.events.length} events, ${seed.fights.length} fights, ${seed.fighters.length} fighters)`);
}

run().catch(err => { console.error('scrape-upcoming failed:', err); process.exit(1); });
