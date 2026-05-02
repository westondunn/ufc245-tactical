/**
 * data/backfill/dispatcher.js
 *
 * Loads gaps from coverage_snapshots, groups by source, fetches each source
 * once per row, applies the gate, and either writes directly + logs (auto)
 * or queues a pending_backfill row.
 *
 * Pass `scraperMocks` to inject deterministic source fetchers in tests.
 */
const db = require('../../db');
const spec = require('./backfill-spec');
const { decide } = require('./gate');
const { runVerify } = require('./verify');
const { fetchFighter } = require('../scrapers/ufcstats-fighter');
const { fetchAthlete } = require('../scrapers/ufc-com-athlete');

const SOURCE_FETCHERS = {
  'ufcstats-fighter-page': async (ctx) => fetchFighter(ctx.ufcstats_hash, {}),
  'ufc-com-athlete':       async (ctx) => fetchAthlete(ctx.ufc_slug, {}),
  'ufcstats-event-page':   async () => null,
  'ufcstats-fight-page':   async () => null,
};

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

async function loadGaps(runId) {
  const rows = await pAllRows(`
    SELECT table_name, column_name, scope, gap_row_ids
    FROM coverage_snapshots
    WHERE run_id = ?
  `, [runId]);
  const gaps = [];
  for (const r of rows) {
    let ids = [];
    try { ids = JSON.parse(r.gap_row_ids || '[]'); } catch {}
    for (const id of ids) {
      gaps.push({ table: r.table_name, column: r.column_name, scope: r.scope, row_id: String(id) });
    }
  }
  return gaps;
}

async function loadFighterContext(rowId) {
  return pOneRow(
    `SELECT id, name, ufcstats_hash, reach_cm, height_cm, slpm, str_acc, sapm, str_def,
            td_avg, td_acc, td_def, sub_avg, headshot_url, body_url, stance, dob, weight_class
     FROM fighters WHERE id = ?`,
    [rowId]
  );
}

async function logDecision({ table, rowId, column, current, proposed, source, sourceUrl, decision, reason, sourcesDiff, runId, applied }) {
  const now = new Date().toISOString();
  const status = applied ? 'applied' : 'pending';
  const appliedAt = applied ? now : null;

  try {
    await pRun(`
      INSERT INTO pending_backfill
        (table_name, row_id, column_name, current_value, proposed_value, source, source_url,
         confidence, reason, source_diff_json, status, created_at, applied_at, audit_run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [table, String(rowId), column,
        current === null || current === undefined ? null : JSON.stringify(current),
        JSON.stringify(proposed),
        source, sourceUrl || null,
        decision, reason,
        sourcesDiff ? JSON.stringify(sourcesDiff) : null,
        status, now, appliedAt, runId || null]);
  } catch (e) {
    // Unique-open-row index → update existing pending/approved row
    await pRun(`
      UPDATE pending_backfill
      SET proposed_value = ?, source = ?, source_url = ?, confidence = ?, reason = ?,
          source_diff_json = ?, audit_run_id = ?
      WHERE table_name = ? AND row_id = ? AND column_name = ? AND status IN ('pending','approved')
    `, [JSON.stringify(proposed), source, sourceUrl || null, decision, reason,
        sourcesDiff ? JSON.stringify(sourcesDiff) : null, runId || null,
        table, String(rowId), column]);
  }
}

async function applyAutoWrite({ table, rowId, column, current, proposed }) {
  // Conditional UPDATE: only write if value still matches (idempotency under races)
  if (current === null || current === undefined) {
    await pRun(`UPDATE ${table} SET ${column} = ? WHERE id = ? AND ${column} IS NULL`, [proposed, rowId]);
  } else {
    await pRun(`UPDATE ${table} SET ${column} = ? WHERE id = ? AND ${column} = ?`, [proposed, rowId, current]);
  }
}

async function runBackfill({ runId, dryRun = false, scraperMocks = null } = {}) {
  const gaps = await loadGaps(runId);
  const fetchers = scraperMocks || SOURCE_FETCHERS;

  let auto = 0, queued = 0, rejected = 0;
  const errors = [];

  const fetchCache = new Map();
  async function fetchOnce(sourceName, ctx) {
    const key = `${sourceName}:${ctx.id}`;
    if (fetchCache.has(key)) return fetchCache.get(key);
    const fetcher = fetchers[sourceName];
    if (!fetcher) throw new Error(`No fetcher for source ${sourceName}`);
    const p = Promise.resolve().then(() => fetcher(ctx));
    fetchCache.set(key, p);
    return p;
  }

  for (const gap of gaps) {
    try {
      const specKey = `${gap.table}.${gap.column}`;
      const wildcardKey = `${gap.table}.*`;
      const specEntry = spec[specKey] || spec[wildcardKey];
      if (!specEntry) continue;

      let ctx = null;
      if (gap.table === 'fighters') ctx = await loadFighterContext(gap.row_id);
      if (!ctx) continue;

      const current = ctx[gap.column] != null ? ctx[gap.column] : null;

      const srcResult = await fetchOnce(specEntry.source, ctx);
      if (!srcResult) continue;
      const proposed = srcResult[gap.column];
      if (proposed === undefined || proposed === null) continue;

      const verifyCtx = { current, proposed, bounds: specEntry.bounds };
      const verify = await runVerify(specEntry.verify, verifyCtx);

      const sources = [{ name: specEntry.source, value: proposed }];

      const decision = decide({
        safety: specEntry.safety,
        current,
        proposed,
        sources,
        verifyPassed: verify.passed,
        ambiguousIdentity: false,
      });

      if (dryRun) {
        console.log(`[dry-run] ${gap.table}.${gap.column} id=${gap.row_id} → ${decision.decision} (${decision.reason})`);
        continue;
      }

      if (decision.decision === 'auto') {
        await applyAutoWrite({ table: gap.table, rowId: gap.row_id, column: gap.column, current, proposed });
        await logDecision({ table: gap.table, rowId: gap.row_id, column: gap.column, current, proposed,
          source: specEntry.source, sourceUrl: srcResult.source_url, decision: 'auto',
          reason: decision.reason, sourcesDiff: { sources }, runId, applied: true });
        auto++;
      } else if (decision.decision === 'review') {
        await logDecision({ table: gap.table, rowId: gap.row_id, column: gap.column, current, proposed,
          source: specEntry.source, sourceUrl: srcResult.source_url, decision: 'review',
          reason: decision.reason, sourcesDiff: { sources }, runId, applied: false });
        queued++;
      } else if (decision.decision === 'reject') {
        await logDecision({ table: gap.table, rowId: gap.row_id, column: gap.column, current, proposed,
          source: specEntry.source, sourceUrl: srcResult.source_url, decision: 'reject',
          reason: decision.reason, sourcesDiff: { sources }, runId, applied: false });
        rejected++;
      }
    } catch (e) {
      errors.push({ gap, error: String(e.message || e) });
      console.error(`[backfill] ${gap.table}.${gap.column} id=${gap.row_id}: ${e.message}`);
    }
  }

  return { auto, queued, rejected, errors, dry_run: dryRun };
}

module.exports = { runBackfill };
