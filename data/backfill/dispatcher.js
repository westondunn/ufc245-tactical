/**
 * data/backfill/dispatcher.js
 *
 * Loads gaps from coverage_snapshots, groups by source, fetches each source
 * once per row, applies the gate, and either writes directly + logs (auto)
 * or queues a pending_backfill row.
 *
 * Pass `scraperMocks` to inject deterministic source fetchers in tests.
 *
 * Special behaviour for fighters.ufcstats_hash (identity-link safety class):
 *   - Calls the ufcstats-fighter-search source, picks an exact normalized-name
 *     match, and lets the gate decide (auto on single exact match, review
 *     otherwise).
 *   - On auto-apply, immediately cascades to fill all other fighters.* gaps
 *     for the same row using the newly acquired hash, so the nightly job
 *     closes both the hash gap and profile gaps in one pass.
 */
const db = require('../../db');
const spec = require('./backfill-spec');
const { decide } = require('./gate');
const { runVerify } = require('./verify');
const { fetchFighter } = require('../scrapers/ufcstats-fighter');
const { fetchAthlete } = require('../scrapers/ufc-com-athlete');
const { searchFighter } = require('../scrapers/ufcstats-search');

const SOURCE_FETCHERS = {
  'ufcstats-fighter-page':   async (ctx) => fetchFighter(ctx.ufcstats_hash, {}),
  'ufc-com-athlete':         async (ctx) => fetchAthlete(ctx.ufc_slug, {}),
  'ufcstats-fighter-search': async (ctx) => searchFighter(ctx.name, {}),
  'ufcstats-event-page':     async () => null,
  'ufcstats-fight-page':     async () => null,
};

// Same normalization used by scripts/link-and-backfill-card-fighters.js:
// NFD-decompose → strip combining marks → lowercase → strip punctuation → collapse whitespace
function normalizeName(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

/**
 * After auto-linking a ufcstats_hash, immediately process all other fighters.*
 * spec entries for the same row using the profile page. This closes hash gap
 * and profile gaps in a single nightly pass rather than two.
 */
async function cascadeFighterProfile({ ctx, runId, fetchers, dryRun }) {
  let auto = 0, queued = 0, rejected = 0;
  const errors = [];

  const profileFetcher = fetchers['ufcstats-fighter-page'];
  if (!profileFetcher || !ctx.ufcstats_hash) return { auto, queued, rejected, errors };

  let srcResult;
  try {
    srcResult = await profileFetcher(ctx);
  } catch (e) {
    errors.push({ gap: { table: 'fighters', column: 'profile', row_id: String(ctx.id) }, error: String(e.message || e) });
    return { auto, queued, rejected, errors };
  }
  if (!srcResult) return { auto, queued, rejected, errors };

  for (const [specKey, specEntry] of Object.entries(spec)) {
    if (!specKey.startsWith('fighters.')) continue;
    if (specKey === 'fighters.ufcstats_hash') continue;
    if (specEntry.source !== 'ufcstats-fighter-page') continue;

    const column = specKey.split('.')[1];
    const current = ctx[column] != null ? ctx[column] : null;
    if (current !== null) continue; // gap-fill only

    const proposed = srcResult[column];
    if (proposed === undefined || proposed === null) continue;

    try {
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
        console.log(`[dry-run][cascade] fighters.${column} id=${ctx.id} → ${decision.decision} (${decision.reason})`);
        continue;
      }

      if (decision.decision === 'auto') {
        await applyAutoWrite({ table: 'fighters', rowId: ctx.id, column, current, proposed });
        await logDecision({ table: 'fighters', rowId: ctx.id, column, current, proposed,
          source: specEntry.source, sourceUrl: srcResult.source_url, decision: 'auto',
          reason: decision.reason, sourcesDiff: { sources }, runId, applied: true });
        auto++;
      } else if (decision.decision === 'review') {
        await logDecision({ table: 'fighters', rowId: ctx.id, column, current, proposed,
          source: specEntry.source, sourceUrl: srcResult.source_url, decision: 'review',
          reason: decision.reason, sourcesDiff: { sources }, runId, applied: false });
        queued++;
      } else if (decision.decision === 'reject') {
        await logDecision({ table: 'fighters', rowId: ctx.id, column, current, proposed,
          source: specEntry.source, sourceUrl: srcResult.source_url, decision: 'reject',
          reason: decision.reason, sourcesDiff: { sources }, runId, applied: false });
        rejected++;
      }
    } catch (e) {
      errors.push({ gap: { table: 'fighters', column, row_id: String(ctx.id) }, error: String(e.message || e) });
      console.error(`[backfill][cascade] fighters.${column} id=${ctx.id}: ${e.message}`);
    }
  }

  return { auto, queued, rejected, errors };
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

      // No identity link yet → the fighter-page URL would be /fighter-details/null.
      // Skip; the ufcstats_hash gap's auto-link cascade fills these same columns
      // in the same run once the hash resolves.
      if (specEntry.source === 'ufcstats-fighter-page' && !ctx.ufcstats_hash) continue;

      const srcResult = await fetchOnce(specEntry.source, ctx);
      if (!srcResult) continue;

      // identity-link: resolve proposed value and match quality from candidates
      let proposed = srcResult[gap.column];
      let identityLinkMatch = null;

      if (specEntry.safety === 'identity-link') {
        const candidates = srcResult.candidates || [];
        const target = normalizeName(ctx.name);
        const exact = candidates.filter(c => normalizeName(c.name) === target);
        if (exact.length === 1) {
          proposed = exact[0].hash;
          identityLinkMatch = 'exact-single';
        } else {
          identityLinkMatch = exact.length > 1 ? 'multiple-exact' : 'no-exact-match';
          // proposed stays undefined/null; gate returns 'review'
        }
      } else {
        if (proposed === undefined || proposed === null) continue;
      }

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
        identityLinkMatch,
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

        // Cascade: if we just linked a ufcstats_hash, immediately backfill
        // profile fields for this fighter so the nightly job closes both the
        // hash gap and the profile gaps in one pass.
        if (gap.column === 'ufcstats_hash' && gap.table === 'fighters') {
          const cascadeResult = await cascadeFighterProfile({
            ctx: { ...ctx, ufcstats_hash: proposed },
            runId,
            fetchers,
            dryRun,
          });
          auto += cascadeResult.auto;
          queued += cascadeResult.queued;
          rejected += cascadeResult.rejected;
          errors.push(...cascadeResult.errors);
        }
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
