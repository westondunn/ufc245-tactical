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

// 2-letter regional subdivision codes that appear after a city in UFC location
// strings (e.g. "Las Vegas, NV, USA" → "NV"; "Perth WA Australia" → "WA"). Used
// to strip a state/province token that would otherwise pollute `country`.
const SUBDIVISION_CODES = new Set([
  // US states + DC
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA',
  'ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK',
  'OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
  // Australian states/territories
  'NSW','VIC','QLD','SA','TAS','ACT','NT',
  // Canadian provinces (NT/NS/QC overlap is fine — context disambiguates)
  'ON','QC','BC','AB','MB','SK','NS','NB','NL','PE','YT','NU',
]);

// Parse a UFC.com location string into { city, country }. Defensive against
// two real-world quirks of the source HTML:
//   1. The location element sometimes has the venue name concatenated as a
//      prefix (e.g. venue "RAC Arena" + location "RAC Arena Perth WA Australia").
//   2. The string may be unpunctuated ("Perth WA Australia"), 2-part
//      ("Sydney, Australia"), or 3-part ("Las Vegas, NV, USA").
// Also strips a leading state/province code from the country segment so
// "DC United States" → "United States".
function parseEventLocation(rawLocation, venue){
  let loc = clean(rawLocation || '');
  if (!loc) return { city: null, country: null };
  if (venue && loc.toLowerCase().startsWith(String(venue).toLowerCase())) {
    loc = loc.slice(venue.length).replace(/^[\s,\-]+/, '').trim();
  }
  if (!loc) return { city: null, country: null };

  function dropLeadingSubdivision(str){
    const tokens = str.split(/\s+/);
    if (tokens.length > 1 && SUBDIVISION_CODES.has(tokens[0].toUpperCase())) {
      return tokens.slice(1).join(' ');
    }
    return str;
  }

  const parts = loc.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { city: parts[0], country: dropLeadingSubdivision(parts[parts.length - 1]) || null };
  }

  const tokens = parts[0].split(/\s+/);
  if (tokens.length === 1) return { city: tokens[0], country: null };
  for (let i = 1; i < tokens.length; i++) {
    if (SUBDIVISION_CODES.has(tokens[i].toUpperCase())) {
      const city = tokens.slice(0, i).join(' ');
      const country = tokens.slice(i + 1).join(' ');
      return { city: city || tokens[0], country: country || null };
    }
  }
  // No subdivision code present (e.g. "Abu Dhabi", "Hong Kong"): treat the
  // whole string as the city. Splitting on whitespace would mangle multi-word
  // city names. Country is left null for the timezone fallback to handle.
  return { city: parts[0], country: null };
}

function parseUfcNumber(title){
  // "UFC 328: Nunes vs X" → 328;  "UFC Fight Night: ..." → null
  const m = clean(title).match(/^UFC\s+(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function isoDateFromTimestamp(tsSec, timeZone = 'UTC'){
  if (!tsSec) return null;
  const d = new Date(parseInt(tsSec, 10) * 1000);
  if (isNaN(d.getTime())) return null;
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(d);
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
      if (values.year && values.month && values.day) return `${values.year}-${values.month}-${values.day}`;
    } catch {
      // Fall back to the UTC calendar date when the venue timezone is unknown
      // or unsupported by this Node runtime.
    }
  }
  return d.toISOString().slice(0, 10);
}

function isoUtcFromTimestamp(tsSec){
  if (!tsSec) return null;
  const n = parseInt(tsSec, 10);
  if (!Number.isFinite(n)) return null;
  const d = new Date(n * 1000);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

// Best-effort city → IANA timezone for the cities UFC actually books. UFC.com
// publishes timestamps in UTC, so this is purely for display. NULL when we
// don't recognize the city — UI falls back to the user's local TZ.
const CITY_TZ_TABLE = [
  // North America
  [/(las\s*vegas|paradise)\s*,?\s*(?:nv|nevada|usa)?/i, 'America/Los_Angeles'],
  [/los\s*angeles|inglewood|anaheim/i, 'America/Los_Angeles'],
  [/sacramento|fresno|san\s*jose/i, 'America/Los_Angeles'],
  [/seattle|tacoma|portland\s*,?\s*or/i, 'America/Los_Angeles'],
  [/phoenix|arizona/i, 'America/Phoenix'],
  [/denver|colorado/i, 'America/Denver'],
  [/dallas|houston|san\s*antonio|austin|texas/i, 'America/Chicago'],
  [/chicago|illinois|saint\s*louis|st\.?\s*louis|nashville|memphis|milwaukee/i, 'America/Chicago'],
  [/miami|orlando|tampa|jacksonville|florida|atlanta|georgia|new\s*orleans|louisiana|charlotte|north\s*carolina|columbus|ohio|cleveland|pittsburgh|philadelphia|boston|massachusetts|new\s*york|brooklyn|buffalo|newark|new\s*jersey|washington|d\.?c\.?|baltimore|maryland|detroit|michigan/i, 'America/New_York'],
  [/toronto|montreal|ottawa|quebec/i, 'America/Toronto'],
  [/vancouver|edmonton|calgary/i, 'America/Edmonton'],
  [/mexico\s*city|guadalajara|monterrey/i, 'America/Mexico_City'],
  // Europe
  [/london|manchester|liverpool|england|united\s*kingdom|uk/i, 'Europe/London'],
  [/dublin|ireland/i, 'Europe/Dublin'],
  [/paris|france/i, 'Europe/Paris'],
  [/berlin|hamburg|munich|germany/i, 'Europe/Berlin'],
  [/madrid|spain/i, 'Europe/Madrid'],
  [/lisbon|portugal/i, 'Europe/Lisbon'],
  [/stockholm|sweden/i, 'Europe/Stockholm'],
  [/copenhagen|denmark/i, 'Europe/Copenhagen'],
  [/rome|milan|italy/i, 'Europe/Rome'],
  [/amsterdam|rotterdam|netherlands/i, 'Europe/Amsterdam'],
  [/moscow|russia/i, 'Europe/Moscow'],
  // Middle East / Asia / Oceania
  [/abu\s*dhabi|dubai|uae|united\s*arab\s*emirates/i, 'Asia/Dubai'],
  [/riyadh|jeddah|saudi\s*arabia/i, 'Asia/Riyadh'],
  [/singapore/i, 'Asia/Singapore'],
  [/seoul|korea/i, 'Asia/Seoul'],
  [/tokyo|saitama|japan/i, 'Asia/Tokyo'],
  [/shanghai|beijing|china/i, 'Asia/Shanghai'],
  [/sydney|melbourne|brisbane|australia/i, 'Australia/Sydney'],
  [/perth/i, 'Australia/Perth'],
  [/auckland|new\s*zealand/i, 'Pacific/Auckland'],
  // South America
  [/sao\s*paulo|rio\s*de\s*janeiro|brasil(?:ia)?|brazil/i, 'America/Sao_Paulo'],
  [/buenos\s*aires|argentina/i, 'America/Argentina/Buenos_Aires'],
  [/santiago|chile/i, 'America/Santiago'],
];
function ianaTimezoneFromVenueLocation(...parts){
  const blob = parts.filter(Boolean).join(' ');
  if (!blob) return null;
  for (const [re, tz] of CITY_TZ_TABLE) {
    if (re.test(blob)) return tz;
  }
  return null;
}

function inchesToCm(value){
  const n = parseFloat(String(value || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 2.54) : null;
}

function parsePct(value){
  const m = String(value || '').match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

function parseProfileNumber(value){
  const n = parseFloat(String(value || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function mergeProfile(target, profile){
  let changed = false;
  for (const [key, value] of Object.entries(profile || {})) {
    if (value == null || value === '') continue;
    if (target[key] == null || target[key] === '') {
      target[key] = value;
      changed = true;
    }
  }
  return changed;
}

async function fetchFighterProfile(slug){
  if (!slug) return {};
  const html = await fetchPage(`${BASE}/athlete/${slug}`);
  const $ = cheerio.load(html);
  const profile = {};

  $('.c-bio__field').each((_, el) => {
    const label = clean($(el).find('.c-bio__label').text()).toLowerCase();
    const value = clean($(el).find('.c-bio__text').text());
    if (label === 'height') profile.height_cm = inchesToCm(value);
    if (label === 'reach') profile.reach_cm = inchesToCm(value);
    if (label === 'fighting style' || label === 'stance') {
      const stance = value.toLowerCase();
      if (stance) profile.stance = stance;
    }
  });

  $('.c-stat-compare__group').each((_, el) => {
    const label = clean($(el).find('.c-stat-compare__label').text()).toLowerCase();
    const value = parseProfileNumber($(el).find('.c-stat-compare__number').text());
    if (value == null) return;
    if (label === 'sig. str. landed') profile.slpm = value;
    if (label === 'sig. str. absorbed') profile.sapm = value;
    if (label === 'takedown avg') profile.td_avg = value;
    if (label === 'submission avg') profile.sub_avg = value;
  });

  $('svg.e-chart-circle title').each((_, el) => {
    const text = clean($(el).text()).toLowerCase();
    const pct = parsePct(text);
    if (pct == null) return;
    if (text.includes('striking accuracy')) profile.str_acc = pct;
    if (text.includes('striking defense')) profile.str_def = pct;
    if (text.includes('takedown accuracy')) profile.td_acc = pct;
    if (text.includes('takedown defense')) profile.td_def = pct;
  });

  return profile;
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
    const prelimsTs = dateEl.attr('data-prelims-card-timestamp');
    const earlyTs = dateEl.attr('data-early-prelims-timestamp');
    // Earliest of the three timestamps = card start. UFC publishes these as
    // unix seconds (UTC). End is a 4-hour estimate from the main card start —
    // UFC events almost always wrap within that window. Both are stored as
    // ISO-8601 UTC strings; UI converts to user's preferred timezone.
    const startCandidates = [earlyTs, prelimsTs, mainTs].filter(Boolean).map(s => parseInt(s, 10)).filter(Number.isFinite);
    const startSec = startCandidates.length ? Math.min(...startCandidates) : null;
    const endSec = mainTs ? parseInt(mainTs, 10) + (4 * 60 * 60) : null;
    const start_time = isoUtcFromTimestamp(startSec);
    const end_time = isoUtcFromTimestamp(endSec);

    const venue = clean($(art).find('.field--name-taxonomy-term-title h5').first().text());
    const location = clean($(art).find('.c-card-event--result__location').text());
    const timezone = ianaTimezoneFromVenueLocation(venue, location);
    const date = isoDateFromTimestamp(mainTs, timezone);

    events.push({ slug, title, date, venue, location, start_time, end_time, timezone });
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
  const seedFighterBySlug = new Map();
  for (const f of seed.fighters) {
    seedFighterByName.set(normName(f.name), f);
    if (f.ufc_slug) seedFighterBySlug.set(normName(f.ufc_slug), f);
  }

  let nextEventId = Math.max(0, ...seed.events.map(e => e.id)) + 1;
  let nextFightId = Math.max(0, ...seed.fights.map(f => f.id)) + 1;
  let nextFighterId = Math.max(0, ...seed.fighters.map(f => f.id)) + 1;

  const addedEvents = [];
  const addedFights = [];
  const addedFighters = [];
  let enrichedFighters = 0;
  let enrichedEvents = 0;
  const profileCache = new Map();

  async function enrichFromUfcProfile(fighter, slug){
    if (!fighter || !slug) return;
    if (!fighter.ufc_slug) fighter.ufc_slug = slug;
    if (!profileCache.has(slug)) {
      await sleep(DELAY_MS);
      try { profileCache.set(slug, await fetchFighterProfile(slug)); }
      catch (e) {
        console.warn(`    ⚠ Profile failed for ${fighter.name}: ${e.message}`);
        profileCache.set(slug, {});
      }
    }
    if (mergeProfile(fighter, profileCache.get(slug))) enrichedFighters++;
  }

  function findSeedFighter(name, slug){
    return seedFighterBySlug.get(normName(slug)) || seedFighterByName.get(normName(name));
  }

  for (let idx = 0; idx < upcoming.length; idx++) {
    const ev = upcoming[idx];
    const existing = seedEventByName.get(normName(ev.title));

    console.log(`[2/3] ${idx + 1}/${upcoming.length} Fetching card: ${ev.title}`);
    await sleep(DELAY_MS);
    let card = [];
    try { card = await fetchEventCard(ev.slug); }
    catch (e) { console.warn(`    ⚠ Failed: ${e.message}`); continue; }
    if (!card.length) { console.warn(`    ⚠ Empty card, skipping`); continue; }

    if (existing) {
      // Refresh time + venue metadata on existing rows when we have it. Don't
      // wipe a previously-set value with null — UFC.com sometimes drops the
      // timestamp attributes a few hours after an event ends.
      let touched = false;
      if (ev.date && existing.date !== ev.date) { existing.date = ev.date; touched = true; }
      if (ev.start_time && !existing.start_time) { existing.start_time = ev.start_time; touched = true; }
      if (ev.end_time && !existing.end_time) { existing.end_time = ev.end_time; touched = true; }
      if (ev.timezone && !existing.timezone) { existing.timezone = ev.timezone; touched = true; }
      if (ev.venue && !existing.venue) { existing.venue = ev.venue; touched = true; }
      if (ev.slug && !existing.ufc_slug) { existing.ufc_slug = ev.slug; touched = true; }
      if (touched) { enrichedEvents++; console.log(`    enriched timing/venue for existing event`); }
      for (const bout of card) {
        await enrichFromUfcProfile(findSeedFighter(bout.red_name, bout.red_slug), bout.red_slug);
        await enrichFromUfcProfile(findSeedFighter(bout.blue_name, bout.blue_slug), bout.blue_slug);
      }
      console.log(`    exists; refreshed fighter profiles for ${card.length} fights`);
      continue;
    }

    const number = parseUfcNumber(ev.title);
    const { city, country } = parseEventLocation(ev.location, ev.venue);
    const timezone = ev.timezone || ianaTimezoneFromVenueLocation(ev.venue, city, country, ev.location);
    const eventRow = {
      id: nextEventId++,
      number: number || null,
      name: ev.title,
      date: ev.date || null,
      venue: ev.venue || null,
      city: city || null,
      country: country || null,
      start_time: ev.start_time || null,
      end_time: ev.end_time || null,
      timezone: timezone || null,
      ufcstats_hash: null,
      ufc_slug: ev.slug
    };
    addedEvents.push(eventRow);

    for (const bout of card) {
      const redExisting = findSeedFighter(bout.red_name, bout.red_slug);
      const blueExisting = findSeedFighter(bout.blue_name, bout.blue_slug);

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
        if (stub.ufc_slug) seedFighterBySlug.set(normName(stub.ufc_slug), stub);
        redId = stub.id;
        await enrichFromUfcProfile(stub, bout.red_slug);
      } else {
        await enrichFromUfcProfile(redExisting, bout.red_slug);
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
        if (stub.ufc_slug) seedFighterBySlug.set(normName(stub.ufc_slug), stub);
        blueId = stub.id;
        await enrichFromUfcProfile(stub, bout.blue_slug);
      } else {
        await enrichFromUfcProfile(blueExisting, bout.blue_slug);
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
  console.log(`  + ${enrichedFighters} fighter profile enrichments`);
  if (addedEvents.length) {
    console.log('\nNew upcoming events:');
    for (const e of addedEvents) console.log(`  UFC ${e.number || '—'} · ${e.date} · ${e.name}`);
  }

  if (DRY_RUN) {
    console.log('\n--dry-run: not writing seed.json');
    return;
  }

  if (!addedEvents.length && !addedFights.length && !addedFighters.length && !enrichedFighters && !enrichedEvents) {
    console.log('\nNothing new — seed.json unchanged.');
    return;
  }
  if (enrichedEvents) console.log(`  ✦ ${enrichedEvents} existing events enriched with timing/venue metadata`);

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

if (require.main === module) {
  run().catch(err => { console.error('scrape-upcoming failed:', err); process.exit(1); });
}

module.exports = {
  isoDateFromTimestamp,
  isoUtcFromTimestamp,
  ianaTimezoneFromVenueLocation,
  parseEventLocation
};
