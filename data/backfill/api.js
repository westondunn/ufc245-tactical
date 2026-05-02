/**
 * data/backfill/api.js — read-side helpers powering /api/data/backfill/queue.
 */
const db = require('../../db');

function pAllRows(sql, params) {
  try { return Promise.resolve(db.allRows(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

async function listQueue({ status = 'pending', limit = 50, offset = 0 } = {}) {
  return pAllRows(`
    SELECT id, table_name, row_id, column_name, current_value, proposed_value,
           source, source_url, confidence, reason, source_diff_json, status,
           created_at, resolved_at, applied_at, audit_run_id
    FROM pending_backfill
    WHERE status = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [status, Math.min(parseInt(limit, 10) || 50, 500), parseInt(offset, 10) || 0]);
}

module.exports = { listQueue };
