/**
 * data/audit/runner.js
 *
 * Executes the coverage spec against the live DB, writes coverage_snapshots
 * rows, and updates audit_runs. Each (column × scope) is its own try/catch so
 * a single failure doesn't kill the run.
 *
 *   const result = await runAudit({ spec?, scope?, triggerSource? });
 *   // → { run_id, summary, duration_ms, status }
 */

const crypto = require('crypto');
const db = require('../../db');
const { resolveScope } = require('./scopes');
const defaultSpec = require('./coverage-spec');

const GAP_SAMPLE_LIMIT = 50;

function newRunId() {
  return crypto.randomBytes(8).toString('hex');
}

// db helpers may be sync (sql.js) or async (pg) — wrap so callers can always await.
function pRun(sql, params) {
  try { return Promise.resolve(db.run(sql, params)); }
  catch (e) { return Promise.reject(e); }
}
function pAllRows(sql, params) {
  try { return Promise.resolve(db.allRows(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

async function auditOne(runId, ranAt, table, column, scope) {
  const { joinSql, idColumn } = resolveScope(table, scope);

  let totalRows, nonNullRows, gapIds;

  if (column === '__row__') {
    // Row-existence audit: parent universe = the fights/events scope without the
    // join restriction; target = rows that joined successfully. Coverage = how
    // many parent rows have a corresponding row in the target table.
    const parentScope = scope.startsWith('event:')
      ? resolveScope('fights', scope)
      : resolveScope('fights', scope === 'upcoming-fights' ? 'upcoming-fights' : 'completed');
    const parentRes = await pAllRows(`SELECT DISTINCT ${parentScope.idColumn} AS id FROM ${parentScope.joinSql}`);
    const parentIds = new Set(parentRes.map(r => String(r.id)));

    const targetRes = await pAllRows(`SELECT DISTINCT ${idColumn} AS id FROM ${joinSql}`);
    const presentIds = new Set(targetRes.map(r => String(r.id)));

    totalRows = parentIds.size;
    nonNullRows = [...parentIds].filter(id => presentIds.has(id)).length;
    gapIds = [...parentIds].filter(id => !presentIds.has(id)).slice(0, GAP_SAMPLE_LIMIT);
  } else {
    const hasWhere = /\bWHERE\b/i.test(joinSql);
    const totalSql = `SELECT count(*) AS n FROM ${joinSql}`;
    const nullSql = hasWhere
      ? `SELECT ${idColumn} AS id FROM ${joinSql} AND ${table}.${column} IS NULL LIMIT ${GAP_SAMPLE_LIMIT}`
      : `SELECT ${idColumn} AS id FROM ${joinSql} WHERE ${table}.${column} IS NULL LIMIT ${GAP_SAMPLE_LIMIT}`;
    const nullCountSql = hasWhere
      ? `SELECT count(*) AS n FROM ${joinSql} AND ${table}.${column} IS NULL`
      : `SELECT count(*) AS n FROM ${joinSql} WHERE ${table}.${column} IS NULL`;

    const totalRes = await pAllRows(totalSql);
    totalRows = parseInt(totalRes[0].n, 10) || 0;

    const nullRes = await pAllRows(nullSql);
    gapIds = nullRes.map(r => String(r.id));

    const nullCountRes = await pAllRows(nullCountSql);
    const nullCount = parseInt(nullCountRes[0].n, 10) || 0;
    nonNullRows = totalRows - nullCount;
  }

  const coveragePct = totalRows === 0 ? 1 : nonNullRows / totalRows;

  await pRun(`
    INSERT INTO coverage_snapshots
      (run_id, ran_at, table_name, column_name, scope, total_rows, non_null_rows, coverage_pct, gap_row_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [runId, ranAt, table, column, scope, totalRows, nonNullRows, coveragePct, JSON.stringify(gapIds)]);

  return {
    table_name: table,
    column_name: column,
    scope,
    total_rows: totalRows,
    non_null_rows: nonNullRows,
    coverage_pct: coveragePct,
    gap_row_ids: gapIds,
  };
}

async function runAudit({ spec = defaultSpec, scope = null, triggerSource = 'cli' } = {}) {
  const runId = newRunId();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  await pRun(`
    INSERT INTO audit_runs (run_id, started_at, status, trigger_source, scope_input)
    VALUES (?, ?, ?, ?, ?)
  `, [runId, startedAt, 'running', triggerSource, JSON.stringify(scope)]);

  const summary = [];
  const errors = [];

  for (const entry of spec) {
    const scopes = scope ? [scope] : entry.scopes;
    for (const sc of scopes) {
      try {
        const row = await auditOne(runId, startedAt, entry.table, entry.column, sc);
        summary.push(row);
      } catch (e) {
        errors.push({ table: entry.table, column: entry.column, scope: sc, error: String(e.message || e) });
        console.error(`[audit ${runId}] ${entry.table}.${entry.column}/${sc}: ${e.message}`);
      }
    }
  }

  const finishedAt = new Date().toISOString();
  const duration = Date.now() - t0;
  const status = errors.length === 0 ? 'complete' : (summary.length > 0 ? 'partial' : 'error');

  await pRun(`
    UPDATE audit_runs
    SET finished_at = ?, status = ?, summary = ?, error_text = ?
    WHERE run_id = ?
  `, [finishedAt, status, JSON.stringify({ entries: summary.length, errors: errors.length }),
      errors.length ? JSON.stringify(errors) : null, runId]);

  return { run_id: runId, summary, duration_ms: duration, status, errors };
}

module.exports = { runAudit, GAP_SAMPLE_LIMIT };
