/**
 * data/admin/issues.js
 *
 * Read-side aggregation for the local admin portal.
 */
const db = require('../../db');
const auditApi = require('../audit/api');
const backfillApi = require('../backfill/api');

function pAllRows(sql, params) {
  try { return Promise.resolve(db.allRows(sql, params)); }
  catch (e) { return Promise.reject(e); }
}
function pOneRow(sql, params) {
  try { return Promise.resolve(db.oneRow(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

async function count(table, where = '', params = []) {
  const row = await pOneRow(`SELECT COUNT(*) AS c FROM ${table} ${where}`, params);
  return Number(row && row.c) || 0;
}

async function getAuditRuns({ limit = 25 } = {}) {
  return pAllRows(`
    SELECT run_id, started_at, finished_at, status, trigger_source, scope_input, summary, error_text
    FROM audit_runs
    ORDER BY started_at DESC
    LIMIT ?
  `, [Math.min(parseInt(limit, 10) || 25, 100)]);
}

async function getWorstCoverage(runId, limit = 20) {
  if (!runId) return [];
  return pAllRows(`
    SELECT run_id, ran_at, table_name, column_name, scope, total_rows, non_null_rows,
           coverage_pct, gap_row_ids
    FROM coverage_snapshots
    WHERE run_id = ? AND total_rows > 0
    ORDER BY coverage_pct ASC, total_rows DESC
    LIMIT ?
  `, [runId, Math.min(parseInt(limit, 10) || 20, 100)]);
}

async function getQueueCounts() {
  const rows = await pAllRows(`
    SELECT status, COUNT(*) AS c
    FROM pending_backfill
    GROUP BY status
  `);
  const out = {};
  for (const r of rows) out[r.status] = Number(r.c) || 0;
  return out;
}

async function getOverview() {
  const dbStats = await db.getDbStats();
  const latestRunId = await auditApi.getLatestCompleteRunId();
  const auditRuns = await getAuditRuns({ limit: 5 });
  const queueCounts = await getQueueCounts();
  const worstCoverage = await getWorstCoverage(latestRunId, 12);
  const diff = await auditApi.getDiffLast2();
  const regressions = (diff.diffs || []).filter(d => d.delta != null && d.delta < 0).slice(0, 12);

  return {
    db: dbStats,
    latest_run_id: latestRunId,
    audit_runs: auditRuns,
    queue_counts: queueCounts,
    worst_coverage: worstCoverage,
    regressions,
  };
}

async function getIssues() {
  const latestRunId = await auditApi.getLatestCompleteRunId();
  const diff = await auditApi.getDiffLast2();
  const auditRuns = await getAuditRuns({ limit: 30 });
  const worstCoverage = await getWorstCoverage(latestRunId, 50);
  const pending = await backfillApi.listQueue({ status: 'pending', limit: 100 });
  const rejected = await backfillApi.listQueue({ status: 'rejected', limit: 50 });
  const superseded = await backfillApi.listQueue({ status: 'superseded', limit: 50 });

  const failedRuns = auditRuns.filter(r => r.status === 'partial' || r.status === 'error');
  const regressions = (diff.diffs || []).filter(d => d.delta != null && d.delta < 0);
  const lowCoverage = worstCoverage.filter(r => Number(r.coverage_pct) < 0.9);

  return {
    generated_at: new Date().toISOString(),
    latest_run_id: latestRunId,
    counts: {
      failed_runs: failedRuns.length,
      regressions: regressions.length,
      low_coverage: lowCoverage.length,
      pending_queue: await count('pending_backfill', `WHERE status = 'pending'`),
    },
    failed_runs: failedRuns,
    regressions,
    low_coverage: lowCoverage,
    queue: { pending, rejected, superseded },
  };
}

module.exports = { getOverview, getIssues, getAuditRuns };
