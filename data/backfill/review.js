/**
 * data/backfill/review.js
 *
 * Shared approval/rejection logic for queued backfill proposals.
 */
const db = require('../../db');
const { parseKey } = require('../admin/registry');
const { logAction } = require('../admin/actions');

function pRun(sql, params) {
  try { return Promise.resolve(db.run(sql, params)); }
  catch (e) { return Promise.reject(e); }
}
function pOneRow(sql, params) {
  try { return Promise.resolve(db.oneRow(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

function parseValue(jsonStr) {
  if (jsonStr === null || jsonStr === undefined) return null;
  try { return JSON.parse(jsonStr); } catch { return jsonStr; }
}

function whereFromParsed(parsed) {
  return {
    sql: parsed.columns.map(c => `${c} = ?`).join(' AND '),
    params: parsed.values,
  };
}

async function getQueueRow(id) {
  const row = await pOneRow(`SELECT * FROM pending_backfill WHERE id = ?`, [id]);
  if (!row) throw Object.assign(new Error('queue row not found'), { status: 404, code: 'not_found' });
  return row;
}

async function approveBackfill(id, { reason = null, actor = 'local-admin', ip = null } = {}) {
  const row = await getQueueRow(id);
  if (row.status !== 'pending' && row.status !== 'approved') {
    throw Object.assign(new Error('queue row is not pending'), { status: 409, code: 'invalid_status' });
  }

  const proposed = parseValue(row.proposed_value);
  const expected = parseValue(row.current_value);
  const parsed = parseKey(row.table_name, row.row_id);
  const where = whereFromParsed(parsed);
  const current = await pOneRow(
    `SELECT ${row.column_name} AS v FROM ${row.table_name} WHERE ${where.sql}`,
    where.params
  );

  if (!current) {
    await supersedeBackfill(id, { reason: 'row no longer exists', actor, ip });
    return { applied: false, status: 'superseded', reason: 'row no longer exists' };
  }

  const currentValue = current.v == null ? null : current.v;
  const expectedValue = expected == null ? null : expected;
  if (currentValue !== expectedValue) {
    await supersedeBackfill(id, { reason: 'current value changed since queue entry', actor, ip });
    return { applied: false, status: 'superseded', reason: 'current value changed since queue entry' };
  }

  const updateWhere = currentValue == null
    ? `${where.sql} AND ${row.column_name} IS NULL`
    : `${where.sql} AND ${row.column_name} = ?`;
  const updateParams = currentValue == null
    ? [proposed, ...where.params]
    : [proposed, ...where.params, currentValue];

  await pRun(`UPDATE ${row.table_name} SET ${row.column_name} = ? WHERE ${updateWhere}`, updateParams);
  const now = new Date().toISOString();
  await pRun(`UPDATE pending_backfill SET status='applied', applied_at=?, resolved_at=? WHERE id=?`, [now, now, row.id]);
  await logAction({
    action: 'backfill_approve',
    targetTable: row.table_name,
    targetKey: row.row_id,
    targetColumn: row.column_name,
    before: currentValue,
    after: proposed,
    status: 'ok',
    reason,
    metadata: { queue_id: row.id, source: row.source, audit_run_id: row.audit_run_id },
    actor,
    ip,
  });
  return { applied: true, status: 'applied', row_id: row.id };
}

async function rejectBackfill(id, { reason = null, actor = 'local-admin', ip = null } = {}) {
  const row = await getQueueRow(id);
  const now = new Date().toISOString();
  await pRun(`UPDATE pending_backfill SET status='rejected', resolved_at=?, reason=COALESCE(?, reason) WHERE id=?`,
    [now, reason, row.id]);
  await logAction({
    action: 'backfill_reject',
    targetTable: row.table_name,
    targetKey: row.row_id,
    targetColumn: row.column_name,
    before: parseValue(row.current_value),
    after: parseValue(row.proposed_value),
    status: 'ok',
    reason,
    metadata: { queue_id: row.id, source: row.source, audit_run_id: row.audit_run_id },
    actor,
    ip,
  });
  return { status: 'rejected', row_id: row.id };
}

async function supersedeBackfill(id, { reason = null, actor = 'local-admin', ip = null } = {}) {
  const row = await getQueueRow(id);
  const now = new Date().toISOString();
  await pRun(`UPDATE pending_backfill SET status='superseded', resolved_at=?, reason=COALESCE(?, reason) WHERE id=?`,
    [now, reason, row.id]);
  await logAction({
    action: 'backfill_supersede',
    targetTable: row.table_name,
    targetKey: row.row_id,
    targetColumn: row.column_name,
    before: parseValue(row.current_value),
    after: parseValue(row.proposed_value),
    status: 'ok',
    reason,
    metadata: { queue_id: row.id, source: row.source, audit_run_id: row.audit_run_id },
    actor,
    ip,
  });
  return { status: 'superseded', row_id: row.id };
}

module.exports = { approveBackfill, rejectBackfill, supersedeBackfill, parseValue };
