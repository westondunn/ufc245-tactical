#!/usr/bin/env node
/**
 * scripts/link-event-103-stragglers.js
 *
 * Manual hash links for the two fighters on event 103 that the surname-only
 * auto-linker couldn't resolve:
 *   - Djorden Santos (id 276) — surname "Santos" returned too many candidates
 *   - Joshua Van    (id 250) — surname "Van" is too short for ufcstats search
 *
 * After linking, backfills missing profile fields the same way the bulk
 * linker does. The May 9 auto-link-by-name dispatcher PR should add a
 * first-name fallback so this kind of straggler resolves automatically.
 */
const { Pool } = require('pg');
const { parseFighterPage } = require('../data/scrapers/ufcstats-fighter');

const STRAGGLERS = [
  { id: 276, name: 'Djorden Santos', hash: '312f7d7b2b2f7de4' },
  { id: 250, name: 'Joshua Van',     hash: '17e97649403ba428' },
];

const FIELDS = ['height_cm', 'reach_cm', 'stance', 'dob', 'slpm', 'str_acc',
                'sapm', 'str_def', 'td_avg', 'td_acc', 'td_def', 'sub_avg'];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  for (const s of STRAGGLERS) {
    const cur = (await p.query('SELECT * FROM fighters WHERE id = $1', [s.id])).rows[0];
    if (!cur) { console.log(`${s.name}: not found, skipping`); continue; }
    if (cur.ufcstats_hash === s.hash) {
      console.log(`${s.name}: already linked, skipping`);
      continue;
    }
    const res = await fetch(`http://ufcstats.com/fighter-details/${s.hash}`,
      { headers: { 'User-Agent': 'UFC-Tactical-Dashboard/2.0' } });
    const html = await res.text();
    const prof = parseFighterPage(html, s.hash);
    console.log(`${s.name}: scraped profile ${prof.name}`);

    const updates = { ufcstats_hash: s.hash };
    for (const k of FIELDS) {
      if ((cur[k] == null || cur[k] === '') && prof[k] != null) updates[k] = prof[k];
    }
    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const params = [...keys.map(k => updates[k]), s.id];
    const r = await p.query(`UPDATE fighters SET ${setClause} WHERE id = $${keys.length + 1}`, params);
    console.log(`  applied ${r.rowCount} update with fields:`, Object.keys(updates));
    await sleep(1000);
  }
  await p.end();
  console.log('Remember to run rescale-percentage-fields next.');
}

main().catch(e => { console.error(e); process.exit(1); });
