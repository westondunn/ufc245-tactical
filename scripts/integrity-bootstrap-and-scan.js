#!/usr/bin/env node
/**
 * scripts/integrity-bootstrap-and-scan.js
 *
 * Bootstrap edition of the data-integrity tracker. Creates the
 * data_integrity_issues table on first run, then executes 17 scanner
 * queries against the live DB and upserts findings.
 *
 * Behaviour:
 *   - New violation  → INSERT new row with first_seen_at = last_seen_at = now
 *   - Repeat finding → UPDATE last_seen_at = now (first_seen_at preserved)
 *   - Open row not seen this run → mark resolved with resolution = 'auto_resolved'
 *
 * This is the interim implementation. The May 10 PR replaces it with a
 * proper scanner registry, HTTP API, and CLI. Until then, query the
 * data_integrity_issues table directly:
 *
 *   SELECT category, severity, COUNT(*) FROM data_integrity_issues
 *   WHERE resolved_at IS NULL GROUP BY category, severity ORDER BY 1;
 *
 * Run:
 *   $env:DATABASE_URL = ...
 *   $env:PGSSLMODE = 'require'
 *   node scripts/integrity-bootstrap-and-scan.js
 *   node scripts/integrity-bootstrap-and-scan.js --dry-run
 */
const { Pool } = require('pg');
const crypto = require('crypto');

const DRY = process.argv.includes('--dry-run');
const RUN_ID = crypto.randomBytes(8).toString('hex');
const NOW = new Date().toISOString();

// Severity policy: anything that affects active predictions or live picks
// is 'block'. Cosmetic / bookkeeping is 'info'. Everything else is 'warn'.
const SCANNERS = [
  // ── BLOCK severity ──
  {
    category: 'missing_hash', severity: 'block', subjectType: 'fighter',
    description: 'Fighter on imminent event has no ufcstats_hash',
    sql: `
      SELECT DISTINCT fighter.id::text AS subject_id,
             jsonb_build_object('event_id', e.id, 'event_date', e.date,
                                'fighter_name', fighter.name) AS details
      FROM events e
      JOIN fights f ON f.event_id = e.id
      JOIN fighters fighter ON fighter.id IN (f.red_fighter_id, f.blue_fighter_id)
      WHERE e.date BETWEEN to_char(CURRENT_DATE, 'YYYY-MM-DD')
                       AND to_char(CURRENT_DATE + INTERVAL '14 days', 'YYYY-MM-DD')
        AND fighter.ufcstats_hash IS NULL
    `,
  },
  {
    category: 'missing_core_stats', severity: 'block', subjectType: 'fighter',
    description: 'Fighter on imminent event missing core stats fields',
    sql: `
      SELECT DISTINCT fighter.id::text AS subject_id,
             jsonb_build_object('event_id', e.id, 'event_date', e.date,
               'fighter_name', fighter.name,
               'missing', array_remove(ARRAY[
                 CASE WHEN fighter.height_cm IS NULL THEN 'height_cm' END,
                 CASE WHEN fighter.reach_cm  IS NULL THEN 'reach_cm'  END,
                 CASE WHEN fighter.stance    IS NULL THEN 'stance'    END,
                 CASE WHEN fighter.slpm      IS NULL THEN 'slpm'      END,
                 CASE WHEN fighter.str_acc   IS NULL THEN 'str_acc'   END,
                 CASE WHEN fighter.str_def   IS NULL THEN 'str_def'   END,
                 CASE WHEN fighter.td_avg    IS NULL THEN 'td_avg'    END,
                 CASE WHEN fighter.td_def    IS NULL THEN 'td_def'    END
               ], NULL)
             ) AS details
      FROM events e
      JOIN fights f ON f.event_id = e.id
      JOIN fighters fighter ON fighter.id IN (f.red_fighter_id, f.blue_fighter_id)
      WHERE e.date BETWEEN to_char(CURRENT_DATE, 'YYYY-MM-DD')
                       AND to_char(CURRENT_DATE + INTERVAL '14 days', 'YYYY-MM-DD')
        AND (fighter.height_cm IS NULL OR fighter.reach_cm IS NULL OR fighter.stance IS NULL
             OR fighter.slpm IS NULL OR fighter.str_acc IS NULL OR fighter.str_def IS NULL
             OR fighter.td_avg IS NULL OR fighter.td_def IS NULL)
    `,
  },
  {
    category: 'fraction_scale', severity: 'block', subjectType: 'fighter',
    description: 'Percentage field stored as 0..1 fraction (should be 0..100)',
    sql: `
      SELECT id::text AS subject_id,
             jsonb_build_object('name', name,
               'str_acc', str_acc, 'str_def', str_def,
               'td_acc', td_acc, 'td_def', td_def) AS details
      FROM fighters
      WHERE (str_acc > 0 AND str_acc < 1)
         OR (str_def > 0 AND str_def < 1)
         OR (td_acc  > 0 AND td_acc  < 1)
         OR (td_def  > 0 AND td_def  < 1)
    `,
  },
  {
    category: 'orphaned_pick', severity: 'block', subjectType: 'pick',
    description: 'User pick references a fighter no longer in the fight',
    sql: `
      SELECT p.id::text AS subject_id,
             jsonb_build_object('user_id', p.user_id, 'fight_id', p.fight_id,
               'picked_fighter_id', p.picked_fighter_id,
               'fight_red', f.red_fighter_id, 'fight_blue', f.blue_fighter_id,
               'red_name', f.red_name, 'blue_name', f.blue_name,
               'locked_at', p.locked_at) AS details
      FROM user_picks p
      JOIN fights f ON f.id = p.fight_id
      WHERE p.picked_fighter_id NOT IN (f.red_fighter_id, f.blue_fighter_id)
    `,
  },
  {
    category: 'stale_prediction', severity: 'block', subjectType: 'prediction',
    description: "Active prediction's red/blue ids don't match fight's corners",
    sql: `
      SELECT pred.id::text AS subject_id,
             jsonb_build_object('fight_id', pred.fight_id,
               'pred_red', pred.red_fighter_id, 'pred_blue', pred.blue_fighter_id,
               'fight_red', f.red_fighter_id, 'fight_blue', f.blue_fighter_id,
               'predicted_at', pred.predicted_at) AS details
      FROM predictions pred
      JOIN fights f ON f.id = pred.fight_id
      WHERE pred.is_stale = 0
        AND (pred.red_fighter_id  NOT IN (f.red_fighter_id, f.blue_fighter_id)
          OR pred.blue_fighter_id NOT IN (f.red_fighter_id, f.blue_fighter_id))
    `,
  },
  {
    category: 'fk_orphan_fighter', severity: 'block', subjectType: 'fight',
    description: "Fight references a fighter that doesn't exist",
    sql: `
      SELECT f.id::text AS subject_id,
             jsonb_build_object('event_id', f.event_id,
               'red_fighter_id', f.red_fighter_id, 'blue_fighter_id', f.blue_fighter_id,
               'red_missing', r.id IS NULL, 'blue_missing', b.id IS NULL) AS details
      FROM fights f
      LEFT JOIN fighters r ON r.id = f.red_fighter_id
      LEFT JOIN fighters b ON b.id = f.blue_fighter_id
      WHERE r.id IS NULL OR b.id IS NULL
    `,
  },
  {
    category: 'fk_orphan_event', severity: 'block', subjectType: 'fight',
    description: "Fight references an event that doesn't exist",
    sql: `
      SELECT f.id::text AS subject_id,
             jsonb_build_object('event_id', f.event_id) AS details
      FROM fights f
      LEFT JOIN events e ON e.id = f.event_id
      WHERE e.id IS NULL
    `,
  },
  {
    category: 'pick_correct_winner_mismatch', severity: 'block', subjectType: 'pick',
    description: "Pick scored correct=1 but picked fighter isn't the actual winner",
    sql: `
      SELECT id::text AS subject_id,
             jsonb_build_object('user_id', user_id, 'fight_id', fight_id,
               'picked_fighter_id', picked_fighter_id,
               'actual_winner_id', actual_winner_id, 'points', points) AS details
      FROM user_picks
      WHERE correct = 1 AND picked_fighter_id <> actual_winner_id
    `,
  },

  // ── WARN severity ──
  {
    category: 'card_position_collision', severity: 'warn', subjectType: 'event',
    description: 'Multiple fights share the same card_position within an event',
    sql: `
      SELECT event_id::text AS subject_id,
             jsonb_build_object('card_position', card_position,
               'fight_count', COUNT(*), 'fight_ids', array_agg(id ORDER BY id)) AS details
      FROM fights
      WHERE card_position IS NOT NULL
      GROUP BY event_id, card_position
      HAVING COUNT(*) > 1
    `,
  },
  {
    category: 'card_position_gap', severity: 'warn', subjectType: 'event',
    description: 'Card positions have gaps (max(card_position) != count(fights))',
    sql: `
      WITH per_event AS (
        SELECT event_id, MAX(card_position) AS max_pos, COUNT(*) AS n_fights
        FROM fights WHERE card_position IS NOT NULL GROUP BY event_id
      )
      SELECT event_id::text AS subject_id,
             jsonb_build_object('max_position', max_pos, 'fight_count', n_fights) AS details
      FROM per_event WHERE max_pos <> n_fights
    `,
  },
  {
    category: 'main_event_collision', severity: 'warn', subjectType: 'event',
    description: 'Event has more than one fight flagged is_main',
    sql: `
      SELECT event_id::text AS subject_id,
             jsonb_build_object('main_count', COUNT(*),
               'fight_ids', array_agg(id ORDER BY id)) AS details
      FROM fights WHERE is_main = 1
      GROUP BY event_id HAVING COUNT(*) > 1
    `,
  },
  {
    category: 'outcome_winner_drift', severity: 'warn', subjectType: 'fight',
    description: 'fights.winner_id disagrees with official_fight_outcomes.winner_id',
    sql: `
      SELECT f.id::text AS subject_id,
             jsonb_build_object('fight_winner', f.winner_id,
               'official_winner', o.winner_id, 'official_status', o.status) AS details
      FROM fights f
      JOIN official_fight_outcomes o ON o.fight_id = f.id
      WHERE o.winner_id IS NOT NULL AND f.winner_id IS NOT NULL
        AND f.winner_id <> o.winner_id
    `,
  },
  {
    category: 'past_event_unresolved', severity: 'warn', subjectType: 'event',
    description: 'Past event still has fights without winner / method',
    sql: `
      SELECT e.id::text AS subject_id,
             jsonb_build_object('name', e.name, 'date', e.date,
               'unresolved_count', COUNT(*)) AS details
      FROM events e
      JOIN fights f ON f.event_id = e.id
      WHERE e.date < to_char(CURRENT_DATE - INTERVAL '2 days', 'YYYY-MM-DD')
        AND f.winner_id IS NULL
        AND (f.method IS NULL OR f.method = '')
      GROUP BY e.id, e.name, e.date
    `,
  },
  {
    category: 'prediction_unreconciled', severity: 'warn', subjectType: 'prediction',
    description: 'Prediction for a finished fight was never reconciled',
    sql: `
      SELECT pred.id::text AS subject_id,
             jsonb_build_object('fight_id', pred.fight_id,
               'model_version', pred.model_version,
               'fight_winner', f.winner_id) AS details
      FROM predictions pred
      JOIN fights f ON f.id = pred.fight_id
      WHERE f.winner_id IS NOT NULL
        AND pred.reconciled_at IS NULL
    `,
  },
  {
    category: 'pick_half_reconciled', severity: 'warn', subjectType: 'pick',
    description: 'Pick has actual_winner_id but correct IS NULL',
    sql: `
      SELECT id::text AS subject_id,
             jsonb_build_object('user_id', user_id, 'fight_id', fight_id,
               'actual_winner_id', actual_winner_id) AS details
      FROM user_picks
      WHERE actual_winner_id IS NOT NULL AND correct IS NULL
    `,
  },
  {
    category: 'prob_sum_off', severity: 'warn', subjectType: 'prediction',
    description: 'Prediction red+blue probabilities do not sum to 1.0',
    sql: `
      SELECT id::text AS subject_id,
             jsonb_build_object('fight_id', fight_id,
               'red', red_win_prob, 'blue', blue_win_prob,
               'sum', red_win_prob + blue_win_prob) AS details
      FROM predictions
      WHERE ABS(red_win_prob + blue_win_prob - 1.0) > 0.001
    `,
  },

  // ── INFO severity ──
  {
    category: 'duplicate_fighter', severity: 'info', subjectType: 'fighter',
    description: 'Multiple fighter rows share the same normalized name',
    sql: `
      SELECT MIN(id)::text AS subject_id,
             jsonb_build_object(
               'normalized_name', lower(regexp_replace(name, '[^a-zA-Z0-9 ]', '', 'g')),
               'count', COUNT(*),
               'ids', array_agg(id ORDER BY id),
               'names', array_agg(name)
             ) AS details
      FROM fighters
      GROUP BY lower(regexp_replace(name, '[^a-zA-Z0-9 ]', '', 'g'))
      HAVING COUNT(*) > 1
    `,
  },
];

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS data_integrity_issues (
    id BIGSERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    subject_type TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    details JSONB,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    resolution TEXT,
    resolution_note TEXT,
    resolution_run_id TEXT,
    UNIQUE(category, subject_type, subject_id)
  );
  CREATE INDEX IF NOT EXISTS idx_integrity_open    ON data_integrity_issues(category, severity) WHERE resolved_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_integrity_subject ON data_integrity_issues(subject_type, subject_id);
`;

async function main() {
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(2); }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  try {
    if (DRY) {
      console.log('[dry-run] would create table data_integrity_issues if absent');
    } else {
      await pool.query(SCHEMA_SQL);
      console.log('[bootstrap] data_integrity_issues table ensured');
    }

    let opened = 0, refreshed = 0;
    const byCategory = {};
    for (const s of SCANNERS) {
      const res = await pool.query(s.sql);
      const findings = res.rows;
      byCategory[s.category] = findings.length;
      for (const finding of findings) {
        if (DRY) { opened++; continue; }
        // Upsert: insert if new, else bump last_seen_at without resetting first_seen_at.
        const r = await pool.query(`
          INSERT INTO data_integrity_issues
            (category, severity, subject_type, subject_id, details, first_seen_at, last_seen_at)
          VALUES ($1, $2, $3, $4, $5, $6, $6)
          ON CONFLICT (category, subject_type, subject_id) DO UPDATE
            SET last_seen_at = EXCLUDED.last_seen_at,
                details = EXCLUDED.details,
                severity = EXCLUDED.severity,
                resolved_at = NULL,
                resolution = NULL,
                resolution_note = NULL,
                resolution_run_id = NULL
            WHERE data_integrity_issues.resolved_at IS NULL
               OR data_integrity_issues.resolution = 'auto_resolved'
          RETURNING (xmax = 0) AS inserted
        `, [s.category, s.severity, s.subjectType, finding.subject_id, finding.details, NOW]);
        if (r.rows[0] && r.rows[0].inserted) opened++; else refreshed++;
      }
      console.log(`  ${s.category}: ${findings.length} finding(s)`);
    }

    let autoResolved = 0;
    if (!DRY) {
      // Anything still 'open' that we DIDN'T touch this run is no longer a violation.
      const r = await pool.query(`
        UPDATE data_integrity_issues
        SET resolved_at = $1, resolution = 'auto_resolved', resolution_run_id = $2
        WHERE resolved_at IS NULL
          AND last_seen_at < $1
          AND category = ANY($3::text[])
      `, [NOW, RUN_ID, SCANNERS.map(s => s.category)]);
      autoResolved = r.rowCount;
    }

    console.log(`\n=== Run ${RUN_ID} ===`);
    console.log(`Opened (new): ${opened}`);
    console.log(`Refreshed:    ${refreshed}`);
    console.log(`Auto-resolved (no longer violating): ${autoResolved}`);
    console.log(`\nBy category:`);
    for (const [cat, n] of Object.entries(byCategory)) console.log(`  ${cat.padEnd(32)} ${n}`);

    if (!DRY) {
      const summary = await pool.query(`
        SELECT category, severity, COUNT(*) AS open_count
        FROM data_integrity_issues
        WHERE resolved_at IS NULL
        GROUP BY category, severity
        ORDER BY severity, category
      `);
      console.log(`\nOpen issues (after this run):`);
      for (const r of summary.rows) {
        console.log(`  [${r.severity}] ${r.category.padEnd(32)} ${r.open_count}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
