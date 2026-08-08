'use strict';
/**
 * tests/integrity/runner.test.js
 *
 * Tests for data/integrity/runner.js + scanners.js.
 * Runs against the shared in-memory SQLite DB (already seeded by tests/run.js).
 */
const db = require('../../db');
const { runIntegrityScan, listIssues, getSummary, resolveOne, resolveBatch } = require('../../data/integrity/runner');
const allScanners = require('../../data/integrity/scanners');

let passed = 0, failed = 0;

function assert(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.error(`  ✗ ${name}`); }
}
function assertEq(a, e, name) { assert(a === e, `${name} (got ${JSON.stringify(a)}, expected ${JSON.stringify(e)})`); }
function assertGte(a, min, name) { assert(a >= min, `${name} (got ${a}, expected >= ${min})`); }

// ── helpers ──────────────────────────────────────────────────────────────────

function dbRun(sql, params = []) {
  db.run(sql, params);
}
function dbAll(sql, params = []) {
  return db.allRows(sql, params);
}
function dbOne(sql, params = []) {
  const rows = db.allRows(sql, params);
  return rows[0] || null;
}

// Clean up any test rows from data_integrity_issues by tag
function cleanIssues(category, subjectIdPrefix) {
  dbRun(`
    DELETE FROM data_integrity_issues
    WHERE category = ? AND subject_id LIKE ?
  `, [category, subjectIdPrefix + '%']);
}

// ─────────────────────────────────────────────────────────────────────────────

async function run() {
  console.log('\nIntegrity Runner:');

  // ── 1. Smoke test: runner executes without crashing ──────────────────────
  const smoke = await runIntegrityScan({ scanners: [] });
  assertEq(typeof smoke.run_id, 'string', 'runIntegrityScan returns string run_id');
  assertEq(smoke.opened, 0, 'empty scanner list: 0 opened');
  assertEq(smoke.resolved, 0, 'empty scanner list: 0 resolved');

  // ── 2. prob_sum_off: plant → scan → found ─────────────────────────────────
  const fightRow = dbOne('SELECT id FROM fights LIMIT 1');
  const probScanner = allScanners.find(s => s.category === 'prob_sum_off');

  // Insert a prediction with red+blue = 1.2 (clearly off)
  dbRun(`
    INSERT INTO predictions
      (fight_id, red_win_prob, blue_win_prob, model_version, predicted_at, enrichment_level)
    VALUES (?, 0.6, 0.6, 'test-prob-sum-off', '2026-05-10T00:00:00Z', 'lr')
  `, [fightRow.id]);
  const badPred = dbOne("SELECT id FROM predictions WHERE model_version = 'test-prob-sum-off' LIMIT 1");

  const r1 = await runIntegrityScan({ scanners: [probScanner] });
  assertGte(r1.opened, 1, 'prob_sum_off: bad prediction opens an issue');

  const openIssues = await listIssues({ status: 'open', category: 'prob_sum_off' });
  assert(
    openIssues.some(i => i.subject_id === String(badPred.id)),
    'prob_sum_off issue appears in listIssues(open)'
  );

  // ── 3. Auto-resolve: remove violation → re-scan → issue auto_resolved ─────
  dbRun('DELETE FROM predictions WHERE id = ?', [badPred.id]);
  const r2 = await runIntegrityScan({ scanners: [probScanner] });
  assertGte(r2.resolved, 1, 'prob_sum_off: issue auto_resolved after prediction removed');

  const resolvedIssues = await listIssues({ status: 'resolved', category: 'prob_sum_off' });
  assert(
    resolvedIssues.some(i => i.subject_id === String(badPred.id) && i.resolution === 'auto_resolved'),
    'auto_resolved row has resolution=auto_resolved'
  );

  // ── 4. Already-resolved row is NOT re-opened by subsequent scan ───────────
  // Re-insert the same bad prediction with the same id
  dbRun(`
    INSERT OR REPLACE INTO predictions
      (id, fight_id, red_win_prob, blue_win_prob, model_version, predicted_at, enrichment_level)
    VALUES (?, ?, 0.6, 0.6, 'test-prob-sum-off', '2026-05-10T00:00:00Z', 'lr')
  `, [badPred.id, fightRow.id]);

  const r3 = await runIntegrityScan({ scanners: [probScanner] });
  // The resolved row should NOT be reopened — opened count should NOT include this subject_id
  const afterRescan = await listIssues({ status: 'resolved', category: 'prob_sum_off' });
  assert(
    afterRescan.some(i => i.subject_id === String(badPred.id) && i.resolved_at !== null),
    'resolved row stays resolved after re-scan with same violation'
  );
  const openAfter = await listIssues({ status: 'open', category: 'prob_sum_off' });
  assert(
    !openAfter.some(i => i.subject_id === String(badPred.id)),
    'resolved row does not reappear as open'
  );

  // Clean up prob_sum_off test data
  dbRun("DELETE FROM predictions WHERE model_version = 'test-prob-sum-off'");
  dbRun(`DELETE FROM data_integrity_issues WHERE category = 'prob_sum_off' AND subject_id = ?`, [String(badPred.id)]);

  // ── 5. missing_hash scanner: plant → scan → found ─────────────────────────
  const missingHashScanner = allScanners.find(s => s.category === 'missing_hash');
  // Find a fighter on a future event (or any event) who has a hash; null it out temporarily
  const futureEventRow = dbOne(`SELECT e.id FROM events e WHERE e.date >= date('now') LIMIT 1`);
  if (futureEventRow) {
    const fightInFuture = dbOne(`SELECT * FROM fights WHERE event_id = ?`, [futureEventRow.id]);
    if (fightInFuture) {
      const fighterId = fightInFuture.red_fighter_id;
      const originalHash = dbOne('SELECT ufcstats_hash FROM fighters WHERE id = ?', [fighterId]);
      dbRun('UPDATE fighters SET ufcstats_hash = NULL WHERE id = ?', [fighterId]);

      const rHash = await runIntegrityScan({ scanners: [missingHashScanner] });
      assert(rHash.opened >= 0, 'missing_hash scanner ran without error');

      const hashIssues = await listIssues({ status: 'open', category: 'missing_hash' });
      assert(
        hashIssues.some(i => i.subject_id === String(fighterId)),
        'missing_hash issue found for fighter with null hash on upcoming event'
      );

      // Restore hash
      dbRun('UPDATE fighters SET ufcstats_hash = ? WHERE id = ?', [originalHash && originalHash.ufcstats_hash || null, fighterId]);
      // Re-scan to auto-resolve
      await runIntegrityScan({ scanners: [missingHashScanner] });
    }
  }

  // ── 6. getSummary returns grouped rows ────────────────────────────────────
  const summary = await getSummary();
  assert(Array.isArray(summary), 'getSummary returns array');

  // ── 7. resolveOne: manual resolution ─────────────────────────────────────
  const now = new Date().toISOString();
  dbRun(`
    INSERT OR IGNORE INTO data_integrity_issues
      (category, severity, subject_type, subject_id, details, first_seen_at, last_seen_at)
    VALUES ('prob_sum_off', 'block', 'prediction', 'test-resolve-one-999', '{}', ?, ?)
  `, [now, now]);
  const insertedRow = dbOne(
    `SELECT id FROM data_integrity_issues WHERE subject_id = 'test-resolve-one-999'`
  );

  const resolveResult = await resolveOne(insertedRow.id, { resolution: 'fixed', note: 'manual test' });
  assertEq(resolveResult.resolved, 1, 'resolveOne returns { resolved: 1 }');

  const afterResolve = dbOne(
    `SELECT resolution, resolution_note FROM data_integrity_issues WHERE id = ?`,
    [insertedRow.id]
  );
  assertEq(afterResolve.resolution, 'fixed', 'resolveOne sets resolution=fixed');
  assertEq(afterResolve.resolution_note, 'manual test', 'resolveOne sets resolution_note');

  // resolveOne on already-resolved row throws
  let threw = false;
  try { await resolveOne(insertedRow.id, { resolution: 'fixed' }); }
  catch (e) { threw = e.status === 404; }
  assert(threw, 'resolveOne on resolved row throws 404');

  dbRun(`DELETE FROM data_integrity_issues WHERE subject_id = 'test-resolve-one-999'`);

  // ── 8. resolveBatch: 5 rows, batch resolve ────────────────────────────────
  for (let i = 1; i <= 5; i++) {
    dbRun(`
      INSERT OR IGNORE INTO data_integrity_issues
        (category, severity, subject_type, subject_id, details, first_seen_at, last_seen_at)
      VALUES ('prob_sum_off', 'block', 'prediction', ?, '{}', ?, ?)
    `, [`test-batch-${i}`, now, now]);
  }

  const batchResult = await resolveBatch({
    category: 'prob_sum_off',
    subject_ids: ['test-batch-1', 'test-batch-2', 'test-batch-3', 'test-batch-4', 'test-batch-5'],
    resolution: 'wont_fix',
    note: 'batch test',
  });
  assertEq(batchResult.resolved, 5, 'resolveBatch resolves exactly 5 rows');

  const batchRows = dbAll(
    `SELECT resolution FROM data_integrity_issues WHERE subject_id LIKE 'test-batch-%'`
  );
  assert(
    batchRows.length === 5 && batchRows.every(r => r.resolution === 'wont_fix'),
    'resolveBatch: all 5 rows have resolution=wont_fix'
  );

  // Second call to same batch returns resolved=0 (already resolved)
  const batchResult2 = await resolveBatch({
    category: 'prob_sum_off',
    subject_ids: ['test-batch-1', 'test-batch-2'],
    resolution: 'fixed',
  });
  assertEq(batchResult2.resolved, 0, 'resolveBatch on already-resolved rows returns 0');

  dbRun(`DELETE FROM data_integrity_issues WHERE subject_id LIKE 'test-batch-%'`);

  // ── 9. listIssues: status filter works ───────────────────────────────────
  dbRun(`
    INSERT OR IGNORE INTO data_integrity_issues
      (category, severity, subject_type, subject_id, details, first_seen_at, last_seen_at)
    VALUES ('prob_sum_off', 'block', 'prediction', 'test-list-filter', '{}', ?, ?)
  `, [now, now]);
  const openList = await listIssues({ status: 'open', category: 'prob_sum_off' });
  assert(openList.some(i => i.subject_id === 'test-list-filter'), 'listIssues(open) includes open row');
  const resolvedList = await listIssues({ status: 'resolved', category: 'prob_sum_off' });
  assert(!resolvedList.some(i => i.subject_id === 'test-list-filter'), 'listIssues(resolved) excludes open row');
  dbRun(`DELETE FROM data_integrity_issues WHERE subject_id = 'test-list-filter'`);

  return { passed, failed };
}

module.exports = { run };
