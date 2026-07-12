#!/usr/bin/env node
/**
 * scripts/insert-card-2026-07-11-ufc329-pg.js
 *
 * Direct-to-Postgres insert of the UFC 329: McGregor vs. Holloway 2 card
 * (T-Mobile Arena, Las Vegas, 2026-07-11) for the production DB.
 *
 * Why this exists: Railway has not deployed main since 2026-05-10, so the
 * normal path (deploy → POST /api/admin/import-seed) can't deliver this
 * card — the deployed seed.json predates it. This script follows the
 * scripts/patch-card-2026-05-30.js precedent: a prod-only, idempotent pg
 * patch run with DATABASE_URL pointed at the production database. It only
 * uses columns that exist in the v4.27.2 (currently deployed) schema.
 *
 * Sources: announced card as of fight day — see
 * scripts/add-card-2026-07-11-ufc329.js (same card, seed.json variant)
 * for the full citation list. No results are written; the deployed live
 * poller / post-event jobs ingest outcomes.
 *
 * Run:
 *   $env:DATABASE_URL = (...DATABASE_PUBLIC_URL...)   # or export DATABASE_URL=...
 *   node scripts/insert-card-2026-07-11-ufc329-pg.js --dry-run
 *   node scripts/insert-card-2026-07-11-ufc329-pg.js
 */
const { Pool } = require('pg');

const DRY = process.argv.includes('--dry-run');
const log = (...a) => console.log(DRY ? '[dry-run]' : '[apply]', ...a);

const EVENT = {
  number: 329,
  name: 'UFC 329: McGregor vs. Holloway 2',
  date: '2026-07-11',
  venue: 'T-Mobile Arena',
  city: 'Las Vegas, NV',
  country: 'USA',
  start_time: '2026-07-11T21:00:00.000Z',
  end_time: '2026-07-12T05:00:00.000Z',
  timezone: 'America/Los_Angeles'
};

// Announced card only. Fighters are resolved by exact name; any not present
// in prod are created with just (name, weight_class) — no fabricated stats.
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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL required (this script is prod-only).');
    process.exit(2);
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  const q = (sql, params = []) => pool.query(sql, params);
  const oneRow = async (sql, params) => (await q(sql, params)).rows[0] || null;

  try {
    // ── 1. Resolve or create every fighter on the card, by exact name ──
    const names = [...new Set(CARD.flatMap(c => [c.red, c.blue]))];
    const wcByName = {};
    for (const c of CARD) { wcByName[c.red] = c.wc; wcByName[c.blue] = c.wc; }
    const idByName = {};
    for (const name of names) {
      const rows = (await q(`SELECT id, name FROM fighters WHERE name = $1 ORDER BY id`, [name])).rows;
      if (rows.length > 1) {
        console.error(`ERROR: ${rows.length} fighter rows named "${name}" (ids ${rows.map(r => r.id).join(', ')}). Resolve manually.`);
        process.exit(4);
      }
      if (rows.length === 1) {
        idByName[name] = Number(rows[0].id);
        continue;
      }
      const max = await oneRow(`SELECT COALESCE(MAX(id), 0) AS m FROM fighters`);
      const newId = Number(max.m) + 1;
      idByName[name] = newId;
      log(`create fighter ${newId}: ${name} (${wcByName[name]})`);
      if (!DRY) {
        await q(`INSERT INTO fighters (id, name, weight_class) VALUES ($1, $2, $3)`,
          [newId, name, wcByName[name]]);
      }
    }

    // ── 2. Event (matched by name, case-insensitive) ──
    let event = await oneRow(`SELECT id, name FROM events WHERE LOWER(name) = LOWER($1)`, [EVENT.name]);
    if (event) {
      log(`event exists: ${event.id} ${event.name}`);
    } else {
      const max = await oneRow(`SELECT COALESCE(MAX(id), 0) AS m FROM events`);
      event = { id: Number(max.m) + 1, name: EVENT.name };
      log(`create event ${event.id}: ${EVENT.name} (${EVENT.date})`);
      if (!DRY) {
        await q(
          `INSERT INTO events (id, number, name, date, venue, city, country, start_time, end_time, timezone)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [event.id, EVENT.number, EVENT.name, EVENT.date, EVENT.venue, EVENT.city,
           EVENT.country, EVENT.start_time, EVENT.end_time, EVENT.timezone]
        );
      }
    }

    // ── 3. Fights (matched by event + corner pair, either order) ──
    let added = 0;
    for (const c of CARD) {
      const redId = idByName[c.red];
      const blueId = idByName[c.blue];
      if (DRY && (!redId || !blueId)) {
        log(`would create fight pos ${c.pos}: ${c.red} vs ${c.blue} (ids assigned on apply)`);
        continue;
      }
      const existing = await oneRow(
        `SELECT id, card_position FROM fights
         WHERE event_id = $1 AND (
           (red_fighter_id = $2 AND blue_fighter_id = $3) OR
           (red_fighter_id = $3 AND blue_fighter_id = $2))`,
        [event.id, redId, blueId]
      );
      if (existing) {
        log(`fight exists (id ${existing.id}, pos ${existing.card_position}): ${c.red} vs ${c.blue}`);
        continue;
      }
      const max = await oneRow(`SELECT COALESCE(MAX(id), 0) AS m FROM fights`);
      const fightId = Number(max.m) + 1;
      log(`create fight ${fightId} pos ${c.pos}: ${c.red} vs ${c.blue} (${c.wc}${c.main ? ', MAIN' : ''})`);
      if (!DRY) {
        await q(
          `INSERT INTO fights
             (id, event_id, event_number, red_fighter_id, blue_fighter_id, red_name, blue_name,
              weight_class, is_title, is_main, card_position)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10)`,
          [fightId, event.id, EVENT.number, redId, blueId, c.red, c.blue, c.wc, c.main, c.pos]
        );
      }
      added++;
    }

    log(`summary: event id ${event.id}, ${added} fight(s) inserted`);
    if (!DRY) {
      console.log('\nDone. The dashboard reads the DB directly — the card should be visible immediately.');
      console.log('If the app caches, POST /api/admin/save or wait for cache TTL.');
    } else {
      console.log('\n[dry-run] no changes written.');
    }
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
