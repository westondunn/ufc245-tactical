#!/usr/bin/env node
/**
 * Backfill completed UFCStats events and card rows into data/seed.json.
 *
 * This is intentionally lighter than data/scrape.js: it fetches event pages
 * and card rows, but does not fetch every fight detail or fighter profile.
 * That makes it practical for filling the event/fight catalog while preserving
 * existing richer rows and upcoming seed data.
 */
if (typeof global.File === 'undefined') {
  global.File = class File {};
}

const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE = 'http://ufcstats.com';
const DEFAULT_DELAY_MS = 250;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function clean(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function hashFromUrl(url) {
  const m = (url || '').match(/([a-f0-9]{16})$/);
  return m ? m[1] : null;
}

function parseDate(text) {
  const d = new Date(`${clean(text)} UTC`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function splitLocation(location) {
  const parts = clean(location).split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return { venue: null, city: null, country: null };
  if (parts.length === 1) return { venue: null, city: parts[0], country: null };
  return {
    venue: null,
    city: parts.slice(0, -1).join(', '),
    country: parts[parts.length - 1]
  };
}

function normalizeName(name) {
  return clean(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

async function fetchPage(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'UFC-Tactical-Dashboard/3.9 backfill (ufcstats.com)' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === retries) throw new Error(`${err.message} for ${url}`);
      await sleep(1000 * attempt);
    }
  }
}

async function fetchCompletedEvents({ numberedOnly }) {
  const html = await fetchPage(`${BASE}/statistics/events/completed?page=all`);
  const $ = cheerio.load(html);
  const events = [];

  $('tr.b-statistics__table-row').each((_, row) => {
    const link = $(row).find('a.b-link');
    if (!link.length) return;

    const name = clean(link.text());
    const href = link.attr('href');
    const hash = hashFromUrl(href);
    if (!hash) return;

    const numMatch = name.match(/^UFC\s+(\d+)/i);
    if (numberedOnly && !numMatch) return;

    const location = clean($(row).find('td').eq(1).text());
    events.push({
      number: numMatch ? Number(numMatch[1]) : null,
      name,
      date: parseDate($(row).find('span.b-statistics__date').text()),
      location,
      ufcstats_hash: hash
    });
  });

  return events;
}

async function fetchEventCard(eventHash) {
  const html = await fetchPage(`${BASE}/event-details/${eventHash}`);
  const $ = cheerio.load(html);
  const fights = [];

  $('tr.b-fight-details__table-row.js-fight-details-click').each((i, row) => {
    const fightHash = hashFromUrl($(row).attr('data-link'));
    const cols = $(row).find('td');
    const texts = index => $(cols[index]).find('p.b-fight-details__table-text')
      .map((_, p) => clean($(p).text()))
      .get();

    const results = texts(0);
    const names = texts(1);
    const methodCell = clean($(cols[7]).text());
    const methodParts = methodCell.split(/\s{2,}/).map(clean).filter(Boolean);

    fights.push({
      ufcstats_hash: fightHash,
      red_name: names[0] || null,
      blue_name: names[1] || null,
      weight_class: clean($(cols[6]).text()) || null,
      is_title: /title/i.test(clean($(cols[6]).text())) ? 1 : 0,
      is_main: i === 0 ? 1 : 0,
      card_position: i + 1,
      method: methodParts[0] || methodCell || null,
      method_detail: methodParts.slice(1).join(' ') || null,
      round: Number(clean($(cols[8]).text())) || null,
      time: clean($(cols[9]).text()) || null,
      winner_side: results[0] === 'win' ? 'red' : results[1] === 'win' ? 'blue' : null,
      has_stats: 0
    });
  });

  return fights.filter(f => f.red_name && f.blue_name);
}

function nextId(rows) {
  return Math.max(0, ...rows.map(row => Number(row.id) || 0)) + 1;
}

function fightKey(eventId, fight) {
  const names = [normalizeName(fight.red_name), normalizeName(fight.blue_name)].sort().join('|');
  return `${eventId}:${names}:${fight.card_position || ''}`;
}

async function main() {
  const args = process.argv.slice(2);
  const numberedOnly = args.includes('--numbered-only');
  const dryRun = args.includes('--dry-run');
  const delayArg = args.find(arg => arg.startsWith('--delay-ms='));
  const delayMs = delayArg ? Number(delayArg.split('=')[1]) : DEFAULT_DELAY_MS;

  const seedPath = path.join(__dirname, 'seed.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  seed.fighters ||= [];
  seed.events ||= [];
  seed.fights ||= [];

  const events = await fetchCompletedEvents({ numberedOnly });
  console.log(`Fetched ${events.length} completed ${numberedOnly ? 'numbered ' : ''}events`);

  const eventByNumber = new Map(seed.events.filter(e => e.number != null).map(e => [Number(e.number), e]));
  const eventByHash = new Map(seed.events.filter(e => e.ufcstats_hash).map(e => [e.ufcstats_hash, e]));
  const eventByNameDate = new Map(seed.events.map(e => [`${normalizeName(e.name)}|${e.date || ''}`, e]));
  const fighterByHash = new Map(seed.fighters.filter(f => f.ufcstats_hash).map(f => [f.ufcstats_hash, f]));
  const fighterByName = new Map(seed.fighters.map(f => [normalizeName(f.name), f]));
  const existingFightHashes = new Set(seed.fights.map(f => f.ufcstats_hash).filter(Boolean));
  const existingFightKeys = new Set(seed.fights.map(f => fightKey(f.event_id, f)));

  let nextEventId = nextId(seed.events);
  let nextFighterId = nextId(seed.fighters);
  let nextFightId = nextId(seed.fights);
  const added = { events: 0, fighters: 0, fights: 0 };
  const updated = { event_hashes: 0 };

  function getOrCreateFighter(name, hash) {
    const hashHit = hash ? fighterByHash.get(hash) : null;
    if (hashHit) return hashHit;

    const nameKey = normalizeName(name);
    const nameHit = fighterByName.get(nameKey);
    if (nameHit) {
      if (hash && !nameHit.ufcstats_hash) {
        nameHit.ufcstats_hash = hash;
      }
      if (hash) fighterByHash.set(hash, nameHit);
      return nameHit;
    }

    const fighter = {
      id: nextFighterId++,
      name,
      nickname: null,
      height_cm: null,
      reach_cm: null,
      stance: null,
      weight_class: null,
      nationality: null,
      ufcstats_hash: hash || null
    };
    seed.fighters.push(fighter);
    fighterByName.set(nameKey, fighter);
    if (hash) fighterByHash.set(hash, fighter);
    added.fighters++;
    return fighter;
  }

  for (let i = 0; i < events.length; i++) {
    const scraped = events[i];
    let event = eventByHash.get(scraped.ufcstats_hash)
      || (scraped.number != null ? eventByNumber.get(scraped.number) : null)
      || eventByNameDate.get(`${normalizeName(scraped.name)}|${scraped.date || ''}`);

    if (!event) {
      const loc = splitLocation(scraped.location);
      event = {
        id: nextEventId++,
        number: scraped.number,
        name: scraped.name,
        date: scraped.date,
        venue: loc.venue,
        city: loc.city,
        country: loc.country,
        ufcstats_hash: scraped.ufcstats_hash
      };
      seed.events.push(event);
      added.events++;
    } else if (!event.ufcstats_hash) {
      event.ufcstats_hash = scraped.ufcstats_hash;
      updated.event_hashes++;
    }

    eventByHash.set(scraped.ufcstats_hash, event);
    if (event.number != null) eventByNumber.set(Number(event.number), event);
    eventByNameDate.set(`${normalizeName(event.name)}|${event.date || ''}`, event);

    await sleep(delayMs);
    const card = await fetchEventCard(scraped.ufcstats_hash);
    for (const bout of card) {
      const key = fightKey(event.id, bout);
      if ((bout.ufcstats_hash && existingFightHashes.has(bout.ufcstats_hash)) || existingFightKeys.has(key)) {
        continue;
      }

      const red = getOrCreateFighter(bout.red_name, null);
      const blue = getOrCreateFighter(bout.blue_name, null);
      const fight = {
        id: nextFightId++,
        event_id: event.id,
        event_number: event.number || null,
        red_fighter_id: red.id,
        blue_fighter_id: blue.id,
        red_name: bout.red_name,
        blue_name: bout.blue_name,
        weight_class: bout.weight_class,
        is_title: bout.is_title,
        is_main: bout.is_main,
        card_position: bout.card_position,
        method: bout.method,
        method_detail: bout.method_detail,
        round: bout.round,
        time: bout.time,
        winner_id: bout.winner_side === 'red' ? red.id : bout.winner_side === 'blue' ? blue.id : null,
        referee: null,
        has_stats: bout.has_stats,
        ufcstats_hash: bout.ufcstats_hash
      };
      seed.fights.push(fight);
      if (fight.ufcstats_hash) existingFightHashes.add(fight.ufcstats_hash);
      existingFightKeys.add(key);
      added.fights++;
    }

    if ((i + 1) % 25 === 0 || i === events.length - 1) {
      console.log(`${i + 1}/${events.length}: +${added.events} events, +${added.fighters} fighters, +${added.fights} fights`);
    }
  }

  seed.events.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || (b.id - a.id));
  seed._meta = {
    ...(seed._meta || {}),
    source: 'ufcstats.com + curated upcoming seed',
    updated_at: new Date().toISOString(),
    events_count: seed.events.length,
    fights_count: seed.fights.length,
    fighters_count: seed.fighters.length,
    backfill: { added, updated, numbered_only: numberedOnly }
  };

  if (dryRun) {
    console.log(JSON.stringify({ status: 'dry_run', added, updated, totals: seed._meta }, null, 2));
    return;
  }

  fs.writeFileSync(seedPath, JSON.stringify(seed, null, 2));
  console.log(JSON.stringify({ status: 'ok', added, updated, totals: seed._meta }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
