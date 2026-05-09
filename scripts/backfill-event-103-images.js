#!/usr/bin/env node
/**
 * scripts/backfill-event-103-images.js
 *
 * Best-effort headshot + body URL backfill for the 11 event-103 fighters
 * missing them. Hits ufc.com/athlete/<slug> for each. Polite 1.5s delay.
 *
 * Slug heuristic: lowercase name, strip diacritics, replace spaces with
 * hyphens. UFC.com follows that pattern for the vast majority of athletes;
 * misses just log and continue (the existing JSON-driven build-fighter-images
 * job remains the canonical pipeline for cases the heuristic misses).
 *
 * --dry-run by default; --apply to write.
 */
const { Pool } = require('pg');
const { fetchAthlete } = require('../data/scrapers/ufc-com-athlete');

const APPLY = process.argv.includes('--apply');
const tag = APPLY ? '[apply]' : '[dry-run]';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function slugify(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });

  let headshotUpdates = 0, bodyUpdates = 0, fails = 0;
  try {
    const rows = (await pool.query(`
      SELECT DISTINCT f.id, f.name, f.headshot_url, f.body_url
        FROM fighters f
        JOIN fights fight ON (fight.red_fighter_id = f.id OR fight.blue_fighter_id = f.id)
       WHERE fight.event_id = 103
         AND (f.headshot_url IS NULL OR f.body_url IS NULL)
       ORDER BY f.name
    `)).rows;

    console.log(`=== Image backfill — ${rows.length} fighter(s) need a headshot or body image ===\n`);
    for (const r of rows) {
      const slug = slugify(r.name);
      try {
        const a = await fetchAthlete(slug);
        const newHeadshot = (!r.headshot_url && a.headshot_url) ? a.headshot_url : null;
        const newBody = (!r.body_url && a.body_url) ? a.body_url : null;
        if (!newHeadshot && !newBody) {
          console.log(`  ${r.name.padEnd(28)} ufc.com/athlete/${slug}: no image fields available`);
          await sleep(1500);
          continue;
        }
        if (newHeadshot) {
          console.log(`  ${tag} ${r.name.padEnd(28)} headshot: ${newHeadshot.slice(0, 80)}…`);
          if (APPLY) {
            const u = await pool.query(
              `UPDATE fighters SET headshot_url = $1 WHERE id = $2 AND headshot_url IS NULL`,
              [newHeadshot, r.id]
            );
            headshotUpdates += u.rowCount;
          }
        }
        if (newBody) {
          console.log(`  ${tag} ${r.name.padEnd(28)} body:     ${newBody.slice(0, 80)}…`);
          if (APPLY) {
            const u = await pool.query(
              `UPDATE fighters SET body_url = $1 WHERE id = $2 AND body_url IS NULL`,
              [newBody, r.id]
            );
            bodyUpdates += u.rowCount;
          }
        }
      } catch (e) {
        console.log(`  ${r.name.padEnd(28)} fetch failed (slug=${slug}): ${e.message}`);
        fails++;
      }
      await sleep(1500);
    }

    console.log(`\n${APPLY ? `Applied: ${headshotUpdates} headshot, ${bodyUpdates} body update(s).` : 'Dry-run complete.'}`);
    if (fails) console.log(`Fetch failures: ${fails}`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
