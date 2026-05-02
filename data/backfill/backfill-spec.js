/**
 * data/backfill/backfill-spec.js
 *
 * Per-(table.column) safety class + source + verify rule. The dispatcher
 * uses this to decide how to handle each gap.
 *
 * For v1, only entries below are auto-handled. Other gaps surface in the
 * audit report but are not dispatched.
 */
module.exports = {
  // Fighter physicals — safe (one source, gap-only writes)
  'fighters.height_cm':    { source: 'ufcstats-fighter-page', safety: 'safe',     verify: 'numeric-tolerance:1', bounds: [140, 230] },
  'fighters.reach_cm':     { source: 'ufcstats-fighter-page', safety: 'safe',     verify: 'numeric-tolerance:1', bounds: [140, 230] },
  'fighters.stance':       { source: 'ufcstats-fighter-page', safety: 'safe',     verify: 'identity' },
  'fighters.dob':          { source: 'ufcstats-fighter-page', safety: 'safe',     verify: 'identity' },
  'fighters.weight_class': { source: 'ufcstats-fighter-page', safety: 'safe',     verify: 'identity' },

  // Fighter career stats — risky (single-source → review by gate)
  'fighters.slpm':         { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.str_acc':      { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.sapm':         { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.str_def':      { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.td_avg':       { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.td_acc':       { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.td_def':       { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.sub_avg':      { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },

  // Cosmetic
  'fighters.headshot_url': { source: 'ufc-com-athlete',       safety: 'cosmetic', verify: 'url-200' },
  'fighters.body_url':     { source: 'ufc-com-athlete',       safety: 'cosmetic', verify: 'url-200' },

  // Reconciliation — fights/winner/method/round (gate forces review; outcomes pipeline writes)
  'fights.winner_id':       { source: 'ufcstats-event-page', safety: 'reconcile', verify: 'cross-check:official_fight_outcomes' },
  'fights.method':          { source: 'ufcstats-event-page', safety: 'reconcile', verify: 'cross-check:official_fight_outcomes' },
  'fights.method_detail':   { source: 'ufcstats-event-page', safety: 'reconcile', verify: 'cross-check:official_fight_outcomes' },
  'fights.round':           { source: 'ufcstats-event-page', safety: 'reconcile', verify: 'cross-check:official_fight_outcomes' },
  'fights.time':            { source: 'ufcstats-event-page', safety: 'reconcile', verify: 'cross-check:official_fight_outcomes' },

  // Fight stats — safe (gap-fill only)
  'fight_stats.*':          { source: 'ufcstats-fight-page',  safety: 'safe',     verify: 'completeness' },
};
