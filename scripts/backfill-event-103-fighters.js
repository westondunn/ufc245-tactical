#!/usr/bin/env node
/**
 * scripts/backfill-event-103-fighters.js
 *
 * Tonight (UFC 328) display-layer backfill:
 *   1. nickname  — scrape ufcstats fighter page for any event-103 fighter
 *                  whose `fighters.nickname` is null. Polite 1s delay.
 *   2. weight_class — copy from each fighter's event-103 bout
 *                     `fights.weight_class` so the profile shows their
 *                     current division (Title suffix already stripped).
 *
 * --dry-run by default; pass --apply to commit. Idempotent: rows that
 * already have the field set are skipped.
 */
const { Pool } = require('pg');
const { fetchFighter } = require('../data/scrapers/ufcstats-fighter');

const APPLY = process.argv.includes('--apply');
const tag = APPLY ? '[apply]' : '[dry-run]';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  let nicknameUpdates = 0;
  let weightUpdates = 0;
  try {
    // Fighters on the card with their event-103 bout's weight_class
    const rows = (await pool.query(`
      SELECT DISTINCT f.id, f.name, f.nickname, f.weight_class, f.ufcstats_hash,
             fight.weight_class AS bout_weight_class
        FROM fighters f
        JOIN fights fight ON (fight.red_fighter_id = f.id OR fight.blue_fighter_id = f.id)
       WHERE fight.event_id = 103
       ORDER BY f.name
    `)).rows;

    console.log(`=== A. weight_class backfill (from tonight's bout) ===`);
    for (const r of rows) {
      if (r.weight_class) { continue; }
      if (!r.bout_weight_class) {
        console.log(`  ${r.name}: bout has no weight_class → skip`);
        continue;
      }
      console.log(`  ${tag} ${r.name.padEnd(28)} weight_class: null → ${JSON.stringify(r.bout_weight_class)}`);
      if (APPLY) {
        const u = await pool.query(
          `UPDATE fighters SET weight_class = $1 WHERE id = $2 AND weight_class IS NULL`,
          [r.bout_weight_class, r.id]
        );
        weightUpdates += u.rowCount;
      }
    }

    console.log(`\n=== B. nickname backfill (scrape ufcstats) ===`);
    const needNick = rows.filter(r => !r.nickname && r.ufcstats_hash);
    console.log(`  scraping ${needNick.length} fighter page(s) (1s delay each)…`);
    for (const r of needNick) {
      try {
        const scraped = await fetchFighter(r.ufcstats_hash);
        const nn = scraped.nickname && String(scraped.nickname).trim() ? scraped.nickname.trim() : null;
        if (!nn) {
          console.log(`  ${r.name.padEnd(28)} ufcstats has no nickname → skip`);
          await sleep(1000);
          continue;
        }
        console.log(`  ${tag} ${r.name.padEnd(28)} nickname: null → ${JSON.stringify(nn)}`);
        if (APPLY) {
          const u = await pool.query(
            `UPDATE fighters SET nickname = $1 WHERE id = $2 AND nickname IS NULL`,
            [nn, r.id]
          );
          nicknameUpdates += u.rowCount;
        }
      } catch (e) {
        console.log(`  ${r.name.padEnd(28)} scrape failed: ${e.message}`);
      }
      await sleep(1000);
    }

    console.log(`\n${APPLY ? `Applied: ${weightUpdates} weight_class, ${nicknameUpdates} nickname update(s).` : 'Dry-run complete.'}`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
