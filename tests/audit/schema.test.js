const db = require('../../db');

// Helpers that wrap db.run/db.allRows so they work on both sync (SQLite/sql.js)
// and async (Postgres) backends — sql.js helpers throw synchronously, pg helpers
// reject. Always returns a promise so the test can use .catch / await uniformly.
function pRun(sql, params) {
  try { return Promise.resolve(db.run(sql, params)); }
  catch (e) { return Promise.reject(e); }
}
function pAllRows(sql, params) {
  try { return Promise.resolve(db.allRows(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nAudit/Backfill Schema:');

  await db.init();

  // coverage_snapshots
  const cs = await pAllRows(`SELECT * FROM coverage_snapshots LIMIT 1`).catch(e => ({ error: e.message }));
  assert(!cs.error, 'coverage_snapshots table exists');

  // audit_runs
  const ar = await pAllRows(`SELECT * FROM audit_runs LIMIT 1`).catch(e => ({ error: e.message }));
  assert(!ar.error, 'audit_runs table exists');

  // pending_backfill
  const pb = await pAllRows(`SELECT * FROM pending_backfill LIMIT 1`).catch(e => ({ error: e.message }));
  assert(!pb.error, 'pending_backfill table exists');

  // Insert + select round-trip on coverage_snapshots
  await pRun(`
    INSERT INTO coverage_snapshots (run_id, ran_at, table_name, column_name, scope, total_rows, non_null_rows, coverage_pct, gap_row_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, ['test-run-1', new Date().toISOString(), 'fighters', 'reach_cm', 'all', 100, 80, 0.8, JSON.stringify([1, 2, 3])]);

  const rows = await pAllRows(`SELECT * FROM coverage_snapshots WHERE run_id = ?`, ['test-run-1']);
  assert(rows.length === 1, 'coverage_snapshots row inserted');
  assert(rows[0].coverage_pct === 0.8 || rows[0].coverage_pct === '0.8', 'coverage_pct round-trips');

  // Insert + select on audit_runs
  await pRun(`
    INSERT INTO audit_runs (run_id, started_at, status, trigger_source)
    VALUES (?, ?, ?, ?)
  `, ['test-run-1', new Date().toISOString(), 'complete', 'cli']);
  const arRows = await pAllRows(`SELECT * FROM audit_runs WHERE run_id = ?`, ['test-run-1']);
  assert(arRows.length === 1, 'audit_runs row inserted');

  // Insert on pending_backfill, then test partial unique index conflict
  const now = new Date().toISOString();
  await pRun(`
    INSERT INTO pending_backfill
      (table_name, row_id, column_name, current_value, proposed_value, source, confidence, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, ['fighters', '42', 'reach_cm', null, '180', 'ufcstats-fighter-page', 'auto', 'pending', now]);

  let secondInsertFailed = false;
  try {
    await pRun(`
      INSERT INTO pending_backfill
        (table_name, row_id, column_name, current_value, proposed_value, source, confidence, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, ['fighters', '42', 'reach_cm', null, '180', 'ufcstats-fighter-page', 'auto', 'pending', now]);
  } catch (e) {
    secondInsertFailed = true;
  }
  assert(secondInsertFailed, 'unique partial index blocks duplicate pending row');

  // Cleanup
  await pRun(`DELETE FROM coverage_snapshots WHERE run_id = ?`, ['test-run-1']);
  await pRun(`DELETE FROM audit_runs WHERE run_id = ?`, ['test-run-1']);
  await pRun(`DELETE FROM pending_backfill WHERE table_name = ? AND row_id = ? AND column_name = ?`,
    ['fighters', '42', 'reach_cm']);

  return results;
}

module.exports = { run };
