#!/usr/bin/env node
/**
 * scripts/link-johnston.js
 *
 * One-shot manual link for fighter id 655 (Benjamin Johnston in our DB,
 * "Ben Johnston" on ufcstats.com — the search-based linker rejected this
 * because the names don't normalize-equal). Backfills profile fields too.
 */
const { Pool } = require('pg');
const { parseFighterPage } = require('../data/scrapers/ufcstats-fighter');

const HASH = '3261aa79bf6caa64';
const FID = 655;

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }
  const p = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  const cur = (await p.query('SELECT * FROM fighters WHERE id = $1', [FID])).rows[0];
  if (!cur) { console.error('fighter not found'); process.exit(1); }
  console.log('Existing row:', { id: cur.id, name: cur.name, ufcstats_hash: cur.ufcstats_hash });

  const res = await fetch(`http://ufcstats.com/fighter-details/${HASH}`, {
    headers: { 'User-Agent': 'UFC-Tactical-Dashboard/2.0' },
  });
  const html = await res.text();
  const prof = parseFighterPage(html, HASH);
  console.log('Scraped profile name:', prof.name);

  const fields = ['height_cm', 'reach_cm', 'stance', 'dob', 'slpm', 'str_acc',
                  'sapm', 'str_def', 'td_avg', 'td_acc', 'td_def', 'sub_avg'];
  const updates = { ufcstats_hash: HASH };
  for (const k of fields) {
    if ((cur[k] == null || cur[k] === '') && prof[k] != null) updates[k] = prof[k];
  }
  console.log('Updates:', updates);

  const keys = Object.keys(updates);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const params = [...keys.map(k => updates[k]), FID];
  const r = await p.query(`UPDATE fighters SET ${setClause} WHERE id = $${keys.length + 1}`, params);
  console.log('Rows updated:', r.rowCount);
  await p.end();
}

main().catch(e => { console.error(e); process.exit(1); });
