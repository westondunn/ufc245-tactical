'use strict';
/**
 * data/integrity/runner.js
 *
 * Runs integrity scanners, upserts findings into data_integrity_issues, and
 * auto-resolves rows that were open last run but absent from this run.
 *
 *   const r = await runIntegrityScan({ scanners?, runId? });
 *   // → { run_id, opened, refreshed, resolved, by_category }
 */
const crypto = require('crypto');
const db = require('../../db');
const defaultScanners = require('./scanners');

function newRunId() { return 'int-' + crypto.randomBytes(6).toString('hex'); }

function pRun(sql, params) {
  try { return Promise.resolve(db.run(sql, params)); }
  catch (e) { return Promise.reject(e); }
}
function pAllRows(sql, params) {
  try { return Promise.resolve(db.allRows(sql, params)); }
  catch (e) { return Promise.reject(e); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Core scan
// ─────────────────────────────────────────────────────────────────────────────

async function runIntegrityScan({ scanners = defaultScanners, runId } = {}) {
  const run_id = runId || newRunId();
  const runStartAt = new Date().toISOString();

  let opened = 0;
  let refreshed = 0;
  let resolved = 0;
  const by_category = {};
  const scannedCategories = new Set();

  for (const scanner of scanners) {
    const { category, severity, subjectType, scan } = scanner;
    scannedCategories.add(category);
    if (!by_category[category]) by_category[category] = { opened: 0, refreshed: 0, resolved: 0 };

    let findings;
    try {
      findings = await scan(db);
    } catch (e) {
      console.error(`[integrity] scanner ${category} error:`, e.message);
      continue;
    }

    const now = new Date().toISOString();
    for (const { subjectId, details } of findings) {
      const detailsJson = JSON.stringify(details ?? null);

      // Check whether the row exists (open or resolved)
      const existing = await pAllRows(
        `SELECT id, resolved_at FROM data_integrity_issues
         WHERE category = ? AND subject_type = ? AND subject_id = ?`,
        [category, subjectType, subjectId]
      );

      if (existing.length === 0) {
        await pRun(`
          INSERT INTO data_integrity_issues
            (category, severity, subject_type, subject_id, details, first_seen_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [category, severity, subjectType, subjectId, detailsJson, now, now]);
        opened++;
        by_category[category].opened++;
      } else if (existing[0].resolved_at == null) {
        // Open row — refresh timestamp and details; do NOT touch first_seen_at
        await pRun(`
          UPDATE data_integrity_issues
          SET last_seen_at = ?, details = ?
          WHERE category = ? AND subject_type = ? AND subject_id = ? AND resolved_at IS NULL
        `, [now, detailsJson, category, subjectType, subjectId]);
        refreshed++;
        by_category[category].refreshed++;
      }
      // resolved_at IS NOT NULL → leave it alone (don't reopen)
    }
  }

  // ── Auto-resolve open rows in scanned categories not seen this run ──
  // Any open row whose last_seen_at is older than runStartAt was not visited.
  if (scannedCategories.size > 0) {
    const catList = [...scannedCategories];
    const catPh = catList.map(() => '?').join(', ');

    const toResolve = await pAllRows(`
      SELECT id, category FROM data_integrity_issues
      WHERE category IN (${catPh})
        AND resolved_at IS NULL
        AND last_seen_at < ?
    `, [...catList, runStartAt]);

    if (toResolve.length > 0) {
      const resolvedAt = new Date().toISOString();
      const ids = toResolve.map(r => r.id);
      const idPh = ids.map(() => '?').join(', ');

      await pRun(`
        UPDATE data_integrity_issues
        SET resolved_at = ?, resolution = 'auto_resolved', resolution_run_id = ?
        WHERE id IN (${idPh})
      `, [resolvedAt, run_id, ...ids]);

      for (const r of toResolve) {
        if (!by_category[r.category]) by_category[r.category] = { opened: 0, refreshed: 0, resolved: 0 };
        by_category[r.category].resolved++;
      }
      resolved = toResolve.length;
    }
  }

  return { run_id, opened, refreshed, resolved, by_category };
}

// ─────────────────────────────────────────────────────────────────────────────
// Query helpers (used by HTTP + CLI)
// ─────────────────────────────────────────────────────────────────────────────

async function listIssues({ status = 'open', category, severity, limit = 50, offset = 0 } = {}) {
  const conditions = [];
  const params = [];
  if (status === 'open') conditions.push('resolved_at IS NULL');
  else if (status === 'resolved') conditions.push('resolved_at IS NOT NULL');
  if (category) { conditions.push('category = ?'); params.push(category); }
  if (severity) { conditions.push('severity = ?'); params.push(severity); }
  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 500);
  const off = Math.max(parseInt(offset, 10) || 0, 0);
  params.push(lim, off);
  return pAllRows(`
    SELECT * FROM data_integrity_issues ${where}
    ORDER BY CASE severity WHEN 'block' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END,
             first_seen_at DESC
    LIMIT ? OFFSET ?
  `, params);
}

async function getSummary() {
  return pAllRows(`
    SELECT category, severity,
      SUM(CASE WHEN resolved_at IS NULL     THEN 1 ELSE 0 END) AS open,
      SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
      COUNT(*) AS total
    FROM data_integrity_issues
    GROUP BY category, severity
    ORDER BY category
  `);
}

async function resolveOne(id, { resolution, note } = {}) {
  const VALID = ['fixed', 'wont_fix', 'duplicate'];
  if (!VALID.includes(resolution)) {
    throw Object.assign(new Error('Invalid resolution'), { status: 400, code: 'invalid_resolution' });
  }
  const existing = await pAllRows(
    `SELECT id FROM data_integrity_issues WHERE id = ? AND resolved_at IS NULL`,
    [id]
  );
  if (existing.length === 0) {
    throw Object.assign(new Error('Issue not found or already resolved'), { status: 404, code: 'not_found' });
  }
  const now = new Date().toISOString();
  await pRun(`
    UPDATE data_integrity_issues
    SET resolved_at = ?, resolution = ?, resolution_note = ?
    WHERE id = ?
  `, [now, resolution, note || null, id]);
  return { resolved: 1 };
}

async function resolveBatch({ category, subject_ids, resolution, note } = {}) {
  const VALID = ['fixed', 'wont_fix', 'duplicate'];
  if (!VALID.includes(resolution)) {
    throw Object.assign(new Error('Invalid resolution'), { status: 400, code: 'invalid_resolution' });
  }
  if (!category) {
    throw Object.assign(new Error('category required'), { status: 400, code: 'category_required' });
  }
  const conditions = ['category = ?', 'resolved_at IS NULL'];
  const condParams = [category];
  if (Array.isArray(subject_ids) && subject_ids.length > 0) {
    const ph = subject_ids.map(() => '?').join(', ');
    conditions.push(`subject_id IN (${ph})`);
    condParams.push(...subject_ids.map(String));
  }

  const toResolve = await pAllRows(
    `SELECT id FROM data_integrity_issues WHERE ${conditions.join(' AND ')}`,
    condParams
  );
  if (toResolve.length === 0) return { resolved: 0 };

  const now = new Date().toISOString();
  const ids = toResolve.map(r => r.id);
  const idPh = ids.map(() => '?').join(', ');
  await pRun(`
    UPDATE data_integrity_issues
    SET resolved_at = ?, resolution = ?, resolution_note = ?
    WHERE id IN (${idPh})
  `, [now, resolution, note || null, ...ids]);
  return { resolved: ids.length };
}

module.exports = { runIntegrityScan, listIssues, getSummary, resolveOne, resolveBatch };
