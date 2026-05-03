/**
 * data/admin/actions.js
 *
 * Append-only action logging for the local admin portal.
 */
const db = require('../../db');

function pRun(sql, params) {
  try { return Promise.resolve(db.run(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

function pAllRows(sql, params) {
  try { return Promise.resolve(db.allRows(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

function asJson(value) {
  if (value === undefined) return null;
  return value === null ? null : JSON.stringify(value);
}

async function logAction({
  action,
  targetTable = null,
  targetKey = null,
  targetColumn = null,
  before = null,
  after = null,
  status = 'ok',
  reason = null,
  metadata = null,
  actor = 'local-admin',
  ip = null,
} = {}) {
  const now = new Date().toISOString();
  await pRun(`
    INSERT INTO admin_action_log
      (action, target_table, target_key, target_column, before_json, after_json,
       status, reason, metadata_json, actor, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    action,
    targetTable,
    targetKey == null ? null : String(targetKey),
    targetColumn,
    asJson(before),
    asJson(after),
    status,
    reason,
    asJson(metadata),
    actor,
    ip,
    now,
  ]);
}

async function listActions({ limit = 100, offset = 0 } = {}) {
  return pAllRows(`
    SELECT id, action, target_table, target_key, target_column, before_json,
           after_json, status, reason, metadata_json, actor, ip, created_at
    FROM admin_action_log
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `, [Math.min(parseInt(limit, 10) || 100, 500), Math.max(parseInt(offset, 10) || 0, 0)]);
}

module.exports = { logAction, listActions };
