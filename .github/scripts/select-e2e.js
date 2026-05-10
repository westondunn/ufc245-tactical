#!/usr/bin/env node
/**
 * .github/scripts/select-e2e.js
 *
 * Path-based Playwright suite selector. Reads a list of changed file
 * paths from stdin (one per line) and emits the set of spec files to
 * run, plus a small JSON summary on stderr. Pure: no GitHub API calls,
 * no git invocations — the calling workflow is responsible for
 * computing the diff range and feeding paths in.
 *
 * Output formats (controlled by --format):
 *   --format=specs    (default)  one spec path per line on stdout
 *   --format=args     stdout = single space-separated arg string ready
 *                     to splice into `npx playwright test ${args}`;
 *                     empty when nothing should run.
 *   --format=json     full {specs, all, skip, reason, scopes} JSON
 *
 * Escape hatches consumed via env vars (set by the workflow from the
 * commit message):
 *   SELECT_FORCE_FULL=1   →  always run all suites
 *   SELECT_FORCE_SKIP=1   →  always skip all suites
 *
 * No external deps; runs on stock Node 18+.
 */
'use strict';

const ALL_SPECS = [
  'tests/e2e/admin.spec.js',
  'tests/e2e/api.spec.js',
  'tests/e2e/dashboard.spec.js',
  'tests/e2e/picks.spec.js',
];

// Each rule maps a path predicate → set of suite "tags".
// First matching rule wins for that path; a path can contribute to
// multiple suites via the union of all matched rules across files.
// Ordering matters: more specific rules earlier.
const RULES = [
  // Direct edits to a spec file → run that spec.
  { test: p => p === 'tests/e2e/admin.spec.js',     suites: ['admin'] },
  { test: p => p === 'tests/e2e/api.spec.js',       suites: ['api'] },
  { test: p => p === 'tests/e2e/dashboard.spec.js', suites: ['dashboard'] },
  { test: p => p === 'tests/e2e/picks.spec.js',     suites: ['picks'] },

  // Anything else under tests/ (helpers, fixtures, runner) → all e2e
  // (cheap signal; rare).
  { test: p => p.startsWith('tests/'), suites: ['all'] },

  // Force-full triggers — touching infra needs the full gate.
  { test: p => p === 'package.json' || p === 'package-lock.json', suites: ['all'] },
  { test: p => p === 'playwright.config.js',                       suites: ['all'] },
  { test: p => p.startsWith('.github/workflows/'),                 suites: ['all'] },
  { test: p => p.startsWith('.github/scripts/'),                   suites: ['all'] },

  // Skippable docs / scratch / data-pipeline-only changes.
  { test: p => /^(README|CONTRIBUTING|LICENSE|CHANGELOG|AGENTS|CLAUDE|INTEGRATION)\.md$/i.test(p), suites: [] },
  { test: p => /\.md$/i.test(p) && p.startsWith('docs/'),         suites: [] },
  { test: p => p.startsWith('tmp/'),                               suites: [] },
  { test: p => p === '.gitignore',                                 suites: [] },
  // Python prediction service is gated by python tests in the quality
  // job; no e2e spec exercises it directly.
  { test: p => p.startsWith('ufc245-predictions/'),                suites: [] },
  { test: p => p.startsWith('llm-pipeline/'),                      suites: [] },
  // Data scrapers / scripts run from cron / one-offs; covered by
  // node tests/run.js, no e2e coverage today.
  { test: p => p.startsWith('data/scrapers/'),                     suites: [] },
  { test: p => p.startsWith('data/audit/'),                        suites: [] },
  { test: p => p.startsWith('scripts/'),                           suites: [] },

  // Backend — server.js, db, lib, auth — exercise everything.
  { test: p => p === 'server.js',          suites: ['all'] },
  { test: p => p.startsWith('db/'),        suites: ['all'] },
  { test: p => p.startsWith('lib/'),       suites: ['all'] },
  { test: p => p.startsWith('auth/'),      suites: ['admin', 'picks'] },

  // Seed + admin data — api + admin tests touch these.
  { test: p => p === 'data/seed.json',     suites: ['api', 'admin'] },
  { test: p => p.startsWith('data/admin/'),suites: ['api', 'admin'] },
  // Other data/* paths default to dashboard (rendered) coverage.
  { test: p => p.startsWith('data/'),      suites: ['dashboard'] },

  // Frontend
  { test: p => p === 'public/index.html',  suites: ['dashboard', 'picks'] },
  { test: p => p.startsWith('public/css/'),                  suites: ['dashboard'] },
  { test: p => p.startsWith('public/img/') || p.startsWith('public/icons/'), suites: ['dashboard'] },
  { test: p => p === 'public/js/auth.js',  suites: ['admin', 'picks'] },
  { test: p => p.startsWith('public/js/'), suites: ['dashboard', 'picks'] },
  { test: p => p.startsWith('public/'),    suites: ['dashboard'] },
];

const SUITE_TO_SPEC = {
  admin: 'tests/e2e/admin.spec.js',
  api: 'tests/e2e/api.spec.js',
  dashboard: 'tests/e2e/dashboard.spec.js',
  picks: 'tests/e2e/picks.spec.js',
};

function suitesFor(path) {
  for (const r of RULES) {
    if (r.test(path)) return r.suites;
  }
  // Unmapped paths → conservative default: full suite.
  return ['all'];
}

function specsFromSuites(suiteSet) {
  if (suiteSet.has('all')) return ALL_SPECS.slice();
  const out = [];
  for (const s of ['admin', 'api', 'dashboard', 'picks']) {
    if (suiteSet.has(s)) out.push(SUITE_TO_SPEC[s]);
  }
  return out;
}

function compute(paths) {
  const forceFull = process.env.SELECT_FORCE_FULL === '1';
  const forceSkip = process.env.SELECT_FORCE_SKIP === '1';

  if (forceSkip) {
    return { specs: [], skip: true, all: false, reason: 'force_skip', scopes: {} };
  }
  if (forceFull) {
    return { specs: ALL_SPECS.slice(), skip: false, all: true, reason: 'force_full', scopes: {} };
  }
  if (!paths.length) {
    // No diff info → conservative default = full suite.
    return { specs: ALL_SPECS.slice(), skip: false, all: true, reason: 'no_diff_info', scopes: {} };
  }

  const suiteSet = new Set();
  const scopes = {};
  for (const p of paths) {
    const matched = suitesFor(p);
    scopes[p] = matched;
    for (const s of matched) suiteSet.add(s);
  }
  const specs = specsFromSuites(suiteSet);
  if (specs.length === 0) {
    return { specs: [], skip: true, all: false, reason: 'no_e2e_relevant_paths', scopes };
  }
  if (specs.length === ALL_SPECS.length) {
    return { specs, skip: false, all: true, reason: 'union_covers_all', scopes };
  }
  return { specs, skip: false, all: false, reason: 'partial', scopes };
}

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { buf += chunk; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
    // If stdin is a TTY (no piped data), resolve empty after a tick.
    if (process.stdin.isTTY) setImmediate(() => resolve(''));
  });
}

async function main() {
  const args = process.argv.slice(2);
  let format = 'specs';
  for (const a of args) {
    if (a.startsWith('--format=')) format = a.slice('--format='.length);
  }

  const raw = await readStdin();
  const paths = raw.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const result = compute(paths);

  // Always log the summary on stderr so the workflow's log shows what
  // was matched. Stdout is reserved for the consumer (workflow).
  const summary = {
    reason: result.reason,
    skip: result.skip,
    all: result.all,
    paths: paths.length,
    specs: result.specs,
  };
  process.stderr.write(JSON.stringify(summary, null, 2) + '\n');

  if (format === 'json') {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else if (format === 'args') {
    process.stdout.write((result.specs || []).join(' '));
    if (result.specs.length) process.stdout.write('\n');
  } else {
    // 'specs' — newline-separated paths
    if (result.specs.length) process.stdout.write(result.specs.join('\n') + '\n');
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(2); });
}

module.exports = { compute, suitesFor, ALL_SPECS, SUITE_TO_SPEC };
