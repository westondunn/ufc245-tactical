#!/usr/bin/env node
/**
 * scripts/link-gantt.js
 *
 * Manual hash link for fighter id 665 (DB: "Thomas Gantt", ufcstats: "Tommy
 * Gantt"). Same nickname-vs-formal-name class as the Johnston straggler from
 * 2026-05-02 — the surname-only auto-linker can't bridge it.
 */
const { Pool } = require('pg');
const { parseFighterPage } = require('../data/scrapers/ufcstats-fighter');

const HASH = 'de83f920fd302871';
const FID = 665;

const FIELDS = ['height_cm', 'reach_cm', 'stance', 'dob', 'slpm', 'str_acc',
                'sapm', 'str_def', 'td_avg', 'td_acc', 'td_def', 'sub_avg'];

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  const cur = (await p.query('SELECT * FROM fighters WHERE id = $1', [FID])).rows[0];
  if (!cur) { console.error('fighter not found'); process.exit(1); }
  if (cur.ufcstats_hash === HASH) {
    console.log(`${cur.name}: already linked`);
    await p.end();
    return;
  }
  const res = await fetch(`http://ufcstats.com/fighter-details/${HASH}`,
    { headers: { 'User-Agent': 'UFC-Tactical-Dashboard/2.0' } });
  const prof = parseFighterPage(await res.text(), HASH);
  console.log(`${cur.name}: scraped profile ${prof.name}`);

  const updates = { ufcstats_hash: HASH };
  for (const k of FIELDS) {
    if ((cur[k] == null || cur[k] === '') && prof[k] != null) updates[k] = prof[k];
  }
  const keys = Object.keys(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const params = [...keys.map(k => updates[k]), FID];
  const r = await p.query(`UPDATE fighters SET ${setClause} WHERE id = $${keys.length + 1}`, params);
  console.log(`Applied ${r.rowCount} update with fields:`, Object.keys(updates));
  await p.end();
  console.log('Now run: node scripts/rescale-percentage-fields.js --event=104 --apply');
}

main().catch(e => { console.error(e); process.exit(1); });
