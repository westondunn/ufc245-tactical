/**
 * data/audit/scheduler.js
 *
 * Wires node-cron triggers to runAudit + runBackfill. Each trigger holds a
 * mutex to skip overlapping runs.
 *
 * Triggers (override times by editing here):
 *   - nightly sweep        03:00 daily, all columns
 *   - pre-event            04:00 daily, events 7d / 1d out
 *   - post-event 1h poll   every 5 min, events ending in last hour today
 *   - post-event 24h       05:00 daily, events that ended yesterday
 *
 * Set AUDIT_SCHEDULER=off to disable.
 */
const cron = require('node-cron');
const db = require('../../db');
const { runAudit } = require('./runner');
const { runBackfill } = require('../backfill/dispatcher');

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

function postEventPoller() {
  const triggeredToday = new Set();
  return cron.schedule('*/5 * * * *', () => withMutex('post-event-poll', async () => {
    const today = await pAllRows(`SELECT id, end_time, date FROM events WHERE date = date('now')`);
    for (const ev of today) {
      if (!ev.end_time) continue;
      const endTs = Date.parse(ev.end_time);
      if (isNaN(endTs)) continue;
      const ageMs = Date.now() - endTs;
      if (ageMs > 0 && ageMs < 60 * 60 * 1000 && !triggeredToday.has(ev.id)) {
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
  console.log('[scheduler] starting nightly + pre/post-event triggers');
  return [nightlySweep(), preEventDaily(), postEventPoller(), postEventT24()];
}

module.exports = { startScheduler, trigger };
