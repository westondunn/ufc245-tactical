/**
 * data/audit/coverage-spec.js
 *
 * Declarative list of (table, column, scopes) triples to audit. Order does
 * not matter; each entry produces one or more coverage_snapshots rows per
 * audit run.
 *
 * Adding a new audited column = add a row here.
 */

module.exports = [
  // ── fighters ──
  { table: 'fighters', column: 'height_cm',     scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'reach_cm',      scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'stance',        scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'dob',           scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'weight_class',  scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'nationality',   scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'slpm',          scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'str_acc',       scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'sapm',          scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'str_def',       scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'td_avg',        scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'td_acc',        scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'td_def',        scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'sub_avg',       scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'headshot_url',  scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'body_url',      scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'ufcstats_hash', scopes: ['all', 'upcoming-roster'] },

  // ── events ──
  { table: 'events', column: 'date',       scopes: ['all', 'upcoming'] },
  { table: 'events', column: 'venue',      scopes: ['all', 'upcoming'] },
  { table: 'events', column: 'city',       scopes: ['all', 'upcoming'] },
  { table: 'events', column: 'country',    scopes: ['all', 'upcoming'] },
  { table: 'events', column: 'start_time', scopes: ['all', 'upcoming'] },
  { table: 'events', column: 'end_time',   scopes: ['all', 'upcoming'] },
  { table: 'events', column: 'timezone',   scopes: ['all', 'upcoming'] },

  // ── fights (completed) ──
  { table: 'fights', column: 'winner_id',     scopes: ['completed'] },
  { table: 'fights', column: 'method',        scopes: ['completed'] },
  { table: 'fights', column: 'method_detail', scopes: ['completed'] },
  { table: 'fights', column: 'round',         scopes: ['completed'] },
  { table: 'fights', column: 'time',          scopes: ['completed'] },
  { table: 'fights', column: 'has_stats',     scopes: ['completed'] },

  // ── fight_stats (completed) ──
  { table: 'fight_stats', column: 'sig_str_landed',     scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'sig_str_attempted',  scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'total_str_landed',   scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'takedowns_landed',   scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'knockdowns',         scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'sub_attempts',       scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'control_time_sec',   scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'head_landed',        scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'body_landed',        scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'leg_landed',         scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'distance_landed',    scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'clinch_landed',      scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'ground_landed',      scopes: ['completed-fights'] },

  // ── row-existence audits (column='__row__' is a sentinel for "row present") ──
  { table: 'round_stats',             column: '__row__', scopes: ['completed-fights'] },
  { table: 'official_fight_outcomes', column: '__row__', scopes: ['completed-fights'] },
  { table: 'predictions',             column: '__row__', scopes: ['upcoming-fights'] },
  { table: 'predictions',             column: 'enrichment_level', scopes: ['upcoming-fights'] },
];
