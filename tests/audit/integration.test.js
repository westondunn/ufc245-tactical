const db = require('../../db');
const { runAudit } = require('../../data/audit/runner');
const { runBackfill } = require('../../data/backfill/dispatcher');

function pRun(sql, params) {
  try { return Promise.resolve(db.run(sql, params)); }
  catch (e) { return Promise.reject(e); }
}
function pOneRow(sql, params) {
  try { return Promise.resolve(db.oneRow(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nAudit + Backfill End-to-End:');

  await db.init();

  // Plant a synthetic event + fight referencing one fixture fighter so the
  // event-scoped audit captures only our row deterministically — the default
  // 50-row gap sample on a 2700-fighter seed makes id-targeted assertions
  // flaky otherwise.
  const fid = 9701;
  const evid = 9799;
  const fightid = 9899;
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  await pRun(`INSERT OR REPLACE INTO fighters (id, name, ufcstats_hash, reach_cm) VALUES (?, ?, ?, NULL)`,
    [fid, 'IntegrationFixture', 'inthash9701']);
  await pRun(`INSERT OR REPLACE INTO events (id, name, date) VALUES (?, ?, ?)`, [evid, 'IntEvent', future]);
  await pRun(`INSERT OR REPLACE INTO fights (id, event_id, red_fighter_id, blue_fighter_id) VALUES (?, ?, ?, ?)`,
    [fightid, evid, fid, fid]);

  const spec = [{ table: 'fighters', column: 'reach_cm', scopes: [`event:${evid}`] }];
  const audit = await runAudit({ spec, triggerSource: 'integration-test' });
  assert(audit.status === 'complete', 'audit status complete');
  assert(audit.summary[0].non_null_rows < audit.summary[0].total_rows, 'gaps detected');
  assert(audit.summary[0].gap_row_ids.includes(String(fid)), 'fixture fighter in gap list');

  const scraperMocks = {
    'ufcstats-fighter-page': async () => ({ reach_cm: 180, source_url: 'http://test/integration' }),
  };
  const bf1 = await runBackfill({ runId: audit.run_id, scraperMocks });
  assert(bf1.auto >= 1, 'first backfill auto-wrote at least one row');

  const f1 = await pOneRow(`SELECT reach_cm FROM fighters WHERE id = ?`, [fid]);
  assert(f1.reach_cm === 180, 'reach_cm=180 after backfill');

  // Idempotency: re-running shows our fighter is no longer a gap
  const audit2 = await runAudit({ spec, triggerSource: 'integration-test' });
  const stillGap = audit2.summary[0].gap_row_ids.includes(String(fid));
  assert(!stillGap, 'reach_cm gap closed for fixture fighter');

  const bf2 = await runBackfill({ runId: audit2.run_id, scraperMocks });
  const f2 = await pOneRow(`SELECT reach_cm FROM fighters WHERE id = ?`, [fid]);
  assert(f2.reach_cm === 180, 'reach_cm unchanged on re-run');
  assert(bf2.auto === 0, 'no auto writes on re-run (gap closed)');

  // Cleanup
  await pRun(`DELETE FROM pending_backfill WHERE table_name = 'fighters' AND row_id = ?`, [String(fid)]);
  await pRun(`DELETE FROM coverage_snapshots WHERE run_id IN (?, ?)`, [audit.run_id, audit2.run_id]);
  await pRun(`DELETE FROM audit_runs WHERE run_id IN (?, ?)`, [audit.run_id, audit2.run_id]);
  await pRun(`DELETE FROM fights WHERE id = ?`, [fightid]);
  await pRun(`DELETE FROM events WHERE id = ?`, [evid]);
  await pRun(`DELETE FROM fighters WHERE id = ?`, [fid]);

  return results;
}

module.exports = { run };
