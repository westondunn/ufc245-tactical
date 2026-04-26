// Pure helper — used server-side to attach a `state` field to event rows
// returned by getEvent / getAllEvents and consumed by the picks UI to bucket
// events into Upcoming / Live / History sections.
//
// State precedence:
//   - if start_time + end_time are populated → strict time-window check
//   - else fall back to date-only (event.date vs today, ISO yyyy-mm-dd)
//
// History also wins early when every fight on the card is reconciled (winner
// resolved). That's a server-side override applied by the caller; this pure
// helper just looks at timing.

const DAY_MS = 24 * 60 * 60 * 1000;

function todayISO(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

function getEventState(event, now = Date.now()) {
  if (!event) return 'history';
  const startMs = event.start_time ? Date.parse(event.start_time) : NaN;
  const endMs = event.end_time ? Date.parse(event.end_time) : NaN;
  if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
    if (now < startMs) return 'upcoming';
    if (now <= endMs) return 'live';
    return 'history';
  }
  // Date-only fallback. UFC events are full-day affairs; treat the whole
  // calendar day in UTC as "live" once we cross into it. That's a wide window
  // but better than skipping straight from upcoming to history at midnight.
  const date = (event.date || '').slice(0, 10);
  if (!date) return 'history';
  const today = todayISO(now);
  if (date > today) return 'upcoming';
  if (date === today) return 'live';
  return 'history';
}

module.exports = { getEventState, todayISO, DAY_MS };
