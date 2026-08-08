'use strict';
/**
 * data/integrity/scanners.js
 *
 * Registry of integrity scanner objects.  Each scanner is shaped:
 *   { category, severity, subjectType, description, scan: async (db) => [{ subjectId, details }] }
 *
 * Allowed categories (TEXT column — no DB CHECK constraint):
 *   missing_hash, missing_core_stats, fraction_scale, orphaned_pick,
 *   stale_prediction, fk_orphan_fighter, fk_orphan_event,
 *   card_position_collision, card_position_gap, main_event_collision,
 *   outcome_winner_drift, past_event_unresolved, prediction_unreconciled,
 *   pick_correct_winner_mismatch, pick_half_reconciled,
 *   duplicate_fighter, prob_sum_off
 *
 * Severity guide:
 *   block — directly corrupts picks or predictions (affects scoring/results)
 *   warn  — structural or data-quality problem that needs attention
 *   info  — cosmetic (reserved; not currently assigned)
 */

function pAllRows(db, sql, params = []) {
  try { return Promise.resolve(db.allRows(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

function today() { return new Date().toISOString().slice(0, 10); }
function daysAgo(n) { return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10); }

const scanners = [

  // ── missing_hash ──────────────────────────────────────────────────────────
  {
    category: 'missing_hash',
    severity: 'warn',
    subjectType: 'fighter',
    description: 'Fighter on an upcoming event has no ufcstats_hash',
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT DISTINCT f.id AS subject_id, f.name,
               e.id AS event_id, e.date AS event_date
        FROM fighters f
        JOIN fights fi ON fi.red_fighter_id = f.id OR fi.blue_fighter_id = f.id
        JOIN events e  ON e.id = fi.event_id
        WHERE e.date >= ? AND f.ufcstats_hash IS NULL
      `, [today()]);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: { name: r.name, event_id: r.event_id, event_date: r.event_date },
      }));
    },
  },

  // ── missing_core_stats ────────────────────────────────────────────────────
  {
    category: 'missing_core_stats',
    severity: 'warn',
    subjectType: 'fighter',
    description: 'Upcoming-event fighter is missing ≥1 of height_cm/reach_cm/stance/slpm/str_acc/str_def/td_avg/td_def',
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT DISTINCT f.id AS subject_id, f.name,
               f.height_cm, f.reach_cm, f.stance,
               f.slpm, f.str_acc, f.str_def, f.td_avg, f.td_def,
               e.id AS event_id, e.date AS event_date
        FROM fighters f
        JOIN fights fi ON fi.red_fighter_id = f.id OR fi.blue_fighter_id = f.id
        JOIN events e  ON e.id = fi.event_id
        WHERE e.date >= ?
          AND (
            f.height_cm IS NULL OR f.reach_cm IS NULL OR f.stance  IS NULL
            OR f.slpm IS NULL OR f.str_acc IS NULL OR f.str_def IS NULL
            OR f.td_avg IS NULL OR f.td_def IS NULL
          )
      `, [today()]);
      const FIELDS = ['height_cm', 'reach_cm', 'stance', 'slpm', 'str_acc', 'str_def', 'td_avg', 'td_def'];
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: {
          name: r.name,
          missing_fields: FIELDS.filter(f => r[f] == null),
          event_id: r.event_id, event_date: r.event_date,
        },
      }));
    },
  },

  // ── fraction_scale ────────────────────────────────────────────────────────
  {
    category: 'fraction_scale',
    severity: 'warn',
    subjectType: 'fighter',
    description: 'Percentage field stored as 0..1 fraction instead of 0..100',
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT id AS subject_id, name, str_acc, str_def, td_acc, td_def
        FROM fighters
        WHERE (str_acc IS NOT NULL AND str_acc > 0 AND str_acc < 1)
           OR (str_def IS NOT NULL AND str_def > 0 AND str_def < 1)
           OR (td_acc  IS NOT NULL AND td_acc  > 0 AND td_acc  < 1)
           OR (td_def  IS NOT NULL AND td_def  > 0 AND td_def  < 1)
      `);
      const PCT = ['str_acc', 'str_def', 'td_acc', 'td_def'];
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: {
          name: r.name,
          fields: Object.fromEntries(PCT.filter(f => r[f] != null && r[f] > 0 && r[f] < 1).map(f => [f, r[f]])),
        },
      }));
    },
  },

  // ── orphaned_pick ─────────────────────────────────────────────────────────
  {
    category: 'orphaned_pick',
    severity: 'block',
    subjectType: 'pick',
    description: "user_pick.picked_fighter_id is not the fight's red or blue fighter",
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT up.id AS subject_id, up.fight_id,
               up.picked_fighter_id,
               fi.red_fighter_id, fi.blue_fighter_id
        FROM user_picks up
        JOIN fights fi ON fi.id = up.fight_id
        WHERE up.picked_fighter_id != fi.red_fighter_id
          AND up.picked_fighter_id != fi.blue_fighter_id
      `);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: {
          fight_id: r.fight_id,
          picked_fighter_id: r.picked_fighter_id,
          fight_red: r.red_fighter_id,
          fight_blue: r.blue_fighter_id,
        },
      }));
    },
  },

  // ── stale_prediction ──────────────────────────────────────────────────────
  {
    category: 'stale_prediction',
    severity: 'block',
    subjectType: 'prediction',
    description: 'Prediction red/blue corner mismatch with fight, but is_stale=0',
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT p.id AS subject_id, p.fight_id,
               p.red_fighter_id AS pred_red, p.blue_fighter_id AS pred_blue,
               fi.red_fighter_id AS fight_red, fi.blue_fighter_id AS fight_blue
        FROM predictions p
        JOIN fights fi ON fi.id = p.fight_id
        WHERE p.is_stale = 0
          AND (p.red_fighter_id != fi.red_fighter_id OR p.blue_fighter_id != fi.blue_fighter_id)
      `);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: {
          fight_id: r.fight_id,
          pred_red: r.pred_red, pred_blue: r.pred_blue,
          fight_red: r.fight_red, fight_blue: r.fight_blue,
        },
      }));
    },
  },

  // ── fk_orphan_fighter ─────────────────────────────────────────────────────
  {
    category: 'fk_orphan_fighter',
    severity: 'block',
    subjectType: 'fight',
    description: 'fights.red_fighter_id or blue_fighter_id has no matching fighters row',
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT fi.id AS subject_id, fi.red_fighter_id, fi.blue_fighter_id
        FROM fights fi
        WHERE (fi.red_fighter_id IS NOT NULL
               AND fi.red_fighter_id NOT IN (SELECT id FROM fighters))
           OR (fi.blue_fighter_id IS NOT NULL
               AND fi.blue_fighter_id NOT IN (SELECT id FROM fighters))
      `);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: { red_fighter_id: r.red_fighter_id, blue_fighter_id: r.blue_fighter_id },
      }));
    },
  },

  // ── fk_orphan_event ───────────────────────────────────────────────────────
  {
    category: 'fk_orphan_event',
    severity: 'block',
    subjectType: 'fight',
    description: 'fights.event_id has no matching events row',
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT fi.id AS subject_id, fi.event_id
        FROM fights fi
        WHERE fi.event_id IS NOT NULL
          AND fi.event_id NOT IN (SELECT id FROM events)
      `);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: { event_id: r.event_id },
      }));
    },
  },

  // ── card_position_collision ───────────────────────────────────────────────
  {
    category: 'card_position_collision',
    severity: 'warn',
    subjectType: 'event',
    description: 'More than one fight shares the same card_position in an event',
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT fi.event_id AS subject_id, fi.card_position, COUNT(*) AS cnt
        FROM fights fi
        WHERE fi.card_position IS NOT NULL
        GROUP BY fi.event_id, fi.card_position
        HAVING COUNT(*) > 1
      `);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: { card_position: r.card_position, count: Number(r.cnt) },
      }));
    },
  },

  // ── card_position_gap ─────────────────────────────────────────────────────
  {
    category: 'card_position_gap',
    severity: 'warn',
    subjectType: 'event',
    description: 'max(card_position) != count(fights) — positions have gaps or skips',
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT fi.event_id AS subject_id,
               MAX(fi.card_position) AS max_pos,
               COUNT(fi.id) AS fight_count
        FROM fights fi
        WHERE fi.card_position IS NOT NULL
        GROUP BY fi.event_id
        HAVING MAX(fi.card_position) != COUNT(fi.id)
      `);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: { max_card_position: r.max_pos, fight_count: Number(r.fight_count) },
      }));
    },
  },

  // ── main_event_collision ──────────────────────────────────────────────────
  {
    category: 'main_event_collision',
    severity: 'warn',
    subjectType: 'event',
    description: 'More than one fight is marked is_main=1 in the same event',
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT fi.event_id AS subject_id, COUNT(*) AS cnt
        FROM fights fi
        WHERE fi.is_main = 1
        GROUP BY fi.event_id
        HAVING COUNT(*) > 1
      `);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: { main_event_count: Number(r.cnt) },
      }));
    },
  },

  // ── outcome_winner_drift ──────────────────────────────────────────────────
  {
    category: 'outcome_winner_drift',
    severity: 'block',
    subjectType: 'fight',
    description: 'fights.winner_id disagrees with official_fight_outcomes.winner_id',
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT fi.id AS subject_id, fi.winner_id, ofo.winner_id AS official_winner_id
        FROM fights fi
        JOIN official_fight_outcomes ofo ON ofo.fight_id = fi.id
        WHERE fi.winner_id IS NOT NULL
          AND ofo.winner_id IS NOT NULL
          AND fi.winner_id != ofo.winner_id
      `);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: { fights_winner_id: r.winner_id, official_winner_id: r.official_winner_id },
      }));
    },
  },

  // ── past_event_unresolved ─────────────────────────────────────────────────
  {
    category: 'past_event_unresolved',
    severity: 'warn',
    subjectType: 'fight',
    description: 'Event ended >2 days ago but fight still has no winner_id or method',
    async scan(db) {
      const cutoff = daysAgo(2);
      const rows = await pAllRows(db, `
        SELECT fi.id AS subject_id, fi.event_id,
               e.date AS event_date, e.name AS event_name
        FROM fights fi
        JOIN events e ON e.id = fi.event_id
        WHERE e.date < ?
          AND fi.winner_id IS NULL
          AND fi.method IS NULL
      `, [cutoff]);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: { event_id: r.event_id, event_date: r.event_date, event_name: r.event_name },
      }));
    },
  },

  // ── prediction_unreconciled ───────────────────────────────────────────────
  {
    category: 'prediction_unreconciled',
    severity: 'block',
    subjectType: 'prediction',
    description: 'fight.winner_id is set but prediction.reconciled_at is NULL',
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT p.id AS subject_id, p.fight_id, fi.winner_id
        FROM predictions p
        JOIN fights fi ON fi.id = p.fight_id
        WHERE fi.winner_id IS NOT NULL
          AND p.reconciled_at IS NULL
      `);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: { fight_id: r.fight_id, winner_id: r.winner_id },
      }));
    },
  },

  // ── pick_correct_winner_mismatch ──────────────────────────────────────────
  {
    category: 'pick_correct_winner_mismatch',
    severity: 'block',
    subjectType: 'pick',
    description: 'pick.correct=1 but picked_fighter_id != actual_winner_id',
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT id AS subject_id, picked_fighter_id, actual_winner_id
        FROM user_picks
        WHERE correct = 1
          AND actual_winner_id IS NOT NULL
          AND picked_fighter_id != actual_winner_id
      `);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: { picked_fighter_id: r.picked_fighter_id, actual_winner_id: r.actual_winner_id },
      }));
    },
  },

  // ── pick_half_reconciled ──────────────────────────────────────────────────
  {
    category: 'pick_half_reconciled',
    severity: 'block',
    subjectType: 'pick',
    description: 'pick.actual_winner_id is set but pick.correct IS NULL',
    async scan(db) {
      const rows = await pAllRows(db, `
        SELECT id AS subject_id, actual_winner_id, picked_fighter_id
        FROM user_picks
        WHERE actual_winner_id IS NOT NULL
          AND correct IS NULL
      `);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: { actual_winner_id: r.actual_winner_id, picked_fighter_id: r.picked_fighter_id },
      }));
    },
  },

  // ── duplicate_fighter ─────────────────────────────────────────────────────
  {
    category: 'duplicate_fighter',
    severity: 'warn',
    subjectType: 'fighter',
    description: 'Multiple fighter rows share the same normalised name',
    async scan(db) {
      const groups = await pAllRows(db, `
        SELECT lower(trim(name)) AS norm_name, COUNT(*) AS cnt, MIN(id) AS first_id
        FROM fighters
        GROUP BY lower(trim(name))
        HAVING COUNT(*) > 1
      `);
      const results = [];
      for (const g of groups) {
        const members = await pAllRows(db,
          `SELECT id, name FROM fighters WHERE lower(trim(name)) = ?`,
          [g.norm_name]
        );
        results.push({
          subjectId: String(g.first_id),
          details: {
            norm_name: g.norm_name,
            count: Number(g.cnt),
            fighter_ids: members.map(m => m.id),
            names: members.map(m => m.name),
          },
        });
      }
      return results;
    },
  },

  // ── prob_sum_off ──────────────────────────────────────────────────────────
  {
    category: 'prob_sum_off',
    severity: 'block',
    subjectType: 'prediction',
    description: 'red_win_prob + blue_win_prob falls outside [0.99, 1.01]',
    async scan(db) {
      const eps = 0.01;
      const rows = await pAllRows(db, `
        SELECT id AS subject_id, red_win_prob, blue_win_prob,
               red_win_prob + blue_win_prob AS total
        FROM predictions
        WHERE ABS(red_win_prob + blue_win_prob - 1.0) > ?
      `, [eps]);
      return rows.map(r => ({
        subjectId: String(r.subject_id),
        details: {
          red_win_prob: r.red_win_prob,
          blue_win_prob: r.blue_win_prob,
          total: r.total,
        },
      }));
    },
  },

];

module.exports = scanners;
