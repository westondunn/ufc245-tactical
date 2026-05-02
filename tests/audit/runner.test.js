const db = require('../../db');
const { runAudit } = require('../../data/audit/runner');

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

  console.log('\nAudit Runner:');

  await db.init();

  // Plant fixture: 4 fighters, 2 with reach_cm, 2 without
  for (const fid of [9201, 9202, 9203, 9204]) {
    await pRun(`INSERT OR REPLACE INTO fighters (id, name) VALUES (?, ?)`, [fid, `RunnerFixture${fid}`]);
  }
  await pRun(`UPDATE fighters SET reach_cm = ? WHERE id IN (?, ?)`, [180, 9201, 9202]);

  const spec = [
    { table: 'fighters', column: 'reach_cm', scopes: ['all'] },
  ];

  const result = await runAudit({ spec, triggerSource: 'test' });

  assert(typeof result.run_id === 'string' && result.run_id.length > 0, 'run_id returned');
  assert(Array.isArray(result.summary), 'summary array returned');
  assert(result.summary.length >= 1, 'summary has at least one entry');

  const reachEntry = result.summary.find(r => r.table_name === 'fighters' && r.column_name === 'reach_cm' && r.scope === 'all');
  assert(reachEntry, 'reach_cm/all entry present');
  assert(reachEntry.total_rows >= 4, 'total_rows includes fixture rows');
  assert(reachEntry.coverage_pct >= 0 && reachEntry.coverage_pct <= 1, 'coverage_pct is a fraction');

  const persisted = await pAllRows(`SELECT * FROM coverage_snapshots WHERE run_id = ?`, [result.run_id]);
  assert(persisted.length === 1, 'one snapshot row persisted');

  const arRows = await pAllRows(`SELECT * FROM audit_runs WHERE run_id = ?`, [result.run_id]);
  assert(arRows.length === 1, 'audit_runs row written');
  assert(arRows[0].status === 'complete', 'audit_runs status is complete');

  // Cleanup
  await pRun(`DELETE FROM coverage_snapshots WHERE run_id = ?`, [result.run_id]);
  await pRun(`DELETE FROM audit_runs WHERE run_id = ?`, [result.run_id]);
  await pRun(`DELETE FROM fighters WHERE id IN (9201, 9202, 9203, 9204)`);

  // ── Test row-existence sentinel column ──
  const past = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  await pRun(`INSERT OR REPLACE INTO events (id, name, date) VALUES (?, ?, ?)`, [9301, 'RunnerEvt', past]);
  for (const fid of [9301, 9302, 9303, 9304]) {
    await pRun(`INSERT OR REPLACE INTO fighters (id, name) VALUES (?, ?)`, [fid, `RunnerEvtFighter${fid}`]);
  }
  await pRun(`INSERT OR REPLACE INTO fights (id, event_id, red_fighter_id, blue_fighter_id) VALUES (?, ?, ?, ?)`,
    [9401, 9301, 9301, 9302]);
  await pRun(`INSERT OR REPLACE INTO fights (id, event_id, red_fighter_id, blue_fighter_id) VALUES (?, ?, ?, ?)`,
    [9402, 9301, 9303, 9304]);
  await pRun(`
    INSERT OR REPLACE INTO official_fight_outcomes (fight_id, event_id, status, captured_at)
    VALUES (?, ?, ?, ?)
  `, [9401, 9301, 'final', new Date().toISOString()]);

  const rowSpec = [
    { table: 'official_fight_outcomes', column: '__row__', scopes: ['completed-fights'] },
  ];
  const r2 = await runAudit({ spec: rowSpec, triggerSource: 'test' });
  const rowEntry = r2.summary.find(r => r.table_name === 'official_fight_outcomes' && r.column_name === '__row__');
  assert(rowEntry, '__row__ sentinel produces snapshot row');
  assert(rowEntry.total_rows >= 2, '__row__ total_rows >= 2');
  assert(rowEntry.non_null_rows >= 1 && rowEntry.non_null_rows <= rowEntry.total_rows, '__row__ non_null in expected range');

  // Cleanup
  await pRun(`DELETE FROM coverage_snapshots WHERE run_id = ?`, [r2.run_id]);
  await pRun(`DELETE FROM audit_runs WHERE run_id = ?`, [r2.run_id]);
  await pRun(`DELETE FROM official_fight_outcomes WHERE fight_id IN (9401, 9402)`);
  await pRun(`DELETE FROM fights WHERE id IN (9401, 9402)`);
  await pRun(`DELETE FROM fighters WHERE id IN (9301, 9302, 9303, 9304)`);
  await pRun(`DELETE FROM events WHERE id = 9301`);

  return results;
}

module.exports = { run };
