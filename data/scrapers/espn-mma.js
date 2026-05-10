/**
 * data/scrapers/espn-mma.js
 *
 * Live event status from ESPN's MMA scoreboard. ESPN publishes per-bout
 * status (Scheduled / Fighters Introduction / In Progress / Final),
 * the current `period` (round 1-5) and `displayClock` (e.g. "3:42")
 * while a fight is in progress, plus winner flags within seconds of
 * the bell — much faster than ufcstats, which lags by ~5-15 minutes.
 *
 * No auth, no API key. Returns one JSON blob with every event in the
 * current week (typically 1-3 events).
 */
const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard';
const UA = 'UFC-Tactical-Dashboard/2.0 (+https://web-production-96d6e.up.railway.app)';

function nameKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

// Normalize ESPN status type name → a small enum we render with.
function normaliseStatusType(typeName) {
  // ESPN uses STATUS_IN_PROGRESS, STATUS_IN_PROGRESS_2, STATUS_IN_PROGRESS_3,
  // etc. for "round N in progress". STATUS_END_OF_PERIOD_N is between rounds.
  const t = String(typeName || '').toUpperCase();
  if (t === 'STATUS_FINAL' || t === 'STATUS_END_OF_FIGHT') return 'final';
  if (t === 'STATUS_IN_PROGRESS' || t.startsWith('STATUS_IN_PROGRESS_')) return 'in_progress';
  if (t === 'STATUS_END_OF_PERIOD' || t.startsWith('STATUS_END_OF_PERIOD_')) return 'between_rounds';
  if (t === 'STATUS_FIGHTERS_INTRODUCTION' || t === 'STATUS_FIGHTERS_WALKING') return 'walkouts';
  if (t === 'STATUS_SCHEDULED' || t === 'STATUS_PRE_FIGHT') return 'scheduled';
  return 'unknown';
}

function parseScoreboard(json) {
  const events = (json && json.events) || [];
  return events.map(ev => {
    const comps = ev.competitions || [];
    return {
      espn_event_id: ev.id || null,
      name: ev.name || null,
      shortName: ev.shortName || null,
      date: ev.date || null,                     // ISO 8601
      status_type: normaliseStatusType((ev.status && ev.status.type && ev.status.type.name) || ''),
      bouts: comps.map(c => {
        const status = c.status || {};
        const stype = status.type || {};
        const competitors = c.competitors || [];
        const a = competitors[0] || {};
        const b = competitors[1] || {};
        const aName = (a.athlete && a.athlete.displayName) || null;
        const bName = (b.athlete && b.athlete.displayName) || null;
        const winnerName = a.winner ? aName : (b.winner ? bName : null);
        return {
          espn_bout_id: c.id || null,
          status_type: normaliseStatusType(stype.name),
          status_detail: stype.detail || stype.shortDetail || stype.description || null,
          period: Number.isFinite(+status.period) ? +status.period : null,
          display_clock: status.displayClock || null,
          completed: !!stype.completed,
          fighter_a: { name: aName, name_key: nameKey(aName), winner: !!a.winner },
          fighter_b: { name: bName, name_key: nameKey(bName), winner: !!b.winner },
          winner_name: winnerName,
        };
      }),
    };
  });
}

async function fetchLiveScoreboard(opts = {}) {
  const timeout = Number(opts.timeoutMs || 8000);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(SCOREBOARD_URL, {
      headers: { 'User-Agent': UA, accept: 'application/json' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return { ok: true, events: parseScoreboard(json), fetched_at: new Date().toISOString() };
  } catch (e) {
    return { ok: false, error: e.message, fetched_at: new Date().toISOString() };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Match an ESPN event to one of our `events` rows. ESPN's `name`
 * looks like "UFC 328: Chimaev vs. Strickland"; ours is "Chimaev vs
 * Strickland". Match on the part after the colon, normalised.
 */
function matchEvent(espnEvents, ourEvent) {
  if (!ourEvent) return null;
  const ourKey = nameKey(ourEvent.name);
  const ourDate = (ourEvent.date || '').slice(0, 10);
  for (const ev of espnEvents) {
    const after = String(ev.name || '').split(':').slice(-1)[0];
    if (nameKey(after) === ourKey) return ev;
    if (ourDate && (ev.date || '').slice(0, 10) === ourDate) return ev;
  }
  return null;
}

/**
 * Build a map: our_fight_id → ESPN bout state, by matching fighter
 * name pairs against the bouts on the matched event.
 */
function mergeOntoCard(ourCard, espnEvent) {
  if (!espnEvent || !Array.isArray(espnEvent.bouts)) return {};
  const byPair = new Map();
  for (const b of espnEvent.bouts) {
    const k1 = `${b.fighter_a.name_key}|${b.fighter_b.name_key}`;
    const k2 = `${b.fighter_b.name_key}|${b.fighter_a.name_key}`;
    byPair.set(k1, b);
    byPair.set(k2, b);
  }
  const out = {};
  for (const fight of ourCard) {
    const key = `${nameKey(fight.red_name)}|${nameKey(fight.blue_name)}`;
    const b = byPair.get(key);
    if (!b) continue;
    // Determine which corner (red/blue) the ESPN winner refers to.
    let espn_winner_corner = null;
    if (b.winner_name) {
      if (nameKey(b.winner_name) === nameKey(fight.red_name)) espn_winner_corner = 'red';
      else if (nameKey(b.winner_name) === nameKey(fight.blue_name)) espn_winner_corner = 'blue';
    }
    out[fight.id] = {
      status_type: b.status_type,
      status_detail: b.status_detail,
      period: b.period,
      display_clock: b.display_clock,
      completed: b.completed,
      espn_winner_name: b.winner_name,
      espn_winner_corner,
    };
  }
  return out;
}

module.exports = { fetchLiveScoreboard, parseScoreboard, matchEvent, mergeOntoCard };
