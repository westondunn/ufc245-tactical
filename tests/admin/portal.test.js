const db = require('../../db');
const { validateField, updateEntity } = require('../../data/admin/registry');
const { approveBackfill } = require('../../data/backfill/review');

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

  console.log('\nAdmin Portal Modules:');
  await db.init();

  const actionTable = await pAllRows(`SELECT * FROM admin_action_log LIMIT 1`).catch(e => ({ error: e.message }));
  assert(!actionTable.error, 'admin_action_log table exists');

  assert(validateField('fighters', 'reach_cm', '188') === 188, 'whitelisted numeric validator coerces integer');
  let badColumnRejected = false;
  try { validateField('fighters', 'made_up_column', 'x'); } catch { badColumnRejected = true; }
  assert(badColumnRejected, 'whitelist rejects unknown column');

  const fid = 991001;
  await pRun(`INSERT OR REPLACE INTO fighters (id, name, reach_cm, nationality) VALUES (?, ?, NULL, ?)`,
    [fid, 'AdminPortalFixture', 'Testland']);

  const now = new Date().toISOString();
  await pRun(`
    INSERT INTO pending_backfill
      (table_name, row_id, column_name, current_value, proposed_value, source,
       confidence, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, ['fighters', String(fid), 'reach_cm', null, JSON.stringify(188), 'unit-test', 'review', 'pending', now]);
  const queued = await pOneRow(`SELECT * FROM pending_backfill WHERE table_name='fighters' AND row_id=? AND column_name='reach_cm'`, [String(fid)]);
  const approve = await approveBackfill(queued.id, { actor: 'test' });
  const afterApprove = await pOneRow(`SELECT reach_cm FROM fighters WHERE id=?`, [fid]);
  assert(approve.applied === true, 'approveBackfill reports applied');
  assert(Number(afterApprove.reach_cm) === 188, 'approveBackfill writes proposed value');

  const logRows = await pAllRows(`SELECT * FROM admin_action_log WHERE target_table='fighters' AND target_key=?`, [String(fid)]);
  assert(logRows.some(r => r.action === 'backfill_approve'), 'approveBackfill writes action log');

  const manual = await updateEntity({
    table: 'fighters',
    id: String(fid),
    changes: { nationality: 'Adminia' },
    reason: 'unit test manual edit',
    actor: 'test',
  });
  assert(manual.changed.includes('nationality'), 'manual edit reports changed field');
  const afterManual = await pOneRow(`SELECT nationality FROM fighters WHERE id=?`, [fid]);
  assert(afterManual.nationality === 'Adminia', 'manual edit writes whitelisted field');

  const conflictId = 991002;
  await pRun(`INSERT OR REPLACE INTO fighters (id, name, reach_cm) VALUES (?, ?, NULL)`,
    [conflictId, 'AdminPortalConflict']);
  await pRun(`
    INSERT INTO pending_backfill
      (table_name, row_id, column_name, current_value, proposed_value, source,
       confidence, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, ['fighters', String(conflictId), 'reach_cm', null, JSON.stringify(190), 'unit-test', 'review', 'pending', now]);
  const conflictQueue = await pOneRow(`SELECT * FROM pending_backfill WHERE table_name='fighters' AND row_id=?`, [String(conflictId)]);
  await pRun(`UPDATE fighters SET reach_cm = ? WHERE id = ?`, [181, conflictId]);
  const conflict = await approveBackfill(conflictQueue.id, { actor: 'test' });
  assert(conflict.status === 'superseded', 'approveBackfill supersedes stale queued proposal');

  await pRun(`DELETE FROM pending_backfill WHERE row_id IN (?, ?)`, [String(fid), String(conflictId)]);
  await pRun(`DELETE FROM admin_action_log WHERE target_key IN (?, ?)`, [String(fid), String(conflictId)]);
  await pRun(`DELETE FROM fighters WHERE id IN (?, ?)`, [fid, conflictId]);

  return results;
}

module.exports = { run };
