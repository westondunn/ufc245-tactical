/**
 * data/audit/scopes.js
 *
 * Each scope is a SQL fragment for the FROM clause that filters the target
 * table to the rows we want to audit. Returns { joinSql, idColumn } so the
 * runner can build:
 *
 *   SELECT count(*) FILTER (WHERE col IS NOT NULL) FROM <joinSql>
 *
 * (or a non-FILTER variant for sqlite). idColumn is what to SELECT for the
 * gap_row_ids sample.
 *
 * Date predicate: `date('now')` works in both SQLite and Postgres.
 */

const SCOPES = {
  fighters: {
    'all': () => ({ joinSql: 'fighters', idColumn: 'fighters.id' }),
    'upcoming-roster': () => ({
      joinSql: `fighters
        JOIN fights ON (fighters.id = fights.red_fighter_id OR fighters.id = fights.blue_fighter_id)
        JOIN events ON events.id = fights.event_id
        WHERE events.date >= date('now')`,
      idColumn: 'fighters.id',
    }),
    'event': (eventId) => ({
      joinSql: `fighters
        JOIN fights ON (fighters.id = fights.red_fighter_id OR fighters.id = fights.blue_fighter_id)
        WHERE fights.event_id = ${eventId}`,
      idColumn: 'fighters.id',
    }),
  },
  events: {
    'all': () => ({ joinSql: 'events', idColumn: 'events.id' }),
    'upcoming': () => ({ joinSql: `events WHERE events.date >= date('now')`, idColumn: 'events.id' }),
    'completed': () => ({ joinSql: `events WHERE events.date < date('now')`, idColumn: 'events.id' }),
    'event': (eventId) => ({ joinSql: `events WHERE events.id = ${eventId}`, idColumn: 'events.id' }),
  },
  fights: {
    'all': () => ({ joinSql: 'fights', idColumn: 'fights.id' }),
    'completed': () => ({
      joinSql: `fights JOIN events ON events.id = fights.event_id WHERE events.date < date('now')`,
      idColumn: 'fights.id',
    }),
    'completed-fights': () => ({
      joinSql: `fights JOIN events ON events.id = fights.event_id WHERE events.date < date('now')`,
      idColumn: 'fights.id',
    }),
    'upcoming-fights': () => ({
      joinSql: `fights JOIN events ON events.id = fights.event_id WHERE events.date >= date('now')`,
      idColumn: 'fights.id',
    }),
    'event': (eventId) => ({ joinSql: `fights WHERE fights.event_id = ${eventId}`, idColumn: 'fights.id' }),
  },
  fight_stats: {
    'completed-fights': () => ({
      joinSql: `fight_stats
        JOIN fights ON fights.id = fight_stats.fight_id
        JOIN events ON events.id = fights.event_id
        WHERE events.date < date('now')`,
      idColumn: `fight_stats.fight_id || ':' || fight_stats.fighter_id`,
    }),
  },
  round_stats: {
    'completed-fights': () => ({
      joinSql: `round_stats
        JOIN fights ON fights.id = round_stats.fight_id
        JOIN events ON events.id = fights.event_id
        WHERE events.date < date('now')`,
      idColumn: `round_stats.fight_id || ':' || round_stats.fighter_id || ':' || round_stats.round`,
    }),
  },
  official_fight_outcomes: {
    'completed-fights': () => ({
      joinSql: `official_fight_outcomes
        JOIN fights ON fights.id = official_fight_outcomes.fight_id
        JOIN events ON events.id = fights.event_id
        WHERE events.date < date('now')`,
      idColumn: 'official_fight_outcomes.fight_id',
    }),
  },
  predictions: {
    'upcoming-fights': () => ({
      joinSql: `predictions
        JOIN fights ON fights.id = predictions.fight_id
        JOIN events ON events.id = fights.event_id
        WHERE events.date >= date('now')`,
      idColumn: 'predictions.id',
    }),
  },
};

function resolveScope(table, scopeName) {
  const tableScopes = SCOPES[table];
  if (!tableScopes) throw new Error(`No scopes defined for table: ${table}`);

  const eventMatch = (scopeName || '').match(/^event:(\d+)$/);
  if (eventMatch) {
    if (!tableScopes.event) throw new Error(`Table ${table} doesn't support event scope`);
    return tableScopes.event(parseInt(eventMatch[1], 10));
  }

  const fn = tableScopes[scopeName];
  if (!fn) throw new Error(`Unknown scope ${scopeName} for table ${table}`);
  return fn();
}

function listScopesForTable(table) {
  return Object.keys(SCOPES[table] || {}).filter(k => k !== 'event');
}

module.exports = { resolveScope, listScopesForTable };
