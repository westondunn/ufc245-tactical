#!/usr/bin/env node
/**
 * scripts/realign-event-103-positions.js
 *
 * Realign fights.card_position for event 103 to match ufcstats's
 * chronological order (main = position 1, first opener = highest position).
 * Required because Miller/Gordon was inserted at position 13 after the fact
 * and Dawson/Alvarez were swapped between positions 7 and 8 in the seed.
 *
 * Picks reference fight_id, never card_position, so this is a pure
 * display-order change. --apply to commit.
 */
const { Pool } = require('pg');
const APPLY = process.argv.includes('--apply');

// Map: fight id → desired card_position (per ufcstats event listing order
// for UFC 328: main is position 1, first opener is position 13).
const TARGET = {
  765: 1,  // Chimaev vs Strickland (main)
  766: 2,  // Van vs Taira
  767: 3,  // Volkov vs Cortes Acosta
  768: 4,  // Brady vs Buckley
  769: 5,  // Green vs Stephens
  770: 6,  // Gautier vs Diaz
  772: 7,  // Alvarez vs Amosov
  771: 8,  // Dawson vs Rebecki
  8811: 9, // Miller vs Gordon
  773: 10, // Kopylov vs Tulio
  774: 11, // Sabatini vs Gomis
  775: 12, // Susurkaev vs Santos
  776: 13, // Carpenter vs Ochoa
};

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  const tag = APPLY ? '[apply]' : '[dry-run]';
  let updates = 0;
  try {
    const cur = await pool.query(
      `SELECT id, card_position, red_name, blue_name FROM fights WHERE event_id = 103 ORDER BY card_position`
    );
    const byId = new Map(cur.rows.map(r => [r.id, r]));
    // Picks sanity check — these must remain untouched.
    const picksBefore = (await pool.query(
      `SELECT COUNT(*) AS c FROM user_picks WHERE event_id = 103`
    )).rows[0].c;
    console.log(`event 103 has ${cur.rows.length} fights and ${picksBefore} user_pick rows before the move.`);

    // Step 1: shift every event-103 row to a unique negative card_position
    // so the second-pass updates don't collide on a unique-friendly index
    // (none today, but cheap insurance).
    if (APPLY) {
      await pool.query(
        `UPDATE fights SET card_position = -card_position - 100 WHERE event_id = 103`
      );
    }

    for (const [idStr, want] of Object.entries(TARGET)) {
      const id = parseInt(idStr, 10);
      const row = byId.get(id);
      if (!row) { console.log(`  fight ${id}: not on event 103 → skip`); continue; }
      const have = row.card_position;
      console.log(`  ${tag} fight ${id} (${row.red_name} vs ${row.blue_name}): ${have} → ${want}`);
      if (APPLY) {
        const r = await pool.query(
          `UPDATE fights SET card_position = $1 WHERE id = $2`,
          [want, id]
        );
        updates += r.rowCount;
      }
    }

    if (APPLY) {
      const after = await pool.query(
        `SELECT id, card_position, red_name, blue_name FROM fights WHERE event_id = 103 ORDER BY card_position`
      );
      console.log('\nAfter realignment:');
      for (const r of after.rows) {
        console.log(`  pos=${String(r.card_position).padStart(2)} id=${r.id} ${r.red_name} vs ${r.blue_name}`);
      }
      const picksAfter = (await pool.query(
        `SELECT COUNT(*) AS c FROM user_picks WHERE event_id = 103`
      )).rows[0].c;
      console.log(`\nuser_picks rows after the move: ${picksAfter} (expected ${picksBefore}).`);
      if (picksAfter !== picksBefore) {
        console.log('!! pick count drifted — investigate');
      }
    }

    console.log(`\n${APPLY ? `Applied ${updates} update(s).` : 'Dry-run complete.'}`);
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
