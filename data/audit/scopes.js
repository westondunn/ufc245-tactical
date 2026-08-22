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
 * Date predicate: `'${todayUtc()}'` works in both SQLite and Postgres.
 */


// 'YYYY-MM-DD' in UTC, injected as a text literal so date comparisons stay
// text-vs-text on both SQLite and Postgres. Postgres parses date('now') as a
// cast to the `date` type, and `text >= date` has no operator — every scope
// using it errors on Postgres (audit runs came back status=partial in prod).
function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

const SCOPES = {
  fighters: {
    'all': () => ({ joinSql: 'fighters', idColumn: 'fighters.id' }),
    'upcoming-roster': () => ({
      joinSql: `fighters
        JOIN fights ON (fighters.id = fights.red_fighter_id OR fighters.id = fights.blue_fighter_id)
        JOIN events ON events.id = fights.event_id
        WHERE events.date >= '${todayUtc()}'`,
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
    'upcoming': () => ({ joinSql: `events WHERE events.date >= '${todayUtc()}'`, idColumn: 'events.id' }),
    'completed': () => ({ joinSql: `events WHERE events.date < '${todayUtc()}'`, idColumn: 'events.id' }),
    'event': (eventId) => ({ joinSql: `events WHERE events.id = ${eventId}`, idColumn: 'events.id' }),
  },
  fights: {
    'all': () => ({ joinSql: 'fights', idColumn: 'fights.id' }),
    'completed': () => ({
      joinSql: `fights JOIN events ON events.id = fights.event_id WHERE events.date < '${todayUtc()}'`,
      idColumn: 'fights.id',
    }),
    'completed-fights': () => ({
      joinSql: `fights JOIN events ON events.id = fights.event_id WHERE events.date < '${todayUtc()}'`,
      idColumn: 'fights.id',
    }),
    'upcoming-fights': () => ({
      joinSql: `fights JOIN events ON events.id = fights.event_id WHERE events.date >= '${todayUtc()}'`,
      idColumn: 'fights.id',
    }),
    'event': (eventId) => ({ joinSql: `fights WHERE fights.event_id = ${eventId}`, idColumn: 'fights.id' }),
  },
  fight_stats: {
    'completed-fights': () => ({
      joinSql: `fight_stats
        JOIN fights ON fights.id = fight_stats.fight_id
        JOIN events ON events.id = fights.event_id
        WHERE events.date < '${todayUtc()}'`,
      idColumn: `fight_stats.fight_id || ':' || fight_stats.fighter_id`,
    }),
  },
  round_stats: {
    'completed-fights': () => ({
      joinSql: `round_stats
        JOIN fights ON fights.id = round_stats.fight_id
        JOIN events ON events.id = fights.event_id
        WHERE events.date < '${todayUtc()}'`,
      idColumn: `round_stats.fight_id || ':' || round_stats.fighter_id || ':' || round_stats.round`,
    }),
  },
  official_fight_outcomes: {
    'completed-fights': () => ({
      joinSql: `official_fight_outcomes
        JOIN fights ON fights.id = official_fight_outcomes.fight_id
        JOIN events ON events.id = fights.event_id
        WHERE events.date < '${todayUtc()}'`,
      idColumn: 'official_fight_outcomes.fight_id',
    }),
  },
  predictions: {
    'upcoming-fights': () => ({
      joinSql: `predictions
        JOIN fights ON fights.id = predictions.fight_id
        JOIN events ON events.id = fights.event_id
        WHERE events.date >= '${todayUtc()}'`,
      idColumn: 'predictions.id',
    }),
  },
  walkout_playlists: {
    'all': () => ({ joinSql: 'walkout_playlists', idColumn: `walkout_playlists.event_id || ':' || walkout_playlists.fighter_id` }),
    'upcoming-roster': () => ({
      joinSql: `walkout_playlists
        JOIN events ON events.id = walkout_playlists.event_id
        WHERE events.date >= '${todayUtc()}'`,
      idColumn: `walkout_playlists.event_id || ':' || walkout_playlists.fighter_id`,
    }),
    'event': (eventId) => ({
      joinSql: `walkout_playlists WHERE walkout_playlists.event_id = ${eventId}`,
      idColumn: `walkout_playlists.event_id || ':' || walkout_playlists.fighter_id`,
    }),
  },
  walkout_playlist_tracks: {
    'all': () => ({ joinSql: 'walkout_playlist_tracks', idColumn: 'walkout_playlist_tracks.id' }),
    'upcoming-roster': () => ({
      joinSql: `walkout_playlist_tracks
        JOIN events ON events.id = walkout_playlist_tracks.event_id
        WHERE events.date >= '${todayUtc()}'`,
      idColumn: 'walkout_playlist_tracks.id',
    }),
    'event': (eventId) => ({
      joinSql: `walkout_playlist_tracks WHERE walkout_playlist_tracks.event_id = ${eventId}`,
      idColumn: 'walkout_playlist_tracks.id',
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
