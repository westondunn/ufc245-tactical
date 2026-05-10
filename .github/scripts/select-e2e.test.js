#!/usr/bin/env node
/**
 * Lightweight unit test for select-e2e.js. Runs as part of the quality
 * job so a regression in the routing table never silently shrinks the
 * gate.
 *
 * Plain assertions, no test framework — the same style as
 * tests/run.js's runner.
 */
'use strict';
const assert = require('node:assert/strict');
const { compute, ALL_SPECS } = require('./select-e2e');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}\n     ${e.message}`);
    failed++;
  }
}

console.log('select-e2e.js routing table');

t('empty input → full suite (no_diff_info)', () => {
  const r = compute([]);
  assert.equal(r.reason, 'no_diff_info');
  assert.equal(r.all, true);
  assert.deepEqual(r.specs.sort(), ALL_SPECS.slice().sort());
});

t('docs-only → skip', () => {
  const r = compute(['README.md', 'docs/architecture.md']);
  assert.equal(r.skip, true);
  assert.deepEqual(r.specs, []);
});

t('tmp/ scratch files only → skip', () => {
  const r = compute(['tmp/foo.json', 'tmp/bar.js']);
  assert.equal(r.skip, true);
});

t('public/css only → dashboard', () => {
  const r = compute(['public/css/styles.css']);
  assert.equal(r.all, false);
  assert.deepEqual(r.specs, ['tests/e2e/dashboard.spec.js']);
});

t('public/index.html only → dashboard + picks', () => {
  const r = compute(['public/index.html']);
  assert.deepEqual(r.specs.sort(),
    ['tests/e2e/dashboard.spec.js', 'tests/e2e/picks.spec.js']);
});

t('public/js/app.js → dashboard + picks', () => {
  const r = compute(['public/js/app.js']);
  assert.deepEqual(r.specs.sort(),
    ['tests/e2e/dashboard.spec.js', 'tests/e2e/picks.spec.js']);
});

t('public/js/auth.js → admin + picks', () => {
  const r = compute(['public/js/auth.js']);
  assert.deepEqual(r.specs.sort(),
    ['tests/e2e/admin.spec.js', 'tests/e2e/picks.spec.js']);
});

t('server.js → all', () => {
  const r = compute(['server.js']);
  assert.equal(r.all, true);
});

t('db/postgres.js → all', () => {
  const r = compute(['db/postgres.js']);
  assert.equal(r.all, true);
});

t('lib/livePoll.js → all', () => {
  const r = compute(['lib/livePoll.js']);
  assert.equal(r.all, true);
});

t('auth/index.js → admin + picks', () => {
  const r = compute(['auth/index.js']);
  assert.deepEqual(r.specs.sort(),
    ['tests/e2e/admin.spec.js', 'tests/e2e/picks.spec.js']);
});

t('seed.json → api + admin', () => {
  const r = compute(['data/seed.json']);
  assert.deepEqual(r.specs.sort(),
    ['tests/e2e/admin.spec.js', 'tests/e2e/api.spec.js']);
});

t('data/scrapers/* → skip', () => {
  const r = compute(['data/scrapers/espn-mma.js']);
  assert.equal(r.skip, true);
});

t('scripts/* → skip', () => {
  const r = compute(['scripts/realign-event-103-positions.js']);
  assert.equal(r.skip, true);
});

t('ufc245-predictions/** → skip', () => {
  const r = compute(['ufc245-predictions/jobs/__init__.py']);
  assert.equal(r.skip, true);
});

t('llm-pipeline/** → skip', () => {
  const r = compute(['llm-pipeline/pipeline/orchestrator.py']);
  assert.equal(r.skip, true);
});

t('package.json → all (force-full)', () => {
  const r = compute(['package.json']);
  assert.equal(r.all, true);
});

t('package-lock.json → all', () => {
  const r = compute(['package-lock.json']);
  assert.equal(r.all, true);
});

t('playwright.config.js → all', () => {
  const r = compute(['playwright.config.js']);
  assert.equal(r.all, true);
});

t('.github/workflows/* → all', () => {
  const r = compute(['.github/workflows/ci.yml']);
  assert.equal(r.all, true);
});

t('selector script edits → all (self-test)', () => {
  const r = compute(['.github/scripts/select-e2e.js']);
  assert.equal(r.all, true);
});

t('mixed: css + scripts → dashboard only (scripts is skip)', () => {
  const r = compute(['public/css/styles.css', 'scripts/foo.js']);
  assert.deepEqual(r.specs, ['tests/e2e/dashboard.spec.js']);
});

t('mixed: server + css → all', () => {
  const r = compute(['server.js', 'public/css/styles.css']);
  assert.equal(r.all, true);
});

t('unmapped path → all (conservative)', () => {
  const r = compute(['some/random/new/file.txt']);
  assert.equal(r.all, true);
  assert.equal(r.reason, 'union_covers_all');
});

t('SELECT_FORCE_FULL env → all regardless of paths', () => {
  process.env.SELECT_FORCE_FULL = '1';
  try {
    const r = compute(['README.md']);
    assert.equal(r.all, true);
    assert.equal(r.reason, 'force_full');
  } finally { delete process.env.SELECT_FORCE_FULL; }
});

t('SELECT_FORCE_SKIP env → skip regardless of paths', () => {
  process.env.SELECT_FORCE_SKIP = '1';
  try {
    const r = compute(['server.js']);
    assert.equal(r.skip, true);
    assert.equal(r.reason, 'force_skip');
  } finally { delete process.env.SELECT_FORCE_SKIP; }
});

t('direct edit to picks.spec.js → only picks', () => {
  const r = compute(['tests/e2e/picks.spec.js']);
  assert.deepEqual(r.specs, ['tests/e2e/picks.spec.js']);
});

t('direct edit to api.spec.js + dashboard.spec.js → those two only', () => {
  const r = compute(['tests/e2e/api.spec.js', 'tests/e2e/dashboard.spec.js']);
  assert.deepEqual(r.specs.sort(),
    ['tests/e2e/api.spec.js', 'tests/e2e/dashboard.spec.js']);
});

t('tests/e2e/<other-file>.js → all (helpers default)', () => {
  const r = compute(['tests/e2e/helpers/login.js']);
  assert.equal(r.all, true);
});

if (failed === 0) {
  console.log(`\n  ━━━ ${passed} passed, 0 failed ━━━`);
} else {
  console.log(`\n  ━━━ ${passed} passed, ${failed} failed ━━━`);
  process.exit(1);
}
