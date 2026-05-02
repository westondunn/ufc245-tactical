const db = require('../../db');
const { runBackfill } = require('../../data/backfill/dispatcher');

function pRun(sql, params) {
  try { return Promise.resolve(db.run(sql, params)); }
  catch (e) { return Promise.reject(e); }
}
function pAllRows(sql, params) {
  try { return Promise.resolve(db.allRows(sql, params)); }
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

  console.log('\nBackfill Dispatcher:');

  await db.init();

  const fixId = 9501;
  await pRun(`INSERT OR REPLACE INTO fighters (id, name, ufcstats_hash) VALUES (?, ?, ?)`,
    [fixId, 'DispatcherFixture', 'fakehash9501']);
  await pRun(`UPDATE fighters SET reach_cm = NULL WHERE id = ?`, [fixId]);

  const runId = 'dispatcher-test-run';
  await pRun(`
    INSERT INTO coverage_snapshots (run_id, ran_at, table_name, column_name, scope, total_rows, non_null_rows, coverage_pct, gap_row_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [runId, new Date().toISOString(), 'fighters', 'reach_cm', 'all', 1, 0, 0.0, JSON.stringify([fixId])]);
  await pRun(`
    INSERT INTO audit_runs (run_id, started_at, status, trigger_source) VALUES (?, ?, ?, ?)
  `, [runId, new Date().toISOString(), 'complete', 'test']);

  const scraperMocks = {
    'ufcstats-fighter-page': async () => ({ reach_cm: 175, height_cm: 170, source_url: 'http://test/fixture' }),
    'ufc-com-athlete':       async () => ({ headshot_url: null }),
  };

  const result = await runBackfill({ runId, scraperMocks });

  assert(typeof result === 'object', 'returns object');
  assert(result.auto >= 1 || result.queued >= 1, 'at least one decision recorded');

  const fr = await pOneRow(`SELECT reach_cm FROM fighters WHERE id = ?`, [fixId]);
  const queueRows = await pAllRows(
    `SELECT * FROM pending_backfill WHERE table_name = ? AND row_id = ? AND column_name = ?`,
    ['fighters', String(fixId), 'reach_cm']
  );
  assert(queueRows.length >= 1, 'pending_backfill row created (auto-applied or pending)');
  if (queueRows[0] && queueRows[0].status === 'applied') {
    assert(fr.reach_cm === 175, 'fighter reach_cm auto-written');
  } else {
    assert(fr.reach_cm == null, 'fighter reach_cm not written until approved');
  }

  // Cleanup
  await pRun(`DELETE FROM pending_backfill WHERE table_name = ? AND row_id = ?`, ['fighters', String(fixId)]);
  await pRun(`DELETE FROM coverage_snapshots WHERE run_id = ?`, [runId]);
  await pRun(`DELETE FROM audit_runs WHERE run_id = ?`, [runId]);
  await pRun(`DELETE FROM fighters WHERE id = ?`, [fixId]);

  return results;
}

module.exports = { run };
