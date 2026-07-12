const db = require('../../db');
const { liveEventPollerTick } = require('../../data/audit/scheduler');

const EVT_ID = 98001;
const FIGHT_FINISHED = 98201;
const FIGHT_IN_PROGRESS = 98202;
const HASH_FINISHED = 'a1b2c3d4e5f6a7b8';
const HASH_IN_PROGRESS = 'b2c3d4e5f6a7b8c9';
const FIGHTER_RED = 98101;
const FIGHTER_BLUE = 98102;

function pRun(sql, params) {
  try { return Promise.resolve(db.run(sql, params)); }
  catch (e) { return Promise.reject(e); }
}
function pAllRows(sql, params) {
  try { return Promise.resolve(db.allRows(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

const SCRAPE_CARD = {
  fights: [
    {
      fight_hash: HASH_FINISHED,
      winner_side: 'red',
      method: 'KO/TKO',
      round: 2,
      time: '3:45',
    },
    {
      fight_hash: HASH_IN_PROGRESS,
      winner_side: null,
      method: null,
      round: null,
      time: null,
    },
  ],
};

async function seedFixture() {
  await db.init();
  const now = new Date().toISOString();
  const startMs = Date.now() - 30 * 60 * 1000; // 30 min ago
  const startIso = new Date(startMs).toISOString();
  const endIso = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(); // 3h from now

  await pRun(`INSERT OR REPLACE INTO events (id, name, date, start_time, end_time, ufcstats_hash) VALUES (?, ?, ?, ?, ?, ?)`,
    [EVT_ID, 'SchedFixture', new Date().toISOString().slice(0, 10), startIso, endIso, 'eventhash1']);

  for (const fid of [FIGHTER_RED, FIGHTER_BLUE, 98103, 98104]) {
    await pRun(`INSERT OR REPLACE INTO fighters (id, name) VALUES (?, ?)`, [fid, `SchedFighter${fid}`]);
  }

  await pRun(`INSERT OR REPLACE INTO fights (id, event_id, red_fighter_id, blue_fighter_id, ufcstats_hash)
    VALUES (?, ?, ?, ?, ?)`, [FIGHT_FINISHED, EVT_ID, FIGHTER_RED, FIGHTER_BLUE, HASH_FINISHED]);
  await pRun(`INSERT OR REPLACE INTO fights (id, event_id, red_fighter_id, blue_fighter_id, ufcstats_hash)
    VALUES (?, ?, ?, ?, ?)`, [FIGHT_IN_PROGRESS, EVT_ID, 98103, 98104, HASH_IN_PROGRESS]);
}

async function cleanFixture() {
  await pRun(`DELETE FROM official_fight_outcomes WHERE fight_id IN (?, ?)`, [FIGHT_FINISHED, FIGHT_IN_PROGRESS]);
  await pRun(`DELETE FROM fights WHERE id IN (?, ?)`, [FIGHT_FINISHED, FIGHT_IN_PROGRESS]);
  await pRun(`DELETE FROM fighters WHERE id IN (?, ?, ?, ?)`, [FIGHTER_RED, FIGHTER_BLUE, 98103, 98104]);
  await pRun(`DELETE FROM events WHERE id = ?`, [EVT_ID]);
}

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nScheduler: liveEventPollerTick');

  await seedFixture();

  const postedBodies = [];
  const reconciledFights = [];

  const stubScrape = async (_hash) => SCRAPE_CARD;
  const stubFetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    postedBodies.push(body);
    // Simulate endpoint returning the outcomes it captured
    return {
      json: async () => ({
        captured: body.outcomes.length,
        outcomes: body.outcomes.map(o => ({ fight_id: o.fight_id, winner_id: o.winner_id })),
        picks: { reconciled: 0 },
      }),
    };
  };

  // Patch reconcilePrediction to track calls without real DB side-effects
  const origReconcile = db.reconcilePrediction.bind(db);
  db.reconcilePrediction = async (fightId, winnerId) => {
    reconciledFights.push({ fightId, winnerId });
    return null;
  };

  // ── Test 1: finished fight is POSTed; in-progress fight is skipped ──
  process.env.PREDICTION_SERVICE_KEY = 'test-key';
  await liveEventPollerTick({ fetchEventFn: stubScrape, fetchFn: stubFetch });

  assert(postedBodies.length === 1, 'tick POSTs outcomes for live event');
  const posted = postedBodies[0];
  assert(posted.outcomes.length === 1, 'only finished fight included in POST body');
  assert(posted.outcomes[0].fight_id === FIGHT_FINISHED, 'finished fight_id in POST body');
  assert(posted.outcomes[0].winner_id === FIGHTER_RED, 'red winner resolved');
  assert(posted.outcomes[0].method === 'KO/TKO', 'method forwarded');
  assert(posted.outcomes[0].source === 'live_event_poller', 'source tag set');
  assert(posted.reconcile_picks === true, 'reconcile_picks=true in payload');
  assert(reconciledFights.length === 1, 'reconcilePrediction called once');
  assert(reconciledFights[0].fightId === FIGHT_FINISHED, 'reconcilePrediction called for finished fight');

  // ── Test 2: already-resolved fight is skipped (idempotency) ──
  // Mark FIGHT_FINISHED as already having a winner in DB
  await pRun(`UPDATE fights SET winner_id = ? WHERE id = ?`, [FIGHTER_RED, FIGHT_FINISHED]);
  postedBodies.length = 0;
  reconciledFights.length = 0;

  await liveEventPollerTick({ fetchEventFn: stubScrape, fetchFn: stubFetch });

  assert(postedBodies.length === 0, 'no POST when all finished fights already resolved');

  // Reset
  await pRun(`UPDATE fights SET winner_id = NULL WHERE id = ?`, [FIGHT_FINISHED]);

  // ── Test 3: PREDICTION_SERVICE_KEY unset → skip ──
  delete process.env.PREDICTION_SERVICE_KEY;
  postedBodies.length = 0;
  reconciledFights.length = 0;

  await liveEventPollerTick({ fetchEventFn: stubScrape, fetchFn: stubFetch });

  assert(postedBodies.length === 0, 'no POST when PREDICTION_SERVICE_KEY unset');

  // Restore
  db.reconcilePrediction = origReconcile;
  process.env.PREDICTION_SERVICE_KEY = 'test-key';

  await cleanFixture();
  delete process.env.PREDICTION_SERVICE_KEY;

  return results;
}

module.exports = { run };
