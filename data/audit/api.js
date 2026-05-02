/**
 * data/audit/api.js — read-side helpers powering /api/data/coverage
 */
const db = require('../../db');

function pAllRows(sql, params) {
  try { return Promise.resolve(db.allRows(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

async function getLatestCompleteRunId() {
  const rows = await pAllRows(`
    SELECT run_id FROM audit_runs WHERE status = 'complete' ORDER BY started_at DESC LIMIT 1
  `);
  return rows[0] ? rows[0].run_id : null;
}

async function getCoverageForRun(runId) {
  return pAllRows(`
    SELECT run_id, ran_at, table_name, column_name, scope, total_rows, non_null_rows, coverage_pct, gap_row_ids
    FROM coverage_snapshots
    WHERE run_id = ?
    ORDER BY table_name, column_name, scope
  `, [runId]);
}

async function getColumnHistory({ table, column, scope = null, limit = 30 }) {
  const params = [table, column];
  let sql = `
    SELECT run_id, ran_at, scope, total_rows, non_null_rows, coverage_pct
    FROM coverage_snapshots
    WHERE table_name = ? AND column_name = ?
  `;
  if (scope) {
    sql += ' AND scope = ?';
    params.push(scope);
  }
  sql += ' ORDER BY ran_at DESC LIMIT ?';
  params.push(Math.min(parseInt(limit, 10) || 30, 200));
  return pAllRows(sql, params);
}

async function getDiffLast2() {
  const recent = await pAllRows(`
    SELECT run_id, started_at FROM audit_runs WHERE status = 'complete' ORDER BY started_at DESC LIMIT 2
  `);
  if (recent.length < 2) return { runs: recent.map(r => r.run_id), diffs: [] };

  const [latest, prev] = recent;
  const latestRows = await getCoverageForRun(latest.run_id);
  const prevRows = await getCoverageForRun(prev.run_id);

  const prevMap = new Map();
  for (const r of prevRows) prevMap.set(`${r.table_name}|${r.column_name}|${r.scope}`, r);

  const diffs = [];
  for (const r of latestRows) {
    const key = `${r.table_name}|${r.column_name}|${r.scope}`;
    const prevRow = prevMap.get(key);
    const prevPct = prevRow ? Number(prevRow.coverage_pct) : null;
    const nowPct = Number(r.coverage_pct);
    const delta = prevPct === null ? null : nowPct - prevPct;
    diffs.push({
      table_name: r.table_name,
      column_name: r.column_name,
      scope: r.scope,
      prev_pct: prevPct,
      now_pct: nowPct,
      delta,
    });
  }
  diffs.sort((a, b) => (a.delta == null ? 0 : a.delta) - (b.delta == null ? 0 : b.delta));

  return { runs: [latest.run_id, prev.run_id], diffs };
}

module.exports = { getLatestCompleteRunId, getCoverageForRun, getColumnHistory, getDiffLast2 };
