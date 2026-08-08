#!/usr/bin/env node
/**
 * scripts/add-card-2026-07-11-ufc329.js
 *
 * Curated seed merge for UFC 329: McGregor vs. Holloway 2
 * (T-Mobile Arena, Las Vegas, NV — Saturday 2026-07-11).
 *
 * data/scrape-upcoming.js is the normal path for pulling upcoming cards
 * off ufc.com, but ufc.com is unreachable from the maintenance
 * environment, so this card is merged from the announced lineup instead.
 * Fights are added without results (winner_id/method null) exactly like
 * scraped upcoming events; results land later via data/scrape-results.js.
 *
 * Sources (announced card as of fight day, 2026-07-11):
 *   - https://www.ufc.com/event/ufc-329
 *   - https://en.wikipedia.org/wiki/UFC_329
 *   - https://www.tapology.com/fightcenter/events/140956-ufc-330
 *   - https://www.sherdog.com/events/UFC-329-McGregor-vs-Holloway-2-111889
 *   - https://www.forbes.com/sites/trentreinsmith/2026/07/06/ufc-329-full-fight-card-date-time-location-odds-how-to-watch/
 *
 * Idempotent: matches the event by name (case-insensitive) and fighters
 * by name, so re-running never duplicates rows. After deploy, sync the
 * live DB with POST /api/admin/import-seed.
 *
 * Run:
 *   node scripts/add-card-2026-07-11-ufc329.js --dry-run
 *   node scripts/add-card-2026-07-11-ufc329.js
 */
const fs = require('fs');
const path = require('path');

const SEED_PATH = path.join(__dirname, '..', 'data', 'seed.json');
const DRY = process.argv.includes('--dry-run');
const log = (...a) => console.log(DRY ? '[dry-run]' : '[apply]', ...a);

const EVENT = {
  number: 329,
  name: 'UFC 329: McGregor vs. Holloway 2',
  date: '2026-07-11',
  venue: 'T-Mobile Arena',
  city: 'Las Vegas, NV',
  country: 'USA',
  ufcstats_hash: null,
  ufc_slug: 'ufc-329',
  // Early prelims 5pm ET / 2pm PT; main card 9pm ET. End padded past the
  // main event like the other curated upcoming events.
  start_time: '2026-07-11T21:00:00.000Z',
  end_time: '2026-07-12T05:00:00.000Z',
  timezone: 'America/Los_Angeles'
};

// Announced card only — no profile stats are invented for new fighters
// (nulls until data/scrapers backfill them from UFCStats).
const NEW_FIGHTERS = [
  { name: 'Gable Steveson', weight_class: 'Heavyweight' },
  { name: 'John Garza', weight_class: 'Bantamweight' }
];

// card_position 1 = main event. Main card 1–6, prelims 7–9,
// early prelims 10–14, per the announced broadcast order.
const CARD = [
  { red: 'Conor McGregor', blue: 'Max Holloway', wc: 'Welterweight', main: 1, pos: 1 },
  { red: 'Benoit Saint Denis', blue: 'Paddy Pimblett', wc: 'Lightweight', main: 0, pos: 2 },
  { red: 'Cory Sandhagen', blue: 'Mario Bautista', wc: 'Bantamweight', main: 0, pos: 3 },
  { red: 'Brandon Royval', blue: "Lone'er Kavanagh", wc: 'Flyweight', main: 0, pos: 4 },
  { red: 'King Green', blue: 'Terrance McKinney', wc: 'Lightweight', main: 0, pos: 5 },
  { red: 'Robert Whittaker', blue: 'Nikita Krylov', wc: 'Light Heavyweight', main: 0, pos: 6 },
  { red: 'Gable Steveson', blue: 'Elisha Ellison', wc: 'Heavyweight', main: 0, pos: 7 },
  { red: 'Cody Garbrandt', blue: 'Adrian Yanez', wc: 'Bantamweight', main: 0, pos: 8 },
  { red: 'Luke Riley', blue: 'Kai Kamaka III', wc: 'Featherweight', main: 0, pos: 9 },
  { red: 'Wang Cong', blue: 'Tracy Cortez', wc: 'W-Flyweight', main: 0, pos: 10 },
  { red: 'Damian Pinas', blue: 'Cesar Almeida', wc: 'Middleweight', main: 0, pos: 11 },
  { red: 'Farid Basharat', blue: 'John Garza', wc: 'Bantamweight', main: 0, pos: 12 },
  { red: 'Ryan Gandra', blue: 'Zach Reese', wc: 'Middleweight', main: 0, pos: 13 },
  { red: 'Alessandro Costa', blue: 'Cody Durden', wc: 'Flyweight', main: 0, pos: 14 }
];

function main() {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'));

  const fightersByName = new Map(seed.fighters.map(f => [f.name.toLowerCase(), f]));
  const added = { fighters: 0, events: 0, fights: 0 };

  // 1. New fighters (skip any that already exist).
  let nextFighterId = Math.max(...seed.fighters.map(f => f.id)) + 1;
  for (const nf of NEW_FIGHTERS) {
    if (fightersByName.has(nf.name.toLowerCase())) {
      log(`fighter exists, skipping: ${nf.name}`);
      continue;
    }
    const row = {
      id: nextFighterId++,
      name: nf.name, nickname: null,
      height_cm: null, reach_cm: null, stance: null,
      weight_class: nf.weight_class, nationality: null,
      slpm: null, str_acc: null, sapm: null, str_def: null,
      td_avg: null, td_acc: null, td_def: null, sub_avg: null
    };
    seed.fighters.push(row);
    fightersByName.set(row.name.toLowerCase(), row);
    added.fighters++;
    log(`add fighter ${row.id}: ${row.name} (${row.weight_class})`);
  }

  // 2. Event (matched by name, case-insensitive — same identity rule as
  //    data/scrape-upcoming.js).
  let event = seed.events.find(e => (e.name || '').toLowerCase() === EVENT.name.toLowerCase());
  if (event) {
    log(`event exists, skipping: ${event.id} ${event.name}`);
  } else {
    event = { id: Math.max(...seed.events.map(e => e.id)) + 1, ...EVENT };
    seed.events.push(event);
    added.events++;
    log(`add event ${event.id}: ${event.name} (${event.date})`);
  }

  // 3. Fights (matched by event + corner pair).
  const existingPairs = new Set(
    seed.fights
      .filter(f => f.event_id === event.id)
      .map(f => `${f.red_fighter_id}-${f.blue_fighter_id}`)
  );
  let nextFightId = Math.max(...seed.fights.map(f => f.id)) + 1;
  for (const c of CARD) {
    const red = fightersByName.get(c.red.toLowerCase());
    const blue = fightersByName.get(c.blue.toLowerCase());
    if (!red || !blue) {
      console.error(`ERROR: missing fighter row for "${c.red}" vs "${c.blue}"`);
      process.exit(2);
    }
    if (existingPairs.has(`${red.id}-${blue.id}`) || existingPairs.has(`${blue.id}-${red.id}`)) {
      log(`fight exists, skipping: ${c.red} vs ${c.blue}`);
      continue;
    }
    seed.fights.push({
      id: nextFightId++, event_id: event.id, event_number: EVENT.number,
      red_fighter_id: red.id, blue_fighter_id: blue.id,
      red_name: red.name, blue_name: blue.name,
      weight_class: c.wc, is_title: 0, is_main: c.main, card_position: c.pos,
      method: null, method_detail: null, round: null, time: null,
      time_format: null, winner_id: null, referee: null,
      has_stats: 0, ufcstats_hash: null
    });
    added.fights++;
    log(`add fight pos ${c.pos}: ${c.red} vs ${c.blue} (${c.wc})`);
  }

  if (seed._meta) {
    seed._meta.events_count = seed.events.length;
    seed._meta.fights_count = seed.fights.length;
    seed._meta.fighters_count = seed.fighters.length;
  }

  log(`summary: +${added.fighters} fighters, +${added.events} events, +${added.fights} fights`);
  if (DRY) {
    log('dry-run: seed.json not written');
    return;
  }
  fs.writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2) + '\n');
  log(`wrote ${SEED_PATH}`);
}

main();
