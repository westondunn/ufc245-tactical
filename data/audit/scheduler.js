/**
 * data/audit/scheduler.js
 *
 * Wires node-cron triggers to runAudit + runBackfill. Each trigger holds a
 * mutex to skip overlapping runs.
 *
 * Triggers (override times by editing here):
 *   - nightly integrity    02:00 daily, all integrity scanners
 *   - nightly sweep        03:00 daily, all columns
 *   - pre-event            04:00 daily, events 7d / 1d out
 *   - live-event poller    every 5 min (LIVE_EVENT_POLL_INTERVAL_MIN), events in live window
 *   - post-event 1–24 h    every 5 min, events 1–24 h after end_time
 *   - post-event 24h       05:00 daily, events that ended yesterday
 *
 * Set AUDIT_SCHEDULER=off to disable all triggers.
 * Set LIVE_EVENT_POLL_INTERVAL_MIN to change live-poll cadence (default 5).
 */
const cron = require('node-cron');
const db = require('../../db');
const { runAudit } = require('./runner');
const { runBackfill } = require('../backfill/dispatcher');
const { runIntegrityScan } = require('../integrity/runner');
const { fetchEvent } = require('../scrapers/ufcstats-event');
const { isInLivePollWindow } = require('../../lib/eventState');

const mutexes = new Map();

function pAllRows(sql, params) {
  try { return Promise.resolve(db.allRows(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

async function withMutex(key, fn) {
  if (mutexes.get(key)) {
    console.log(`[scheduler] skip ${key}: already running`);
    return;
  }
  mutexes.set(key, true);
  try { await fn(); }
  catch (e) { console.error(`[scheduler] ${key} error:`, e.message); }
  finally { mutexes.delete(key); }
}

async function trigger(triggerKey, scopeArg = null) {
  const audit = await runAudit({ scope: scopeArg, triggerSource: triggerKey });
  if (audit.status === 'error') {
    console.warn(`[scheduler] ${triggerKey} audit error; skipping backfill`);
    return { audit };
  }
  const backfill = await runBackfill({ runId: audit.run_id });
  console.log(`[scheduler] ${triggerKey} run=${audit.run_id} audit=${audit.summary.length} bf:auto=${backfill.auto} q=${backfill.queued} r=${backfill.rejected}`);
  return { audit, backfill };
}

// Runs all 17 integrity scanners nightly at 02:00 UTC — one hour before the
// coverage audit (03:00) to avoid overlap. Replaces the former hourly
// fighter-integrity-gate remote-agent routine; findings persist in DB instead
// of opening GitHub issues.
function nightlyIntegrity() {
  return cron.schedule('0 2 * * *', () => withMutex('nightly-integrity', async () => {
    try {
      const result = await runIntegrityScan();
      console.log(`[scheduler] integrity run=${result.run_id} opened=${result.opened} refreshed=${result.refreshed} resolved=${result.resolved}`);
    } catch (e) {
      console.error('[scheduler] nightly-integrity error:', e.message);
    }
  }));
}

function nightlySweep() {
  return cron.schedule('0 3 * * *', () => withMutex('nightly', () => trigger('cron:nightly')));
}

function preEventDaily() {
  return cron.schedule('0 4 * * *', () => withMutex('pre-event', async () => {
    const upcoming = await pAllRows(`
      SELECT id, name, date FROM events
      WHERE date IN (date('now', '+1 day'), date('now', '+7 day'), date('now', '+8 day'))
    `);
    for (const ev of upcoming) {
      await trigger('cron:pre-event', `event:${ev.id}`);
    }
  }));
}

// ──────────────────────────────────────────────────────────────────────────────
// Live-event poller
// Fires every LIVE_EVENT_POLL_INTERVAL_MIN minutes (default 5) while an event
// is in progress. Scrapes ufcstats, POSTs finished fights to the canonical
// /api/events/:id/official-outcomes endpoint (which handles upsert + pick
// reconciliation), then calls db.reconcilePrediction for model scoring.
// ──────────────────────────────────────────────────────────────────────────────

const LOOPBACK_BASE = `http://localhost:${process.env.PORT || 3000}`;

async function liveEventPollerTick({ fetchEventFn = fetchEvent, fetchFn = globalThis.fetch } = {}) {
  const key = process.env.PREDICTION_SERVICE_KEY;
  if (!key) {
    console.log('[live-poll] skip: PREDICTION_SERVICE_KEY not set');
    return;
  }

  const now = Date.now();
  const allStarted = await pAllRows(`
    SELECT id, ufcstats_hash, start_time, end_time FROM events
    WHERE start_time IS NOT NULL
  `);
  const liveEvents = allStarted.filter(ev => isInLivePollWindow(ev, now));

  for (let i = 0; i < liveEvents.length; i++) {
    const ev = liveEvents[i];
    if (i > 0) await new Promise(r => setTimeout(r, 1000)); // 1 s between scrapes

    if (!ev.ufcstats_hash) {
      console.log(`[live-poll] event=${ev.id} skip: no ufcstats_hash`);
      continue;
    }

    let scrape;
    try {
      scrape = await fetchEventFn(ev.ufcstats_hash);
    } catch (err) {
      console.log(`[live-poll] event=${ev.id} scrape error: ${err.message}`);
      continue;
    }

    // Load DB card so we can match hashes and check winner_id
    const card = await pAllRows(`
      SELECT id, ufcstats_hash, winner_id, red_fighter_id, blue_fighter_id
      FROM fights WHERE event_id = ?
    `, [ev.id]);

    const hashToFight = {};
    for (const f of card) {
      if (f.ufcstats_hash) hashToFight[f.ufcstats_hash] = f;
    }

    const outcomes = [];
    for (const sf of scrape.fights) {
      if (!sf.fight_hash) continue;
      const dbFight = hashToFight[sf.fight_hash];
      if (!dbFight) continue;
      if (dbFight.winner_id != null) continue; // already resolved — idempotent skip
      if (!sf.method || !sf.round || !sf.time) continue; // fight not yet finished

      let winner_id = null;
      let status = 'official';
      if (sf.winner_side === 'red') {
        winner_id = dbFight.red_fighter_id;
      } else if (sf.winner_side === 'blue') {
        winner_id = dbFight.blue_fighter_id;
      } else {
        const m = String(sf.method || '').toLowerCase();
        if (/draw|no contest/.test(m) || sf.method.toUpperCase() === 'NC') {
          status = 'void';
        } else {
          continue; // method present but winner indeterminate — skip
        }
      }

      outcomes.push({
        fight_id: dbFight.id,
        winner_id,
        method: sf.method,
        round: sf.round,
        time: sf.time,
        status,
        source: 'live_event_poller',
        captured_at: new Date().toISOString(),
      });
    }

    const seen = scrape.fights.length;

    if (outcomes.length === 0) {
      console.log(`[live-poll] event=${ev.id} seen=${seen} new_outcomes=0 reconciled_picks=0`);
      continue;
    }

    let resp;
    try {
      const res = await fetchFn(`${LOOPBACK_BASE}/api/events/${ev.id}/official-outcomes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-prediction-key': key },
        body: JSON.stringify({ outcomes, reconcile_picks: true }),
      });
      resp = await res.json();
    } catch (err) {
      console.log(`[live-poll] event=${ev.id} POST error: ${err.message}`);
      continue;
    }

    const newOutcomes = resp.captured || 0;
    const reconciledPicks = (resp.picks && resp.picks.reconciled) || 0;

    // Score model predictions for each newly-resolved fight
    for (const outcome of (resp.outcomes || [])) {
      if (outcome && outcome.fight_id && outcome.winner_id != null) {
        try {
          await db.reconcilePrediction(outcome.fight_id, outcome.winner_id);
        } catch (err) {
          console.log(`[live-poll] reconcilePrediction error fight=${outcome.fight_id}: ${err.message}`);
        }
      }
    }
    if (newOutcomes > 0) await db.save();

    console.log(`[live-poll] event=${ev.id} seen=${seen} new_outcomes=${newOutcomes} reconciled_picks=${reconciledPicks}`);
  }
}

function liveEventPoller() {
  const intervalMin = parseInt(process.env.LIVE_EVENT_POLL_INTERVAL_MIN, 10) || 5;
  const expr = `*/${intervalMin} * * * *`;
  return cron.schedule(expr, () => withMutex('live-event-poll', () => liveEventPollerTick()));
}

// ──────────────────────────────────────────────────────────────────────────────
// Post-event poller (narrowed scope)
// Now that liveEventPoller handles the live window (up to 1 h past end_time),
// this poller targets events 1–24 h past end_time to capture late-arriving
// stats published by ufcstats after the card concludes.
// ──────────────────────────────────────────────────────────────────────────────

function postEventPoller() {
  const triggeredToday = new Set();
  const ONE_HOUR_MS = 60 * 60 * 1000;
  const TWENTY_FOUR_HOURS_MS = 24 * ONE_HOUR_MS;
  return cron.schedule('*/5 * * * *', () => withMutex('post-event-poll', async () => {
    // Include today and yesterday so an event ending near midnight isn't missed
    const recent = await pAllRows(`
      SELECT id, end_time FROM events
      WHERE end_time IS NOT NULL
      AND date IN (date('now'), date('now', '-1 day'))
    `);
    for (const ev of recent) {
      const endMs = Date.parse(ev.end_time);
      if (isNaN(endMs)) continue;
      const ageMs = Date.now() - endMs;
      if (ageMs >= ONE_HOUR_MS && ageMs < TWENTY_FOUR_HOURS_MS && !triggeredToday.has(ev.id)) {
        triggeredToday.add(ev.id);
        await trigger('cron:post-event-1h', `event:${ev.id}`);
      }
    }
  }));
}

function postEventT24() {
  return cron.schedule('0 5 * * *', () => withMutex('post-event-24h', async () => {
    const events = await pAllRows(`SELECT id FROM events WHERE date = date('now', '-1 day')`);
    for (const ev of events) {
      await trigger('cron:post-event-24h', `event:${ev.id}`);
    }
  }));
}

function startScheduler() {
  if (process.env.AUDIT_SCHEDULER === 'off') {
    console.log('[scheduler] disabled by AUDIT_SCHEDULER=off');
    return [];
  }
  console.log('[scheduler] starting integrity + nightly + pre/post-event triggers + live-event poller');
  return [nightlyIntegrity(), nightlySweep(), preEventDaily(), liveEventPoller(), postEventPoller(), postEventT24()];
}

module.exports = { startScheduler, trigger, liveEventPollerTick, _mutexes: mutexes };
