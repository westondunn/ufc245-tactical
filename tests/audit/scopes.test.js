const db = require('../../db');
const { resolveScope } = require('../../data/audit/scopes');

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

  console.log('\nAudit Scopes:');

  await db.init();

  const today = new Date();
  const past = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const future = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);

  await pRun(`INSERT OR REPLACE INTO events (id, name, date) VALUES (?, ?, ?)`, [9001, 'TestEventPast', past]);
  await pRun(`INSERT OR REPLACE INTO events (id, name, date) VALUES (?, ?, ?)`, [9002, 'TestEventFuture', future]);
  for (const fid of [9101, 9102, 9103, 9104]) {
    await pRun(`INSERT OR REPLACE INTO fighters (id, name) VALUES (?, ?)`, [fid, `TestFighter${fid}`]);
  }
  await pRun(`INSERT OR REPLACE INTO fights (id, event_id, red_fighter_id, blue_fighter_id) VALUES (?, ?, ?, ?)`,
    [9201, 9001, 9101, 9102]);
  await pRun(`INSERT OR REPLACE INTO fights (id, event_id, red_fighter_id, blue_fighter_id) VALUES (?, ?, ?, ?)`,
    [9202, 9002, 9103, 9104]);

  const tests = [
    { table: 'fighters', scope: 'all',              expectMatching: id => id >= 9101 && id <= 9104 },
    { table: 'fighters', scope: 'upcoming-roster',  expectMatching: id => id === 9103 || id === 9104 },
    { table: 'events',   scope: 'all',              expectMatching: id => id === 9001 || id === 9002 },
    { table: 'events',   scope: 'upcoming',         expectMatching: id => id === 9002 },
    { table: 'events',   scope: 'completed',        expectMatching: id => id === 9001 },
    { table: 'fights',   scope: 'completed',        expectMatching: id => id === 9201 },
    { table: 'fights',   scope: 'upcoming-fights',  expectMatching: id => id === 9202 },
  ];

  for (const t of tests) {
    const { joinSql, idColumn } = resolveScope(t.table, t.scope);
    const sql = `SELECT DISTINCT ${idColumn} AS id FROM ${joinSql}`;
    const rows = await pAllRows(sql);
    const ids = rows.map(r => r.id).filter(t.expectMatching);
    assert(ids.length > 0, `${t.table}/${t.scope} returns expected rows`);
  }

  // Test event:<id> scope
  const { joinSql, idColumn } = resolveScope('fighters', 'event:9002');
  const rows = await pAllRows(`SELECT DISTINCT ${idColumn} AS id FROM ${joinSql}`);
  const ids = rows.map(r => r.id).sort();
  assert(JSON.stringify(ids) === JSON.stringify([9103, 9104]), 'event:<id> scope filters to that event');

  // Cleanup
  await pRun(`DELETE FROM fights WHERE id IN (9201, 9202)`);
  await pRun(`DELETE FROM fighters WHERE id IN (9101, 9102, 9103, 9104)`);
  await pRun(`DELETE FROM events WHERE id IN (9001, 9002)`);

  return results;
}

module.exports = { run };
