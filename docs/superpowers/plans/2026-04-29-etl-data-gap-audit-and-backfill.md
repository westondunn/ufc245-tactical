# ETL Data Gap Audit and Automated Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship per-table coverage auditing with history, and a confidence-gated backfill executor that auto-fills safe gaps and queues risky ones for one-click CLI review.

**Architecture:** Three new modules in the Node main app — `data/audit/` (read-only SQL coverage with history), `data/backfill/` (gated dispatcher reusing existing scrapers as libraries), and a `node-cron` scheduler. Three new tables: `coverage_snapshots`, `audit_runs`, `pending_backfill`. Existing JS scrapers get parsing extracted into `data/scrapers/*` library modules; the existing CLIs become thin wrappers. The python `llm-pipeline` is unchanged.

**Tech Stack:** Node.js 22+, Express 5, `pg` (Postgres) / `sql.js` (SQLite mirror), `cheerio`, `node-cron` (new dep), in-house `tests/run.js` test runner.

**Spec:** `docs/superpowers/specs/2026-04-29-etl-data-gap-audit-and-backfill-design.md`

---

## Phase 0 — Conventions

- All new test files attach themselves to `tests/run.js` via `require()` from the runner (mirroring the existing structure). Use the same `assert/assertEq/assertGt/assertTruthy` helpers; no jest/mocha.
- Sqlite tests use `:memory:` via the existing `db/sqlite.js` initialization, with `DATABASE_URL` unset so `db/index.js` picks SQLite.
- Postgres-specific schema features (JSONB, partial indexes, BIGSERIAL) need SQLite equivalents (TEXT, regular indexes, INTEGER PRIMARY KEY AUTOINCREMENT). Mirror the schema in both files; test against SQLite for fast unit tests, integration tests live behind a `PG_TEST_URL` env guard.
- Every task ends with a single commit. Commit messages follow the existing convention (`feat(audit): ...`, `feat(backfill): ...`, `refactor(scrapers): ...`).

---

## Phase 1 — Schema

### Task 1: Add audit/backfill tables to Postgres schema

**Files:**
- Modify: `db/postgres.js` (extend `ensureSchema()`)
- Modify: `db/sqlite.js` (mirror)
- Create: `tests/audit/schema.test.js`
- Modify: `tests/run.js` (require new test file)

- [ ] **Step 1: Write failing schema test**

Create `tests/audit/schema.test.js`:

```js
const db = require('../../db');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nAudit/Backfill Schema:');

  await db.init();

  // coverage_snapshots
  const cs = await db.allRows(`SELECT * FROM coverage_snapshots LIMIT 1`).catch(e => ({ error: e.message }));
  assert(!cs.error, 'coverage_snapshots table exists');

  // audit_runs
  const ar = await db.allRows(`SELECT * FROM audit_runs LIMIT 1`).catch(e => ({ error: e.message }));
  assert(!ar.error, 'audit_runs table exists');

  // pending_backfill
  const pb = await db.allRows(`SELECT * FROM pending_backfill LIMIT 1`).catch(e => ({ error: e.message }));
  assert(!pb.error, 'pending_backfill table exists');

  // Insert + select round-trip on coverage_snapshots
  await db.run(`
    INSERT INTO coverage_snapshots (run_id, ran_at, table_name, column_name, scope, total_rows, non_null_rows, coverage_pct, gap_row_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, ['test-run-1', new Date().toISOString(), 'fighters', 'reach_cm', 'all', 100, 80, 0.8, JSON.stringify([1, 2, 3])]);

  const rows = await db.allRows(`SELECT * FROM coverage_snapshots WHERE run_id = ?`, ['test-run-1']);
  assert(rows.length === 1, 'coverage_snapshots row inserted');
  assert(rows[0].coverage_pct === 0.8 || rows[0].coverage_pct === '0.8', 'coverage_pct round-trips');

  // Insert + select on audit_runs
  await db.run(`
    INSERT INTO audit_runs (run_id, started_at, status, trigger_source)
    VALUES (?, ?, ?, ?)
  `, ['test-run-1', new Date().toISOString(), 'complete', 'cli']);
  const arRows = await db.allRows(`SELECT * FROM audit_runs WHERE run_id = ?`, ['test-run-1']);
  assert(arRows.length === 1, 'audit_runs row inserted');

  // Insert on pending_backfill, then test partial unique index conflict
  const now = new Date().toISOString();
  await db.run(`
    INSERT INTO pending_backfill
      (table_name, row_id, column_name, current_value, proposed_value, source, confidence, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, ['fighters', '42', 'reach_cm', null, '180', 'ufcstats-fighter-page', 'auto', 'pending', now]);

  let secondInsertFailed = false;
  try {
    await db.run(`
      INSERT INTO pending_backfill
        (table_name, row_id, column_name, current_value, proposed_value, source, confidence, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, ['fighters', '42', 'reach_cm', null, '180', 'ufcstats-fighter-page', 'auto', 'pending', now]);
  } catch (e) {
    secondInsertFailed = true;
  }
  assert(secondInsertFailed, 'unique partial index blocks duplicate pending row');

  // After cleanup test data
  await db.run(`DELETE FROM coverage_snapshots WHERE run_id = ?`, ['test-run-1']);
  await db.run(`DELETE FROM audit_runs WHERE run_id = ?`, ['test-run-1']);
  await db.run(`DELETE FROM pending_backfill WHERE table_name = ? AND row_id = ? AND column_name = ?`,
    ['fighters', '42', 'reach_cm']);

  return results;
}

module.exports = { run };
```

- [ ] **Step 2: Wire test into runner**

In `tests/run.js`, add at the bottom of `run()` before the final summary:

```js
console.log('\nAudit Schema (extension):');
const auditSchemaSuite = require('./audit/schema');
const auditSchemaResult = await auditSchemaSuite.run();
passed += auditSchemaResult.passed;
failed += auditSchemaResult.failed;
```

- [ ] **Step 3: Run tests, expect failure**

Run: `npm test`
Expected: failure on "coverage_snapshots table exists" (table not created yet).

- [ ] **Step 4: Add tables to Postgres schema**

In `db/postgres.js`, inside `ensureSchema()` after the existing `pick_model_snapshots` index block (around line 311), append:

```js
  // ── Data audit + backfill (additive) ──
  await run(`
    CREATE TABLE IF NOT EXISTS coverage_snapshots (
      id BIGSERIAL PRIMARY KEY,
      run_id TEXT NOT NULL,
      ran_at TIMESTAMPTZ NOT NULL,
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      scope TEXT NOT NULL,
      total_rows INTEGER NOT NULL,
      non_null_rows INTEGER NOT NULL,
      coverage_pct DOUBLE PRECISION NOT NULL,
      gap_row_ids JSONB
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_coverage_run ON coverage_snapshots(run_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_coverage_table_col ON coverage_snapshots(table_name, column_name, ran_at DESC)');

  await run(`
    CREATE TABLE IF NOT EXISTS audit_runs (
      run_id TEXT PRIMARY KEY,
      started_at TIMESTAMPTZ NOT NULL,
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'running',
      trigger_source TEXT NOT NULL,
      scope_input JSONB,
      summary JSONB,
      error_text TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pending_backfill (
      id BIGSERIAL PRIMARY KEY,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      column_name TEXT NOT NULL,
      current_value TEXT,
      proposed_value TEXT NOT NULL,
      source TEXT NOT NULL,
      source_url TEXT,
      confidence TEXT NOT NULL,
      reason TEXT,
      source_diff_json JSONB,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL,
      resolved_at TIMESTAMPTZ,
      applied_at TIMESTAMPTZ,
      audit_run_id TEXT
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_backfill(status)');
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_open
    ON pending_backfill(table_name, row_id, column_name)
    WHERE status IN ('pending', 'approved')
  `);
```

- [ ] **Step 5: Mirror in SQLite**

In `db/sqlite.js`, find `ensureSchema()` (or equivalent function — same pattern as postgres). After the last existing CREATE TABLE block, append:

```js
  await run(`
    CREATE TABLE IF NOT EXISTS coverage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      ran_at TEXT NOT NULL,
      table_name TEXT NOT NULL,
      column_name TEXT NOT NULL,
      scope TEXT NOT NULL,
      total_rows INTEGER NOT NULL,
      non_null_rows INTEGER NOT NULL,
      coverage_pct REAL NOT NULL,
      gap_row_ids TEXT
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_coverage_run ON coverage_snapshots(run_id)');
  await run('CREATE INDEX IF NOT EXISTS idx_coverage_table_col ON coverage_snapshots(table_name, column_name, ran_at DESC)');

  await run(`
    CREATE TABLE IF NOT EXISTS audit_runs (
      run_id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      trigger_source TEXT NOT NULL,
      scope_input TEXT,
      summary TEXT,
      error_text TEXT
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS pending_backfill (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      row_id TEXT NOT NULL,
      column_name TEXT NOT NULL,
      current_value TEXT,
      proposed_value TEXT NOT NULL,
      source TEXT NOT NULL,
      source_url TEXT,
      confidence TEXT NOT NULL,
      reason TEXT,
      source_diff_json TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      applied_at TEXT,
      audit_run_id TEXT
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_backfill(status)');
  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_open
    ON pending_backfill(table_name, row_id, column_name)
    WHERE status IN ('pending', 'approved')
  `);
```

(SQLite supports partial unique indexes since 3.8.0; sql.js bundles 3.x — verify with the test in step 6.)

- [ ] **Step 6: Run tests, expect pass**

Run: `npm test`
Expected: PASS on all four assertions.

If "unique partial index blocks duplicate pending row" fails on SQLite, the sql.js version may not support `WHERE` clause in indexes. Workaround: replace the partial index with a trigger-based check in `db/sqlite.js`:

```js
  await run(`
    CREATE TRIGGER IF NOT EXISTS trg_pending_open_unique
    BEFORE INSERT ON pending_backfill
    WHEN NEW.status IN ('pending','approved')
    BEGIN
      SELECT RAISE(ABORT, 'duplicate open pending_backfill row')
      WHERE EXISTS (
        SELECT 1 FROM pending_backfill
        WHERE table_name = NEW.table_name
          AND row_id = NEW.row_id
          AND column_name = NEW.column_name
          AND status IN ('pending','approved')
      );
    END
  `);
```

Re-run tests.

- [ ] **Step 7: Commit**

```bash
git add db/postgres.js db/sqlite.js tests/audit/schema.test.js tests/run.js
git commit -m "feat(schema): add coverage_snapshots, audit_runs, pending_backfill tables"
```

---

## Phase 2 — Audit Subsystem

### Task 2: Coverage spec + scopes

**Files:**
- Create: `data/audit/coverage-spec.js`
- Create: `data/audit/scopes.js`
- Create: `tests/audit/scopes.test.js`

- [ ] **Step 1: Write failing scopes test**

Create `tests/audit/scopes.test.js`:

```js
const db = require('../../db');
const { resolveScope } = require('../../data/audit/scopes');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nAudit Scopes:');

  await db.init();

  // Insert fixture: 2 events (one upcoming, one completed), 2 fights, 4 fighters
  const today = new Date();
  const past = new Date(today.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const future = new Date(today.getTime() + 30 * 86400000).toISOString().slice(0, 10);

  await db.run(`INSERT OR REPLACE INTO events (id, name, date) VALUES (?, ?, ?)`, [9001, 'TestEventPast', past]);
  await db.run(`INSERT OR REPLACE INTO events (id, name, date) VALUES (?, ?, ?)`, [9002, 'TestEventFuture', future]);
  for (const fid of [9101, 9102, 9103, 9104]) {
    await db.run(`INSERT OR REPLACE INTO fighters (id, name) VALUES (?, ?)`, [fid, `TestFighter${fid}`]);
  }
  await db.run(`INSERT OR REPLACE INTO fights (id, event_id, red_fighter_id, blue_fighter_id) VALUES (?, ?, ?, ?)`,
    [9201, 9001, 9101, 9102]);
  await db.run(`INSERT OR REPLACE INTO fights (id, event_id, red_fighter_id, blue_fighter_id) VALUES (?, ?, ?, ?)`,
    [9202, 9002, 9103, 9104]);

  // Test scope resolution returns SQL fragments that compile
  const tests = [
    { table: 'fighters', scope: 'all',              expectMatching: id => id >= 9101 && id <= 9104 },
    { table: 'fighters', scope: 'upcoming-roster',  expectMatching: id => id === 9103 || id === 9104 },
    { table: 'events',   scope: 'all',              expectMatching: id => id === 9001 || id === 9002 },
    { table: 'events',   scope: 'upcoming',         expectMatching: id => id === 9002 },
    { table: 'events',   scope: 'completed',        expectMatching: id => id === 9001 },
    { table: 'fights',   scope: 'completed',        expectMatching: id => id === 9201 },
    { table: 'fights',   scope: 'upcoming-fights',  expectMatching: id => id === 9202 },
  ];

  for (const t of tests) {
    const { joinSql, idColumn } = resolveScope(t.table, t.scope);
    const sql = `SELECT DISTINCT ${idColumn} AS id FROM ${joinSql}`;
    const rows = await db.allRows(sql);
    const ids = rows.map(r => r.id).filter(t.expectMatching);
    assert(ids.length > 0, `${t.table}/${t.scope} returns expected rows`);
  }

  // Test event:<id> scope
  const { joinSql, idColumn } = resolveScope('fighters', 'event:9002');
  const rows = await db.allRows(`SELECT DISTINCT ${idColumn} AS id FROM ${joinSql}`);
  const ids = rows.map(r => r.id).sort();
  assert(JSON.stringify(ids) === JSON.stringify([9103, 9104]), 'event:<id> scope filters to that event');

  // Cleanup
  await db.run(`DELETE FROM fights WHERE id IN (9201, 9202)`);
  await db.run(`DELETE FROM fighters WHERE id IN (9101, 9102, 9103, 9104)`);
  await db.run(`DELETE FROM events WHERE id IN (9001, 9002)`);

  return results;
}

module.exports = { run };
```

Wire into `tests/run.js` (same pattern as Task 1).

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: failure (`data/audit/scopes` not found).

- [ ] **Step 3: Implement scopes module**

Create `data/audit/scopes.js`:

```js
/**
 * data/audit/scopes.js
 *
 * Each scope is a SQL fragment for the FROM clause that filters the target
 * table to the rows we want to audit. Returns { joinSql, idColumn } so the
 * runner can build:
 *
 *   SELECT count(*) FILTER (WHERE col IS NOT NULL) FROM <joinSql>
 *
 * (or a non-FILTER variant for sqlite). idColumn is what to SELECT for the
 * gap_row_ids sample.
 */

const SCOPES = {
  fighters: {
    'all': () => ({ joinSql: 'fighters', idColumn: 'fighters.id' }),
    'upcoming-roster': () => ({
      joinSql: `fighters
        JOIN fights ON (fighters.id = fights.red_fighter_id OR fighters.id = fights.blue_fighter_id)
        JOIN events ON events.id = fights.event_id
        WHERE events.date >= date('now')`,
      idColumn: 'fighters.id',
    }),
    'event': (eventId) => ({
      joinSql: `fighters
        JOIN fights ON (fighters.id = fights.red_fighter_id OR fighters.id = fights.blue_fighter_id)
        WHERE fights.event_id = ${eventId}`,
      idColumn: 'fighters.id',
    }),
  },
  events: {
    'all': () => ({ joinSql: 'events', idColumn: 'events.id' }),
    'upcoming': () => ({ joinSql: `events WHERE events.date >= date('now')`, idColumn: 'events.id' }),
    'completed': () => ({ joinSql: `events WHERE events.date < date('now')`, idColumn: 'events.id' }),
    'event': (eventId) => ({ joinSql: `events WHERE events.id = ${eventId}`, idColumn: 'events.id' }),
  },
  fights: {
    'all': () => ({ joinSql: 'fights', idColumn: 'fights.id' }),
    'completed': () => ({
      joinSql: `fights JOIN events ON events.id = fights.event_id WHERE events.date < date('now')`,
      idColumn: 'fights.id',
    }),
    'completed-fights': () => ({
      joinSql: `fights JOIN events ON events.id = fights.event_id WHERE events.date < date('now')`,
      idColumn: 'fights.id',
    }),
    'upcoming-fights': () => ({
      joinSql: `fights JOIN events ON events.id = fights.event_id WHERE events.date >= date('now')`,
      idColumn: 'fights.id',
    }),
    'event': (eventId) => ({ joinSql: `fights WHERE fights.event_id = ${eventId}`, idColumn: 'fights.id' }),
  },
  fight_stats: {
    'completed-fights': () => ({
      joinSql: `fight_stats
        JOIN fights ON fights.id = fight_stats.fight_id
        JOIN events ON events.id = fights.event_id
        WHERE events.date < date('now')`,
      idColumn: `fight_stats.fight_id || ':' || fight_stats.fighter_id`,
    }),
  },
  round_stats: {
    'completed-fights': () => ({
      joinSql: `round_stats
        JOIN fights ON fights.id = round_stats.fight_id
        JOIN events ON events.id = fights.event_id
        WHERE events.date < date('now')`,
      idColumn: `round_stats.fight_id || ':' || round_stats.fighter_id || ':' || round_stats.round`,
    }),
  },
  official_fight_outcomes: {
    'completed-fights': () => ({
      joinSql: `official_fight_outcomes
        JOIN fights ON fights.id = official_fight_outcomes.fight_id
        JOIN events ON events.id = fights.event_id
        WHERE events.date < date('now')`,
      idColumn: 'official_fight_outcomes.fight_id',
    }),
  },
  predictions: {
    'upcoming-fights': () => ({
      joinSql: `predictions
        JOIN fights ON fights.id = predictions.fight_id
        JOIN events ON events.id = fights.event_id
        WHERE events.date >= date('now')`,
      idColumn: 'predictions.id',
    }),
  },
};

function resolveScope(table, scopeName) {
  const tableScopes = SCOPES[table];
  if (!tableScopes) throw new Error(`No scopes defined for table: ${table}`);

  // event:<id> dynamic scope
  const eventMatch = (scopeName || '').match(/^event:(\d+)$/);
  if (eventMatch) {
    if (!tableScopes.event) throw new Error(`Table ${table} doesn't support event scope`);
    return tableScopes.event(parseInt(eventMatch[1], 10));
  }

  const fn = tableScopes[scopeName];
  if (!fn) throw new Error(`Unknown scope ${scopeName} for table ${table}`);
  return fn();
}

function listScopesForTable(table) {
  return Object.keys(SCOPES[table] || {}).filter(k => k !== 'event');
}

module.exports = { resolveScope, listScopesForTable };
```

**Note on `date('now')`:** SQLite-native; Postgres also accepts it but the canonical form is `CURRENT_DATE`. Use `date('now')` for portability — it works in both.

- [ ] **Step 4: Implement coverage-spec module**

Create `data/audit/coverage-spec.js`:

```js
/**
 * data/audit/coverage-spec.js
 *
 * Declarative list of (table, column, scopes) triples to audit. Order does
 * not matter; each entry produces one or more coverage_snapshots rows per
 * audit run.
 *
 * Adding a new audited column = add a row here.
 */

module.exports = [
  // ── fighters ──
  { table: 'fighters', column: 'height_cm',     scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'reach_cm',      scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'stance',        scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'dob',           scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'weight_class',  scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'nationality',   scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'slpm',          scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'str_acc',       scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'sapm',          scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'str_def',       scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'td_avg',        scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'td_acc',        scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'td_def',        scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'sub_avg',       scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'headshot_url',  scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'body_url',      scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'ufcstats_hash', scopes: ['all', 'upcoming-roster'] },

  // ── events ──
  { table: 'events', column: 'date',       scopes: ['all', 'upcoming'] },
  { table: 'events', column: 'venue',      scopes: ['all', 'upcoming'] },
  { table: 'events', column: 'city',       scopes: ['all', 'upcoming'] },
  { table: 'events', column: 'country',    scopes: ['all', 'upcoming'] },
  { table: 'events', column: 'start_time', scopes: ['all', 'upcoming'] },
  { table: 'events', column: 'end_time',   scopes: ['all', 'upcoming'] },
  { table: 'events', column: 'timezone',   scopes: ['all', 'upcoming'] },

  // ── fights (completed) ──
  { table: 'fights', column: 'winner_id',     scopes: ['completed'] },
  { table: 'fights', column: 'method',        scopes: ['completed'] },
  { table: 'fights', column: 'method_detail', scopes: ['completed'] },
  { table: 'fights', column: 'round',         scopes: ['completed'] },
  { table: 'fights', column: 'time',          scopes: ['completed'] },
  { table: 'fights', column: 'has_stats',     scopes: ['completed'] },

  // ── fight_stats (completed) ──
  { table: 'fight_stats', column: 'sig_str_landed',     scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'sig_str_attempted',  scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'total_str_landed',   scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'takedowns_landed',   scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'knockdowns',         scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'sub_attempts',       scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'control_time_sec',   scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'head_landed',        scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'body_landed',        scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'leg_landed',         scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'distance_landed',    scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'clinch_landed',      scopes: ['completed-fights'] },
  { table: 'fight_stats', column: 'ground_landed',      scopes: ['completed-fights'] },

  // ── row-existence audits (column='__row__' is a sentinel for "row present") ──
  { table: 'round_stats',             column: '__row__', scopes: ['completed-fights'] },
  { table: 'official_fight_outcomes', column: '__row__', scopes: ['completed-fights'] },
  { table: 'predictions',             column: '__row__', scopes: ['upcoming-fights'] },
  { table: 'predictions',             column: 'enrichment_level', scopes: ['upcoming-fights'] },
];
```

- [ ] **Step 5: Run tests, expect pass**

Run: `npm test`
Expected: PASS on all scope-resolution tests.

- [ ] **Step 6: Commit**

```bash
git add data/audit/coverage-spec.js data/audit/scopes.js tests/audit/scopes.test.js tests/run.js
git commit -m "feat(audit): coverage spec + scope resolver"
```

---

### Task 3: Audit runner

**Files:**
- Create: `data/audit/runner.js`
- Create: `tests/audit/runner.test.js`

- [ ] **Step 1: Write failing runner test**

Create `tests/audit/runner.test.js`:

```js
const db = require('../../db');
const { runAudit } = require('../../data/audit/runner');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nAudit Runner:');

  await db.init();

  // Plant fixture: 4 fighters, 2 with reach_cm, 2 without
  for (const fid of [9201, 9202, 9203, 9204]) {
    await db.run(`INSERT OR REPLACE INTO fighters (id, name) VALUES (?, ?)`, [fid, `RunnerFixture${fid}`]);
  }
  await db.run(`UPDATE fighters SET reach_cm = ? WHERE id IN (?, ?)`, [180, 9201, 9202]);
  // ids 9203, 9204 stay NULL on reach_cm

  // Run audit with a tiny custom spec
  const spec = [
    { table: 'fighters', column: 'reach_cm', scopes: ['all'] },
  ];

  // Restrict to fixture rows only with a scoped pre-filter — easiest is a custom scope
  // For test we'll just ensure the runner produces SOME rows and the math works
  const result = await runAudit({ spec, triggerSource: 'test' });

  assert(typeof result.run_id === 'string' && result.run_id.length > 0, 'run_id returned');
  assert(Array.isArray(result.summary), 'summary array returned');
  assert(result.summary.length >= 1, 'summary has at least one entry');

  const reachEntry = result.summary.find(r => r.table_name === 'fighters' && r.column_name === 'reach_cm' && r.scope === 'all');
  assert(reachEntry, 'reach_cm/all entry present');
  assert(reachEntry.total_rows >= 4, 'total_rows includes fixture rows');
  assert(reachEntry.coverage_pct >= 0 && reachEntry.coverage_pct <= 1, 'coverage_pct is a fraction');

  // Snapshots persisted
  const persisted = await db.allRows(`SELECT * FROM coverage_snapshots WHERE run_id = ?`, [result.run_id]);
  assert(persisted.length === 1, 'one snapshot row persisted');

  // audit_runs row written and marked complete
  const arRows = await db.allRows(`SELECT * FROM audit_runs WHERE run_id = ?`, [result.run_id]);
  assert(arRows.length === 1, 'audit_runs row written');
  assert(arRows[0].status === 'complete', 'audit_runs status is complete');

  // Cleanup
  await db.run(`DELETE FROM coverage_snapshots WHERE run_id = ?`, [result.run_id]);
  await db.run(`DELETE FROM audit_runs WHERE run_id = ?`, [result.run_id]);
  await db.run(`DELETE FROM fighters WHERE id IN (9201, 9202, 9203, 9204)`);

  // ── Test row-existence sentinel column ──
  // Insert two completed events, two fights, one with a prediction
  const past = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  await db.run(`INSERT OR REPLACE INTO events (id, name, date) VALUES (?, ?, ?)`, [9301, 'RunnerEvt', past]);
  for (const fid of [9301, 9302, 9303, 9304]) {
    await db.run(`INSERT OR REPLACE INTO fighters (id, name) VALUES (?, ?)`, [fid, `RunnerEvtFighter${fid}`]);
  }
  await db.run(`INSERT OR REPLACE INTO fights (id, event_id, red_fighter_id, blue_fighter_id) VALUES (?, ?, ?, ?)`,
    [9401, 9301, 9301, 9302]);
  await db.run(`INSERT OR REPLACE INTO fights (id, event_id, red_fighter_id, blue_fighter_id) VALUES (?, ?, ?, ?)`,
    [9402, 9301, 9303, 9304]);
  // Insert official_fight_outcomes for one of the two fights
  await db.run(`
    INSERT OR REPLACE INTO official_fight_outcomes (fight_id, event_id, status, captured_at)
    VALUES (?, ?, ?, ?)
  `, [9401, 9301, 'final', new Date().toISOString()]);

  const rowSpec = [
    { table: 'official_fight_outcomes', column: '__row__', scopes: ['completed-fights'] },
  ];
  const r2 = await runAudit({ spec: rowSpec, triggerSource: 'test' });
  const rowEntry = r2.summary.find(r => r.table_name === 'official_fight_outcomes' && r.column_name === '__row__');
  assert(rowEntry, '__row__ sentinel produces snapshot row');
  // 1 of 2 completed fights has an outcome row → expect coverage to reflect that
  assert(rowEntry.total_rows >= 2, '__row__ total_rows >= 2');
  assert(rowEntry.non_null_rows >= 1 && rowEntry.non_null_rows <= rowEntry.total_rows, '__row__ non_null in expected range');

  // Cleanup
  await db.run(`DELETE FROM coverage_snapshots WHERE run_id = ?`, [r2.run_id]);
  await db.run(`DELETE FROM audit_runs WHERE run_id = ?`, [r2.run_id]);
  await db.run(`DELETE FROM official_fight_outcomes WHERE fight_id IN (9401, 9402)`);
  await db.run(`DELETE FROM fights WHERE id IN (9401, 9402)`);
  await db.run(`DELETE FROM fighters WHERE id IN (9301, 9302, 9303, 9304)`);
  await db.run(`DELETE FROM events WHERE id = 9301`);

  return results;
}

module.exports = { run };
```

Wire into `tests/run.js`.

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: failure (`data/audit/runner` not found).

- [ ] **Step 3: Implement runner**

Create `data/audit/runner.js`:

```js
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

async function auditOne(runId, ranAt, table, column, scope) {
  const { joinSql, idColumn } = resolveScope(table, scope);

  let totalRows, nonNullRows, gapIds;

  if (column === '__row__') {
    // Row-existence: total = parent-scope rows; non_null = rows that exist in target table
    // For row-existence audits, joinSql already restricts to existing rows in the target,
    // so total_rows = rows produced; we instead need to compare against the parent universe.
    // Simplest correct interpretation: total = parent-scope-fights, non_null = those with a row.
    // Implementation: count distinct fight ids across (a) the broader fights universe under same date filter
    // and (b) the actual joined rows present.
    // We compute this by running the scope query for parent (fights) and target (with join).
    const parentScope = scope.startsWith('event:')
      ? resolveScope('fights', scope)
      : resolveScope('fights', 'completed');
    const parentRes = await db.allRows(`SELECT DISTINCT ${parentScope.idColumn} AS id FROM ${parentScope.joinSql}`);
    const parentIds = new Set(parentRes.map(r => String(r.id)));

    const targetRes = await db.allRows(`SELECT DISTINCT ${idColumn} AS id FROM ${joinSql}`);
    const presentIds = new Set(targetRes.map(r => String(r.id)));

    totalRows = parentIds.size;
    nonNullRows = [...parentIds].filter(id => presentIds.has(id)).length;
    gapIds = [...parentIds].filter(id => !presentIds.has(id)).slice(0, GAP_SAMPLE_LIMIT);
  } else {
    // Standard column-not-null audit
    // Use subquery for portability across PG/SQLite (avoids FILTER (WHERE ...))
    const totalSql = `SELECT count(*) AS n FROM ${joinSql}`;
    const nullSql = `SELECT ${idColumn} AS id FROM ${joinSql} AND ${table}.${column} IS NULL LIMIT ${GAP_SAMPLE_LIMIT + 1}`;

    // joinSql may or may not already contain a WHERE — handle both
    const hasWhere = /\bWHERE\b/i.test(joinSql);
    const nullSqlSafe = hasWhere
      ? `SELECT ${idColumn} AS id FROM ${joinSql} AND ${table}.${column} IS NULL LIMIT ${GAP_SAMPLE_LIMIT + 1}`
      : `SELECT ${idColumn} AS id FROM ${joinSql} WHERE ${table}.${column} IS NULL LIMIT ${GAP_SAMPLE_LIMIT + 1}`;

    const totalRes = await db.allRows(totalSql);
    totalRows = parseInt(totalRes[0].n, 10) || 0;

    const nullRes = await db.allRows(nullSqlSafe);
    const sampledNullIds = nullRes.map(r => String(r.id));
    // We may have more nulls than the limit; we only know we have at least sampledNullIds.length.
    // For coverage_pct we need the exact null count — run a count query.
    const nullCountSql = hasWhere
      ? `SELECT count(*) AS n FROM ${joinSql} AND ${table}.${column} IS NULL`
      : `SELECT count(*) AS n FROM ${joinSql} WHERE ${table}.${column} IS NULL`;
    const nullCountRes = await db.allRows(nullCountSql);
    const nullCount = parseInt(nullCountRes[0].n, 10) || 0;
    nonNullRows = totalRows - nullCount;
    gapIds = sampledNullIds.slice(0, GAP_SAMPLE_LIMIT);
  }

  const coveragePct = totalRows === 0 ? 1 : nonNullRows / totalRows;

  await db.run(`
    INSERT INTO coverage_snapshots
      (run_id, ran_at, table_name, column_name, scope, total_rows, non_null_rows, coverage_pct, gap_row_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [runId, ranAt, table, column, scope, totalRows, nonNullRows, coveragePct, JSON.stringify(gapIds)]);

  return { table_name: table, column_name: column, scope, total_rows: totalRows, non_null_rows: nonNullRows, coverage_pct: coveragePct, gap_row_ids: gapIds };
}

async function runAudit({ spec = defaultSpec, scope = null, triggerSource = 'cli' } = {}) {
  const runId = newRunId();
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  await db.run(`
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

  await db.run(`
    UPDATE audit_runs
    SET finished_at = ?, status = ?, summary = ?, error_text = ?
    WHERE run_id = ?
  `, [finishedAt, status, JSON.stringify({ entries: summary.length, errors: errors.length }),
      errors.length ? JSON.stringify(errors) : null, runId]);

  return { run_id: runId, summary, duration_ms: duration, status, errors };
}

module.exports = { runAudit, GAP_SAMPLE_LIMIT };
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test`
Expected: PASS on all 7 runner assertions.

- [ ] **Step 5: Commit**

```bash
git add data/audit/runner.js tests/audit/runner.test.js tests/run.js
git commit -m "feat(audit): runner with per-entry transactions and gap sampling"
```

---

### Task 4: Audit HTTP endpoint

**Files:**
- Modify: `server.js` (add audit routes near the predictions section ~line 440)
- Create: `data/audit/api.js`

- [ ] **Step 1: Implement coverage query helpers**

Create `data/audit/api.js`:

```js
/**
 * data/audit/api.js — read-side helpers powering /api/data/coverage
 */
const db = require('../../db');

async function getLatestCompleteRunId() {
  const rows = await db.allRows(`
    SELECT run_id FROM audit_runs WHERE status = 'complete' ORDER BY started_at DESC LIMIT 1
  `);
  return rows[0]?.run_id || null;
}

async function getCoverageForRun(runId) {
  return db.allRows(`
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
  return db.allRows(sql, params);
}

async function getDiffLast2() {
  // Find the two most recent COMPLETE runs
  const recent = await db.allRows(`
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
  // Sort by largest negative delta first (regressions on top)
  diffs.sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));

  return { runs: [latest.run_id, prev.run_id], diffs };
}

module.exports = { getLatestCompleteRunId, getCoverageForRun, getColumnHistory, getDiffLast2 };
```

- [ ] **Step 2: Register routes in server.js**

In `server.js`, right after the `requirePredictionKey` middleware definition (~line 449), add:

```js
// ============================================================
// DATA AUDIT API (internal, key-protected)
// ============================================================
const auditApi = require('./data/audit/api');
const { runAudit } = require('./data/audit/runner');

app.get('/api/data/coverage', requirePredictionKey, apiHandler(async (req, res) => {
  if (req.query.diff === 'last2') {
    return res.json(await auditApi.getDiffLast2());
  }
  if (req.query.table && req.query.column) {
    return res.json(await auditApi.getColumnHistory({
      table: String(req.query.table).slice(0, 64),
      column: String(req.query.column).slice(0, 64),
      scope: req.query.scope ? String(req.query.scope).slice(0, 64) : null,
      limit: req.query.limit,
    }));
  }
  let runId = req.query.run && req.query.run !== 'latest' ? String(req.query.run).slice(0, 64) : null;
  if (!runId) runId = await auditApi.getLatestCompleteRunId();
  if (!runId) return res.json({ run_id: null, snapshots: [] });
  res.json({ run_id: runId, snapshots: await auditApi.getCoverageForRun(runId) });
}));

app.post('/api/data/audit/run', requirePredictionKey, apiHandler(async (req, res) => {
  const scope = req.body && req.body.scope ? String(req.body.scope).slice(0, 64) : null;
  const result = await runAudit({ scope, triggerSource: 'http' });
  res.json(result);
}));
```

Make sure `app.use(express.json())` is registered before this block (check existing code — usually near the top). If not, add it for these routes only:

```js
const auditJsonBody = express.json({ limit: '64kb' });
app.post('/api/data/audit/run', auditJsonBody, requirePredictionKey, apiHandler(async (req, res) => { ... }));
```

(Decide based on what's already in `server.js`.)

- [ ] **Step 3: Smoke test the endpoint**

Run the server locally and curl. Set `PREDICTION_SERVICE_KEY=devkey` and `DATABASE_URL` to local Postgres or unset for SQLite:

```bash
PREDICTION_SERVICE_KEY=devkey npm start &
sleep 2
# Run an audit
curl -s -X POST -H "x-prediction-key: devkey" http://localhost:3000/api/data/audit/run | head -c 500
echo
# Read latest coverage
curl -s -H "x-prediction-key: devkey" 'http://localhost:3000/api/data/coverage?run=latest' | head -c 500
echo
# Diff
curl -s -H "x-prediction-key: devkey" 'http://localhost:3000/api/data/coverage?diff=last2' | head -c 500
```

Expected: JSON responses, no 500s. The diff response will be `{ runs: [<one>], diffs: [] }` if only one run has happened.

- [ ] **Step 4: Commit**

```bash
git add server.js data/audit/api.js
git commit -m "feat(audit): /api/data/coverage and /api/data/audit/run endpoints"
```

---

### Task 5: Audit CLI

**Files:**
- Create: `scripts/audit-run.js`
- Modify: `package.json` (add `audit` script)

- [ ] **Step 1: Write CLI**

Create `scripts/audit-run.js`:

```js
#!/usr/bin/env node
/**
 * scripts/audit-run.js — manual `npm run audit`.
 *
 * Usage:
 *   npm run audit
 *   npm run audit -- --scope=event:110
 *   npm run audit -- --scope=upcoming-roster
 *   npm run audit -- --json
 */
const db = require('../db');
const { runAudit } = require('../data/audit/runner');

function parseArgs(argv) {
  const out = { scope: null, json: false };
  for (const a of argv.slice(2)) {
    if (a === '--json') out.json = true;
    else if (a.startsWith('--scope=')) out.scope = a.slice('--scope='.length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  await db.init();
  const result = await runAudit({ scope: args.scope, triggerSource: 'cli' });
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    console.log(`\nAudit ${result.run_id} — status=${result.status} duration=${result.duration_ms}ms`);
    console.log(`Snapshots: ${result.summary.length}, errors: ${result.errors.length}`);
    if (result.errors.length) {
      for (const e of result.errors) console.log(`  ERR ${e.table}.${e.column}/${e.scope}: ${e.error}`);
    }
    // Print top 10 lowest-coverage snapshots
    const sorted = [...result.summary].sort((a, b) => a.coverage_pct - b.coverage_pct).slice(0, 10);
    console.log('\nLowest coverage:');
    for (const s of sorted) {
      const pct = (s.coverage_pct * 100).toFixed(1);
      console.log(`  ${pct}%  ${s.table_name}.${s.column_name}  scope=${s.scope}  (${s.non_null_rows}/${s.total_rows})`);
    }
  }
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

In `package.json`, in the `scripts` block, add:

```json
"audit": "node scripts/audit-run.js"
```

- [ ] **Step 3: Smoke test**

```bash
npm run audit
```

Expected: Audit completes; prints status, snapshot count, and lowest-coverage table.

- [ ] **Step 4: Commit**

```bash
git add scripts/audit-run.js package.json
git commit -m "feat(audit): npm run audit CLI"
```

---

## Phase 3 — Scraper Module Extraction

### Task 6: Extract ufcstats fighter parser

**Files:**
- Create: `data/scrapers/http.js`
- Create: `data/scrapers/ufcstats-fighter.js`
- Create: `tests/fixtures/scrapers/ufcstats-fighter-sample.html`
- Create: `tests/scrapers/ufcstats-fighter.test.js`
- Modify: `data/scrape.js` (replace inline parsing with module call)

- [ ] **Step 1: Capture a real fixture HTML**

```bash
mkdir -p tests/fixtures/scrapers
curl -s -A 'UFC-Tactical-Dashboard/2.0' 'http://ufcstats.com/fighter-details/c4a92716af49c5f3' \
  > tests/fixtures/scrapers/ufcstats-fighter-sample.html
```

(Any valid fighter hash works. The above is a placeholder; pick any hash you can verify.)

- [ ] **Step 2: Write failing fighter-parser test**

Create `tests/scrapers/ufcstats-fighter.test.js`:

```js
const fs = require('fs');
const path = require('path');
const { parseFighterPage } = require('../../data/scrapers/ufcstats-fighter');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nScraper: ufcstats-fighter:');

  const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'scrapers', 'ufcstats-fighter-sample.html'), 'utf8');
  const result = parseFighterPage(html, 'c4a92716af49c5f3');

  assert(result, 'parseFighterPage returns truthy');
  assert(typeof result.name === 'string' && result.name.length > 0, 'name extracted');
  assert(result.ufcstats_hash === 'c4a92716af49c5f3', 'hash preserved');
  // Career stats — these may be missing on some fighters; check at least one is numeric or null (not undefined)
  assert('slpm' in result, 'slpm present (may be null)');
  assert('reach_cm' in result, 'reach_cm present (may be null)');

  return results;
}

module.exports = { run };
```

Wire into `tests/run.js`.

- [ ] **Step 3: Run, expect failure**

Run: `npm test`
Expected: failure (`data/scrapers/ufcstats-fighter` not found).

- [ ] **Step 4: Implement HTTP helper**

Create `data/scrapers/http.js`:

```js
/**
 * data/scrapers/http.js — shared fetch with retries used by all scraper modules.
 */
const DEFAULT_UA = 'UFC-Tactical-Dashboard/2.0 (github.com/westondunn/ufc245-tactical)';
const DEFAULT_DELAY_MS = 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchPage(url, { retries = 3, ua = DEFAULT_UA, delayMs = DEFAULT_DELAY_MS, signal = null } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': ua }, signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      if (delayMs) await sleep(delayMs);
      return text;
    } catch (e) {
      lastErr = e;
      if (i < retries - 1) await sleep(2000);
    }
  }
  throw lastErr;
}

async function headOk(url, { ua = DEFAULT_UA } = {}) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': ua } });
    return res.ok;
  } catch {
    return false;
  }
}

module.exports = { fetchPage, headOk, sleep };
```

- [ ] **Step 5: Implement fighter parser module**

Create `data/scrapers/ufcstats-fighter.js`:

```js
/**
 * data/scrapers/ufcstats-fighter.js
 *
 * Parses an ufcstats.com fighter-details page into a normalized fighter row.
 * Pure function: takes html string, returns object. Tested against fixtures.
 *
 * Plus async fetchFighter(hash) for live scrapes.
 */
const cheerio = require('cheerio');
const { fetchPage } = require('./http');

const BASE = 'http://ufcstats.com';

function clean(text) { return (text || '').replace(/\s+/g, ' ').trim(); }

function parseHeight(text) {
  const m = clean(text).match(/(\d+)'\s*(\d+)"/);
  return m ? Math.round(+m[1] * 30.48 + +m[2] * 2.54) : null;
}

function parseReach(text) {
  const m = clean(text).match(/([\d.]+)"/);
  return m ? Math.round(+m[1] * 2.54) : null;
}

function parseWeight(text) {
  const m = clean(text).match(/([\d.]+)\s*lbs/);
  return m ? Math.round(+m[1]) : null;
}

function parseFloat0(text) {
  const m = clean(text).match(/[-+]?[\d.]+/);
  return m ? parseFloat(m[0]) : null;
}

function parsePctFraction(text) {
  // ufcstats prints percentages like "47%". Return as 0..1 float, or null.
  const m = clean(text).match(/(\d+)%/);
  return m ? +m[1] / 100 : null;
}

function pairValue($, label) {
  // ufcstats fighter pages put labels in <i class="b-list__box-item-title"> and values follow.
  let value = null;
  $('li.b-list__box-list-item').each((i, li) => {
    const t = clean($(li).find('i.b-list__box-item-title').text());
    if (t && t.toLowerCase().startsWith(label.toLowerCase())) {
      const html = $(li).html() || '';
      const text = clean($(li).text());
      value = clean(text.replace(/^.+?:/, ''));
    }
  });
  return value;
}

function parseFighterPage(html, hash) {
  const $ = cheerio.load(html);

  const name = clean($('span.b-content__title-highlight').first().text());
  const nickname = clean($('p.b-content__Nickname').first().text()) || null;

  const heightTxt   = pairValue($, 'Height');
  const weightTxt   = pairValue($, 'Weight');
  const reachTxt    = pairValue($, 'Reach');
  const stanceTxt   = pairValue($, 'STANCE');
  const dobTxt      = pairValue($, 'DOB');

  const slpmTxt    = pairValue($, 'SLpM');
  const strAccTxt  = pairValue($, 'Str. Acc.');
  const sapmTxt    = pairValue($, 'SApM');
  const strDefTxt  = pairValue($, 'Str. Def');
  const tdAvgTxt   = pairValue($, 'TD Avg.');
  const tdAccTxt   = pairValue($, 'TD Acc.');
  const tdDefTxt   = pairValue($, 'TD Def.');
  const subAvgTxt  = pairValue($, 'Sub. Avg.');

  return {
    ufcstats_hash: hash || null,
    name,
    nickname,
    height_cm: parseHeight(heightTxt),
    weight_lb: parseWeight(weightTxt),
    reach_cm: parseReach(reachTxt),
    stance: stanceTxt ? clean(stanceTxt) : null,
    dob: dobTxt && dobTxt !== '--' ? dobTxt : null,
    slpm: parseFloat0(slpmTxt),
    str_acc: parsePctFraction(strAccTxt),
    sapm: parseFloat0(sapmTxt),
    str_def: parsePctFraction(strDefTxt),
    td_avg: parseFloat0(tdAvgTxt),
    td_acc: parsePctFraction(tdAccTxt),
    td_def: parsePctFraction(tdDefTxt),
    sub_avg: parseFloat0(subAvgTxt),
  };
}

async function fetchFighter(hash, opts = {}) {
  const url = `${BASE}/fighter-details/${hash}`;
  const html = await fetchPage(url, opts);
  return { ...parseFighterPage(html, hash), source_url: url };
}

module.exports = { parseFighterPage, fetchFighter };
```

- [ ] **Step 6: Refactor data/scrape.js to use the module**

In `data/scrape.js`, find the inline fighter-page parsing (around the function that handles fighter detail extraction, search for `b-list__box-list-item` or the fighter parser). Replace it with:

```js
const { parseFighterPage } = require('./scrapers/ufcstats-fighter');
// ...
// where you previously did inline cheerio parsing of a fighter page:
const profile = parseFighterPage(html, hash);
```

If the existing CLI passes additional fields you don't see in the new parser, leave the inline code alongside until v2 — but the *parser of the column subset we audit* must come from the module. Verify by running:

```bash
node data/scrape.js --event-hash <known-hash>
```

and diffing the resulting `seed.json` change against a backup. If output matches, the refactor is good.

- [ ] **Step 7: Run tests, expect pass**

Run: `npm test`
Expected: PASS on parser test (assertions are lenient about NULL vs value to handle different fixture fighters).

- [ ] **Step 8: Commit**

```bash
git add data/scrapers/http.js data/scrapers/ufcstats-fighter.js data/scrape.js tests/scrapers/ufcstats-fighter.test.js tests/fixtures/scrapers/ufcstats-fighter-sample.html tests/run.js
git commit -m "refactor(scrapers): extract ufcstats fighter parser into data/scrapers module"
```

---

### Task 7: Extract ufcstats event parser

**Files:**
- Create: `data/scrapers/ufcstats-event.js`
- Create: `tests/fixtures/scrapers/ufcstats-event-sample.html`
- Create: `tests/scrapers/ufcstats-event.test.js`
- Modify: `data/scrape-results.js` and/or `data/scrape.js` to use new module

- [ ] **Step 1: Capture fixture**

```bash
curl -s -A 'UFC-Tactical-Dashboard/2.0' 'http://ufcstats.com/event-details/<known-hash>' \
  > tests/fixtures/scrapers/ufcstats-event-sample.html
```

- [ ] **Step 2: Write failing test**

Create `tests/scrapers/ufcstats-event.test.js`:

```js
const fs = require('fs');
const path = require('path');
const { parseEventPage } = require('../../data/scrapers/ufcstats-event');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nScraper: ufcstats-event:');

  const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'scrapers', 'ufcstats-event-sample.html'), 'utf8');
  const result = parseEventPage(html, 'sample-hash');

  assert(result, 'returns truthy');
  assert(typeof result.name === 'string' && result.name.length > 0, 'event name extracted');
  assert(typeof result.date === 'string' || result.date === null, 'date present (or null)');
  assert(Array.isArray(result.fights), 'fights array');
  assert(result.fights.length >= 1, 'at least one fight parsed');
  const f = result.fights[0];
  assert(typeof f.fight_hash === 'string' && f.fight_hash.length > 0, 'fight_hash present');
  assert(typeof f.red_name === 'string', 'red_name present');
  assert(typeof f.blue_name === 'string', 'blue_name present');

  return results;
}

module.exports = { run };
```

Wire into `tests/run.js`.

- [ ] **Step 3: Run, expect failure**

Run: `npm test`
Expected: module not found.

- [ ] **Step 4: Implement event parser**

Create `data/scrapers/ufcstats-event.js`:

```js
const cheerio = require('cheerio');
const { fetchPage } = require('./http');

const BASE = 'http://ufcstats.com';

function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }
function hashFromUrl(url) {
  const m = (url || '').match(/([a-f0-9]{16})$/);
  return m ? m[1] : null;
}

function parseEventPage(html, eventHash) {
  const $ = cheerio.load(html);
  const name = clean($('h2.b-content__title span').first().text());
  const dateText = clean($('li.b-list__box-list-item:contains("Date:")').text().replace(/^Date:/i, ''));
  const locationText = clean($('li.b-list__box-list-item:contains("Location:")').text().replace(/^Location:/i, ''));

  const fights = [];
  $('tr.b-fight-details__table-row').each((i, row) => {
    const $row = $(row);
    const fightLink = $row.find('a.b-flag').attr('href') || $row.attr('data-link') || '';
    const fightHash = hashFromUrl(fightLink);
    if (!fightHash) return;

    const fighters = $row.find('td').eq(1).find('a.b-link');
    const redName = clean(fighters.eq(0).text());
    const blueName = clean(fighters.eq(1).text());
    const redHash = hashFromUrl(fighters.eq(0).attr('href'));
    const blueHash = hashFromUrl(fighters.eq(1).attr('href'));

    const cells = $row.find('td').toArray().map(td => clean($(td).text()));
    const weightClass = cells[6] || '';
    const method = cells[7] || '';
    const round = parseInt(cells[8], 10) || null;
    const time = cells[9] || null;

    // Winner: ufcstats marks the winner with `<i class="b-fight-details__person-status_style_green">`
    // Approximation: first fighter is red; check if either fighter row has the win marker.
    const win0 = $row.find('td').eq(0).text().toLowerCase().includes('win');
    fights.push({
      fight_hash: fightHash,
      red_name: redName, red_hash: redHash,
      blue_name: blueName, blue_hash: blueHash,
      weight_class: weightClass,
      method, round, time,
      winner_side: win0 ? 'red' : 'blue',  // ufcstats puts the winner on row 0
    });
  });

  return { name, date: dateText || null, location: locationText || null, ufcstats_hash: eventHash || null, fights };
}

async function fetchEvent(hash, opts = {}) {
  const url = `${BASE}/event-details/${hash}`;
  const html = await fetchPage(url, opts);
  return { ...parseEventPage(html, hash), source_url: url };
}

module.exports = { parseEventPage, fetchEvent };
```

- [ ] **Step 5: Run tests, expect pass**

Run: `npm test`
Expected: PASS on event-parser test.

- [ ] **Step 6: Commit**

```bash
git add data/scrapers/ufcstats-event.js tests/scrapers/ufcstats-event.test.js tests/fixtures/scrapers/ufcstats-event-sample.html tests/run.js
git commit -m "refactor(scrapers): extract ufcstats event parser"
```

---

### Task 8: Extract ufcstats fight (per-bout) parser

**Files:**
- Create: `data/scrapers/ufcstats-fight.js`
- Create: `tests/fixtures/scrapers/ufcstats-fight-sample.html`
- Create: `tests/scrapers/ufcstats-fight.test.js`

- [ ] **Step 1: Capture fixture**

```bash
curl -s -A 'UFC-Tactical-Dashboard/2.0' 'http://ufcstats.com/fight-details/<known-fight-hash>' \
  > tests/fixtures/scrapers/ufcstats-fight-sample.html
```

- [ ] **Step 2: Write failing test**

Create `tests/scrapers/ufcstats-fight.test.js`:

```js
const fs = require('fs');
const path = require('path');
const { parseFightPage } = require('../../data/scrapers/ufcstats-fight');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nScraper: ufcstats-fight:');

  const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'scrapers', 'ufcstats-fight-sample.html'), 'utf8');
  const result = parseFightPage(html, 'sample-hash');

  assert(result, 'returns truthy');
  assert(Array.isArray(result.fight_stats) && result.fight_stats.length === 2, '2 fight_stats rows');
  assert(typeof result.fight_stats[0].sig_str_landed === 'number', 'sig_str_landed numeric');
  assert(Array.isArray(result.round_stats), 'round_stats array present');
  assert(result.round_stats.length === 0 || result.round_stats.length % 2 === 0, 'round_stats are paired per round');

  return results;
}

module.exports = { run };
```

Wire into `tests/run.js`.

- [ ] **Step 3: Implement fight parser**

Create `data/scrapers/ufcstats-fight.js`:

```js
const cheerio = require('cheerio');
const { fetchPage } = require('./http');

const BASE = 'http://ufcstats.com';

function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }
function parseLandedOf(t) {
  const m = clean(t).match(/(\d+)\s+of\s+(\d+)/);
  return m ? { landed: +m[1], attempted: +m[2] } : { landed: 0, attempted: 0 };
}
function parseCtrl(t) {
  const m = clean(t).match(/(\d+):(\d+)/);
  return m ? +m[1] * 60 + +m[2] : 0;
}

function parseFightPage(html, fightHash) {
  const $ = cheerio.load(html);

  const fight_stats = [];
  const round_stats = [];

  // Fight totals table: first table under section ".b-fight-details__section"
  // Each fighter has its own row. ufcstats lays out values in <p class="b-fight-details__table-text">.
  // The structure is fragile; this is a best-effort extraction.
  $('section.b-fight-details__section').each((i, sec) => {
    const heading = clean($(sec).find('h3.b-fight-details__collapse-link_tot').text() || $(sec).prev('h3').text());
    const isTotals = /Totals/i.test(heading) || $(sec).find('.b-fight-details__table-row').length > 0;
    if (!isTotals) return;

    const rows = $(sec).find('.b-fight-details__table-row.b-fight-details__table-row__head + .b-fight-details__table-row, .b-fight-details__table-body > .b-fight-details__table-row');
    // For each row in this section, extract two columns of stacked values per stat
    rows.each((j, row) => {
      const cells = $(row).find('td');
      if (cells.length < 10) return;
      const fighters = $(cells[0]).find('a').toArray().map(a => clean($(a).text()));
      const sigPair = $(cells[2]).find('p').toArray().map(p => parseLandedOf($(p).text()));
      const totalPair = $(cells[4]).find('p').toArray().map(p => parseLandedOf($(p).text()));
      const tdPair = $(cells[5]).find('p').toArray().map(p => parseLandedOf($(p).text()));
      const subPair = $(cells[7]).find('p').toArray().map(p => parseInt(clean($(p).text()), 10) || 0);
      const kdPair = $(cells[1]).find('p').toArray().map(p => parseInt(clean($(p).text()), 10) || 0);
      const ctrlPair = $(cells[9]).find('p').toArray().map(p => parseCtrl($(p).text()));

      for (let k = 0; k < 2; k++) {
        fight_stats.push({
          fighter_name: fighters[k] || null,
          sig_str_landed: sigPair[k]?.landed ?? 0,
          sig_str_attempted: sigPair[k]?.attempted ?? 0,
          total_str_landed: totalPair[k]?.landed ?? 0,
          total_str_attempted: totalPair[k]?.attempted ?? 0,
          takedowns_landed: tdPair[k]?.landed ?? 0,
          takedowns_attempted: tdPair[k]?.attempted ?? 0,
          knockdowns: kdPair[k] ?? 0,
          sub_attempts: subPair[k] ?? 0,
          control_time_sec: ctrlPair[k] ?? 0,
        });
      }
    });
  });

  return { ufcstats_hash: fightHash || null, fight_stats, round_stats };
}

async function fetchFight(hash, opts = {}) {
  const url = `${BASE}/fight-details/${hash}`;
  const html = await fetchPage(url, opts);
  return { ...parseFightPage(html, hash), source_url: url };
}

module.exports = { parseFightPage, fetchFight };
```

**Note:** The selectors above are best-effort extracted from `data/scrape.js`'s existing inline parsing. If the test fails because of selector mismatch, copy the selectors from the working code in `data/scrape.js` directly. The goal is to *match the existing parser's behavior*, not improve it.

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test`
Expected: PASS on fight-parser test (lenient — `round_stats` may be empty if the fixture omits them).

- [ ] **Step 5: Commit**

```bash
git add data/scrapers/ufcstats-fight.js tests/scrapers/ufcstats-fight.test.js tests/fixtures/scrapers/ufcstats-fight-sample.html tests/run.js
git commit -m "refactor(scrapers): extract ufcstats fight (per-bout) parser"
```

---

### Task 9: Extract ufc.com athlete parser (headshot only for v1)

**Files:**
- Create: `data/scrapers/ufc-com-athlete.js`
- Create: `tests/fixtures/scrapers/ufc-com-athlete-sample.html`
- Create: `tests/scrapers/ufc-com-athlete.test.js`

- [ ] **Step 1: Capture fixture**

```bash
curl -s -A 'Mozilla/5.0 UFC-Tactical-Dashboard/2.0' 'https://www.ufc.com/athlete/<slug>' \
  > tests/fixtures/scrapers/ufc-com-athlete-sample.html
```

- [ ] **Step 2: Write test**

Create `tests/scrapers/ufc-com-athlete.test.js`:

```js
const fs = require('fs');
const path = require('path');
const { parseAthletePage } = require('../../data/scrapers/ufc-com-athlete');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nScraper: ufc-com-athlete:');

  const html = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'scrapers', 'ufc-com-athlete-sample.html'), 'utf8');
  const result = parseAthletePage(html, 'sample-slug');

  assert(result, 'returns truthy');
  assert(typeof result.name === 'string', 'name extracted');
  assert(result.headshot_url === null || /^https?:\/\//.test(result.headshot_url), 'headshot_url is URL or null');
  assert(result.body_url === null || /^https?:\/\//.test(result.body_url), 'body_url is URL or null');

  return results;
}

module.exports = { run };
```

Wire into `tests/run.js`.

- [ ] **Step 3: Implement parser**

Create `data/scrapers/ufc-com-athlete.js`:

```js
const cheerio = require('cheerio');
const { fetchPage } = require('./http');

const BASE = 'https://www.ufc.com';
const UA = 'Mozilla/5.0 (compatible; UFC-Tactical-Dashboard/2.0)';

function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }

function parseAthletePage(html, slug) {
  const $ = cheerio.load(html);
  const name = clean($('h1.hero-profile__name').first().text())
            || clean($('meta[property="og:title"]').attr('content') || '');
  const headshot = $('img.hero-profile__image').attr('src')
                || $('div.hero-profile__image-wrap img').attr('src')
                || null;
  const body = $('img.image-style-event-fight-card-upper-body-of-standing-athlete').attr('src')
            || null;
  return {
    ufc_slug: slug || null,
    name: name || null,
    headshot_url: headshot ? new URL(headshot, BASE).href : null,
    body_url: body ? new URL(body, BASE).href : null,
  };
}

async function fetchAthlete(slug, opts = {}) {
  const url = `${BASE}/athlete/${slug}`;
  const html = await fetchPage(url, { ua: UA, ...opts });
  return { ...parseAthletePage(html, slug), source_url: url };
}

module.exports = { parseAthletePage, fetchAthlete };
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add data/scrapers/ufc-com-athlete.js tests/scrapers/ufc-com-athlete.test.js tests/fixtures/scrapers/ufc-com-athlete-sample.html tests/run.js
git commit -m "refactor(scrapers): extract ufc.com athlete page parser"
```

---

## Phase 4 — Backfill Subsystem

### Task 10: Confidence gate (pure logic)

**Files:**
- Create: `data/backfill/gate.js`
- Create: `tests/backfill/gate.test.js`

- [ ] **Step 1: Write failing gate test**

Create `tests/backfill/gate.test.js`:

```js
const { decide } = require('../../data/backfill/gate');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nBackfill Gate:');

  // cosmetic + verify pass → auto
  let r = decide({ safety: 'cosmetic', current: null, proposed: 'http://x.com/h.jpg', sources: [{name: 'a', value: 'http://x.com/h.jpg'}], verifyPassed: true });
  assert(r.decision === 'auto', 'cosmetic+verify=auto');

  // cosmetic + verify fail → review
  r = decide({ safety: 'cosmetic', current: null, proposed: 'http://x.com/h.jpg', sources: [{name: 'a', value: 'http://x.com/h.jpg'}], verifyPassed: false });
  assert(r.decision === 'review' && /verify/i.test(r.reason), 'cosmetic+!verify=review');

  // safe + null current + proposed → auto
  r = decide({ safety: 'safe', current: null, proposed: 180, sources: [{name: 'ufcstats', value: 180}], verifyPassed: true });
  assert(r.decision === 'auto', 'safe+null+proposed=auto');

  // safe + non-null current + differs → review
  r = decide({ safety: 'safe', current: 178, proposed: 180, sources: [{name: 'ufcstats', value: 180}], verifyPassed: true });
  assert(r.decision === 'review' && /overwrite/i.test(r.reason), 'safe overwrite=review');

  // risky + single source → review
  r = decide({ safety: 'risky', current: null, proposed: 4.2, sources: [{name: 'ufcstats', value: 4.2}], verifyPassed: true });
  assert(r.decision === 'review' && /single-source/i.test(r.reason), 'risky single source=review');

  // risky + two sources agree → auto
  r = decide({ safety: 'risky', current: null, proposed: 4.2, sources: [{name: 'ufcstats', value: 4.2}, {name: 'other', value: 4.2}], verifyPassed: true });
  assert(r.decision === 'auto', 'risky two-source-agree=auto');

  // risky + two sources disagree → review
  r = decide({ safety: 'risky', current: null, proposed: 4.2, sources: [{name: 'ufcstats', value: 4.2}, {name: 'other', value: 5.0}], verifyPassed: true });
  assert(r.decision === 'review' && /disagree/i.test(r.reason), 'risky disagree=review');

  // ambiguous identity → reject
  r = decide({ safety: 'safe', current: null, proposed: 180, sources: [], verifyPassed: true, ambiguousIdentity: true });
  assert(r.decision === 'reject' && /ambiguous/i.test(r.reason), 'ambiguous=reject');

  // reconcile → always review (rule: writes go through official_fight_outcomes; gate doesn't auto-promote)
  r = decide({ safety: 'reconcile', current: null, proposed: { winner_id: 42 }, sources: [{name: 'ufcstats', value: { winner_id: 42 }}], verifyPassed: true });
  assert(r.decision === 'review' && /reconcile/i.test(r.reason), 'reconcile defers to outcomes pipeline');

  return results;
}

module.exports = { run };
```

Wire into `tests/run.js`.

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: module not found.

- [ ] **Step 3: Implement gate**

Create `data/backfill/gate.js`:

```js
/**
 * data/backfill/gate.js — pure decision function.
 *
 * Inputs:
 *   safety: 'cosmetic' | 'safe' | 'risky' | 'reconcile'
 *   current: existing DB value (any) or null
 *   proposed: proposed new value (any), required
 *   sources: [{ name, value }, ...] — what each source returned
 *   verifyPassed: bool — write-time verify rule outcome
 *   ambiguousIdentity: bool — true if fighter/row identity match was ambiguous
 *
 * Output:
 *   { decision: 'auto' | 'review' | 'reject', reason }
 */

const TOLERANCE = {
  numeric: 0.001,  // exact match for floats from same source
};

function valuesAgree(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= Math.max(TOLERANCE.numeric, 0.05 * Math.abs(a));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

function decide({ safety, current, proposed, sources = [], verifyPassed, ambiguousIdentity = false }) {
  if (ambiguousIdentity) {
    return { decision: 'reject', reason: 'ambiguous identity match' };
  }

  if (proposed === null || proposed === undefined) {
    return { decision: 'reject', reason: 'no proposed value' };
  }

  if (safety === 'reconcile') {
    // Reconcile writes are always handled through official_fight_outcomes by the dispatcher;
    // the gate refuses to auto-promote them so the existing reconciliation code remains
    // the sole writer of fights.winner_id/method/round.
    return { decision: 'review', reason: 'reconcile path: defer to outcomes pipeline' };
  }

  if (!verifyPassed) {
    return { decision: 'review', reason: 'verify failed; demoted from auto' };
  }

  if (safety === 'cosmetic') {
    return { decision: 'auto', reason: 'cosmetic write with verify pass' };
  }

  if (safety === 'safe') {
    if (current === null || current === undefined) {
      return { decision: 'auto', reason: 'safe column gap fill' };
    }
    if (valuesAgree(current, proposed)) {
      return { decision: 'auto', reason: 'safe column proposal matches current; no-op' };
    }
    return { decision: 'review', reason: 'overwrite of existing value' };
  }

  if (safety === 'risky') {
    if (sources.length < 2) {
      return { decision: 'review', reason: 'single-source for risky column' };
    }
    const [a, b] = sources.slice(0, 2);
    if (valuesAgree(a.value, b.value)) {
      return { decision: 'auto', reason: 'risky column with two sources agreeing' };
    }
    return { decision: 'review', reason: 'source disagreement on risky column' };
  }

  return { decision: 'review', reason: 'unknown safety class' };
}

module.exports = { decide, valuesAgree };
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test`
Expected: PASS on all 9 gate assertions.

- [ ] **Step 5: Commit**

```bash
git add data/backfill/gate.js tests/backfill/gate.test.js tests/run.js
git commit -m "feat(backfill): pure confidence gate decision function"
```

---

### Task 11: Verify rules

**Files:**
- Create: `data/backfill/verify.js`
- Create: `tests/backfill/verify.test.js`

- [ ] **Step 1: Write failing verify test**

Create `tests/backfill/verify.test.js`:

```js
const { runVerify, parseVerifyRule } = require('../../data/backfill/verify');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nBackfill Verify:');

  // numeric-tolerance:1 with current=180, proposed=181 → pass
  let r = await runVerify('numeric-tolerance:1', { current: 180, proposed: 181 });
  assert(r.passed, 'numeric-tolerance:1 within → pass');

  r = await runVerify('numeric-tolerance:1', { current: 180, proposed: 200 });
  assert(!r.passed, 'numeric-tolerance:1 exceeds → fail');

  // numeric-tolerance with current null → bounds-sanity
  r = await runVerify('numeric-tolerance:1', { current: null, proposed: 175, bounds: [140, 230] });
  assert(r.passed, 'numeric-tolerance bounds-sanity in range → pass');
  r = await runVerify('numeric-tolerance:1', { current: null, proposed: 999, bounds: [140, 230] });
  assert(!r.passed, 'numeric-tolerance bounds-sanity out of range → fail');

  // completeness rule for fight_stats
  r = await runVerify('completeness', { fightStats: [{a: 1}, {a: 2}], round: 3 });
  assert(r.passed, 'completeness with 2 rows + plausible round → pass');
  r = await runVerify('completeness', { fightStats: [{a: 1}], round: 3 });
  assert(!r.passed, 'completeness with 1 row → fail');

  // parse rule
  const p = parseVerifyRule('numeric-tolerance:5');
  assert(p.kind === 'numeric-tolerance' && p.arg === 5, 'parseVerifyRule splits name and arg');

  return results;
}

module.exports = { run };
```

Wire into `tests/run.js`.

- [ ] **Step 2: Implement verify**

Create `data/backfill/verify.js`:

```js
/**
 * data/backfill/verify.js
 *
 * Each rule is async (some make HTTP HEAD requests). Returns { passed, reason? }.
 *
 * Rules:
 *   - 'numeric-tolerance:N' — proposed agrees with current within ±N; if current null, bounds-sanity check
 *   - 'url-200'             — proposed URL responds 200 to HEAD
 *   - 'completeness'        — fightStats array has 2 rows; round count plausible
 *   - 'cross-check:official_fight_outcomes' — caller must supply officialOutcome; mismatch → fail
 *   - 'second-source-or-review' — pass; gate handles single-source case as 'review'
 */
const { headOk } = require('../scrapers/http');

function parseVerifyRule(rule) {
  const [kind, argRaw] = (rule || '').split(':');
  const arg = argRaw == null ? null : (isNaN(+argRaw) ? argRaw : +argRaw);
  return { kind, arg };
}

async function runVerify(rule, ctx = {}) {
  const { kind, arg } = parseVerifyRule(rule);

  switch (kind) {
    case 'numeric-tolerance': {
      const tol = typeof arg === 'number' ? arg : 1;
      if (ctx.current === null || ctx.current === undefined) {
        const [lo, hi] = ctx.bounds || [-Infinity, Infinity];
        return ctx.proposed >= lo && ctx.proposed <= hi
          ? { passed: true }
          : { passed: false, reason: 'out of bounds' };
      }
      return Math.abs(ctx.proposed - ctx.current) <= tol
        ? { passed: true }
        : { passed: false, reason: `delta exceeds ±${tol}` };
    }
    case 'url-200': {
      const ok = await headOk(ctx.proposed);
      return ok ? { passed: true } : { passed: false, reason: 'HEAD non-200' };
    }
    case 'completeness': {
      const rows = Array.isArray(ctx.fightStats) ? ctx.fightStats.length : 0;
      const round = ctx.round || 0;
      if (rows !== 2) return { passed: false, reason: 'expected 2 fight_stats rows' };
      if (round < 1 || round > 5) return { passed: false, reason: 'implausible round count' };
      return { passed: true };
    }
    case 'cross-check': {
      if (!ctx.officialOutcome) return { passed: true, reason: 'no outcome to check' };
      const matches = ctx.officialOutcome.winner_id === ctx.proposed?.winner_id;
      return matches ? { passed: true } : { passed: false, reason: 'mismatch with official_fight_outcomes' };
    }
    case 'second-source-or-review':
      return { passed: true };
    default:
      return { passed: true, reason: `no rule ${kind}` };
  }
}

module.exports = { runVerify, parseVerifyRule };
```

- [ ] **Step 3: Run tests, expect pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add data/backfill/verify.js tests/backfill/verify.test.js tests/run.js
git commit -m "feat(backfill): verify rules (numeric-tolerance, url-200, completeness, cross-check)"
```

---

### Task 12: Backfill spec

**Files:**
- Create: `data/backfill/backfill-spec.js`

- [ ] **Step 1: Write spec**

Create `data/backfill/backfill-spec.js`:

```js
/**
 * data/backfill/backfill-spec.js
 *
 * Per-(table.column) safety class + source + verify rule. The dispatcher
 * uses this to decide how to handle each gap.
 *
 * For v1, only entries below are auto-handled. Other gaps surface in the
 * audit report but are not dispatched.
 */
module.exports = {
  // Fighter physicals — safe (one source, gap-only writes)
  'fighters.height_cm':    { source: 'ufcstats-fighter-page', safety: 'safe',     verify: 'numeric-tolerance:1', bounds: [140, 230] },
  'fighters.reach_cm':     { source: 'ufcstats-fighter-page', safety: 'safe',     verify: 'numeric-tolerance:1', bounds: [140, 230] },
  'fighters.stance':       { source: 'ufcstats-fighter-page', safety: 'safe',     verify: 'identity' },
  'fighters.dob':          { source: 'ufcstats-fighter-page', safety: 'safe',     verify: 'identity' },
  'fighters.weight_class': { source: 'ufcstats-fighter-page', safety: 'safe',     verify: 'identity' },

  // Fighter career stats — risky (single-source → review by gate; we fill anyway when current NULL? No — gate has 'safe' = null current → auto. We're using 'risky' here so it goes to review.)
  'fighters.slpm':         { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.str_acc':      { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.sapm':         { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.str_def':      { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.td_avg':       { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.td_acc':       { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.td_def':       { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.sub_avg':      { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },

  // Cosmetic
  'fighters.headshot_url': { source: 'ufc-com-athlete',       safety: 'cosmetic', verify: 'url-200' },
  'fighters.body_url':     { source: 'ufc-com-athlete',       safety: 'cosmetic', verify: 'url-200' },

  // Reconciliation — fights/winner/method/round and fight_stats
  'fights.winner_id':       { source: 'ufcstats-event-page', safety: 'reconcile', verify: 'cross-check:official_fight_outcomes' },
  'fights.method':          { source: 'ufcstats-event-page', safety: 'reconcile', verify: 'cross-check:official_fight_outcomes' },
  'fights.method_detail':   { source: 'ufcstats-event-page', safety: 'reconcile', verify: 'cross-check:official_fight_outcomes' },
  'fights.round':           { source: 'ufcstats-event-page', safety: 'reconcile', verify: 'cross-check:official_fight_outcomes' },
  'fights.time':            { source: 'ufcstats-event-page', safety: 'reconcile', verify: 'cross-check:official_fight_outcomes' },

  // Fight stats — safe (gap-fill only)
  'fight_stats.*':          { source: 'ufcstats-fight-page',  safety: 'safe',     verify: 'completeness' },
};
```

(Note: `verify: 'identity'` is a no-op rule that always passes; rule is parsed by `data/backfill/verify.js` — the default case returns `{ passed: true }`. This is intentional for free-text columns where no verify is meaningful.)

- [ ] **Step 2: Commit (no test — pure data)**

```bash
git add data/backfill/backfill-spec.js
git commit -m "feat(backfill): backfill spec with safety classes per column"
```

---

### Task 13: Dispatcher

**Files:**
- Create: `data/backfill/dispatcher.js`
- Create: `tests/backfill/dispatcher.test.js`

- [ ] **Step 1: Write failing dispatcher test**

Create `tests/backfill/dispatcher.test.js`:

```js
const db = require('../../db');
const { runBackfill } = require('../../data/backfill/dispatcher');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nBackfill Dispatcher:');

  await db.init();

  // Plant a fighter with NULL reach_cm + a fake ufcstats_hash
  const fixId = 9501;
  await db.run(`INSERT OR REPLACE INTO fighters (id, name, ufcstats_hash) VALUES (?, ?, ?)`,
    [fixId, 'DispatcherFixture', 'fakehash9501']);
  await db.run(`UPDATE fighters SET reach_cm = NULL WHERE id = ?`, [fixId]);

  // Plant a coverage_snapshots row with a fake run pointing at this fighter
  const runId = 'dispatcher-test-run';
  await db.run(`
    INSERT INTO coverage_snapshots (run_id, ran_at, table_name, column_name, scope, total_rows, non_null_rows, coverage_pct, gap_row_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [runId, new Date().toISOString(), 'fighters', 'reach_cm', 'all', 1, 0, 0.0, JSON.stringify([fixId])]);
  await db.run(`
    INSERT INTO audit_runs (run_id, started_at, status, trigger_source) VALUES (?, ?, ?, ?)
  `, [runId, new Date().toISOString(), 'complete', 'test']);

  // Use a fake scraper module — reach_cm = 175
  const scraperMocks = {
    'ufcstats-fighter-page': async () => ({ reach_cm: 175, height_cm: 170, source_url: 'http://test/fixture' }),
    'ufc-com-athlete':       async () => ({ headshot_url: null }),
  };

  const result = await runBackfill({ runId, scraperMocks });

  assert(typeof result === 'object', 'returns object');
  assert(result.auto >= 1 || result.queued >= 1, 'at least one decision recorded');

  // Either reach_cm was auto-written or queued. Verify via DB.
  const fr = await db.oneRow(`SELECT reach_cm FROM fighters WHERE id = ?`, [fixId]);
  const queueRows = await db.allRows(`SELECT * FROM pending_backfill WHERE table_name = ? AND row_id = ? AND column_name = ?`,
    ['fighters', String(fixId), 'reach_cm']);
  assert(queueRows.length >= 1, 'pending_backfill row created (auto-applied or pending)');
  if (queueRows[0].status === 'applied') {
    assert(fr.reach_cm === 175, 'fighter reach_cm auto-written');
  } else {
    assert(fr.reach_cm === null, 'fighter reach_cm not written until approved');
  }

  // Cleanup
  await db.run(`DELETE FROM pending_backfill WHERE table_name = ? AND row_id = ?`, ['fighters', String(fixId)]);
  await db.run(`DELETE FROM coverage_snapshots WHERE run_id = ?`, [runId]);
  await db.run(`DELETE FROM audit_runs WHERE run_id = ?`, [runId]);
  await db.run(`DELETE FROM fighters WHERE id = ?`, [fixId]);

  return results;
}

module.exports = { run };
```

Wire into `tests/run.js`.

- [ ] **Step 2: Run, expect failure**

Run: `npm test`
Expected: dispatcher module not found.

- [ ] **Step 3: Implement dispatcher**

Create `data/backfill/dispatcher.js`:

```js
/**
 * data/backfill/dispatcher.js
 *
 * Loads gaps from coverage_snapshots (or from a passed-in list), groups by
 * source, fetches each source once per row, applies the gate, and either
 * writes directly + logs (auto) or queues a pending_backfill row.
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
  // event/fight sources are added when reconciliation is wired in v1.x; for v1 they're stubs
  'ufcstats-event-page':   async () => null,
  'ufcstats-fight-page':   async () => null,
};

async function loadGaps(runId) {
  const rows = await db.allRows(`
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
  return db.oneRow(`SELECT id, name, ufcstats_hash, reach_cm, height_cm, slpm, str_acc, sapm, str_def, td_avg, td_acc, td_def, sub_avg, headshot_url, body_url, stance, dob, weight_class FROM fighters WHERE id = ?`, [rowId]);
}

async function logDecision({ table, rowId, column, current, proposed, source, sourceUrl, decision, reason, sourcesDiff, runId, applied }) {
  // Upsert pattern: insert; on conflict (partial unique index), update proposed_value
  const now = new Date().toISOString();
  const status = applied ? 'applied' : 'pending';
  const appliedAt = applied ? now : null;

  // Best-effort upsert: try insert; on failure (unique constraint), update existing pending row
  try {
    await db.run(`
      INSERT INTO pending_backfill
        (table_name, row_id, column_name, current_value, proposed_value, source, source_url, confidence, reason, source_diff_json, status, created_at, applied_at, audit_run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [table, String(rowId), column,
        current === null || current === undefined ? null : JSON.stringify(current),
        JSON.stringify(proposed),
        source, sourceUrl || null,
        decision, reason,
        sourcesDiff ? JSON.stringify(sourcesDiff) : null,
        status, now, appliedAt, runId || null]);
  } catch (e) {
    // If we hit the unique-open-row index, update the existing row's proposal
    await db.run(`
      UPDATE pending_backfill
      SET proposed_value = ?, source = ?, source_url = ?, confidence = ?, reason = ?, source_diff_json = ?, audit_run_id = ?
      WHERE table_name = ? AND row_id = ? AND column_name = ? AND status IN ('pending','approved')
    `, [JSON.stringify(proposed), source, sourceUrl || null, decision, reason,
        sourcesDiff ? JSON.stringify(sourcesDiff) : null, runId || null,
        table, String(rowId), column]);
  }
}

async function applyAutoWrite({ table, rowId, column, current, proposed }) {
  // Conditional UPDATE: only write if value still matches current (idempotency under races)
  if (current === null || current === undefined) {
    await db.run(`UPDATE ${table} SET ${column} = ? WHERE id = ? AND ${column} IS NULL`, [proposed, rowId]);
  } else {
    await db.run(`UPDATE ${table} SET ${column} = ? WHERE id = ? AND ${column} = ?`, [proposed, rowId, current]);
  }
}

async function runBackfill({ runId, dryRun = false, scraperMocks = null } = {}) {
  const gaps = await loadGaps(runId);
  const fetchers = scraperMocks || SOURCE_FETCHERS;

  let auto = 0, queued = 0, rejected = 0;
  const errors = [];

  // Group gaps by row_id+source so we fetch each source once per row
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
      if (!specEntry) continue;  // not auto-handled in v1

      // Load row context (for current value and source-fetcher inputs)
      let ctx = null;
      if (gap.table === 'fighters') ctx = await loadFighterContext(gap.row_id);
      // Other tables can be added in later tasks
      if (!ctx) continue;

      const current = ctx[gap.column] ?? null;

      // Fetch from primary source
      const srcResult = await fetchOnce(specEntry.source, ctx);
      if (!srcResult) continue;
      const proposed = srcResult[gap.column];
      if (proposed === undefined || proposed === null) continue;

      // Verify rule
      const verifyCtx = { current, proposed, bounds: specEntry.bounds };
      const verify = await runVerify(specEntry.verify, verifyCtx);

      // Sources list for risky-class
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
```

- [ ] **Step 4: Run tests, expect pass**

Run: `npm test`
Expected: PASS on dispatcher test (gate decides `auto` for safe + null current; row applied; pending_backfill row with status='applied').

- [ ] **Step 5: Commit**

```bash
git add data/backfill/dispatcher.js tests/backfill/dispatcher.test.js tests/run.js
git commit -m "feat(backfill): dispatcher with conditional auto-writes and pending queue"
```

---

### Task 14: Backfill HTTP endpoint

**Files:**
- Modify: `server.js`
- Create: `data/backfill/api.js`

- [ ] **Step 1: Implement query helpers**

Create `data/backfill/api.js`:

```js
const db = require('../../db');

async function listQueue({ status = 'pending', limit = 50, offset = 0 } = {}) {
  return db.allRows(`
    SELECT id, table_name, row_id, column_name, current_value, proposed_value, source, source_url, confidence, reason, source_diff_json, status, created_at, resolved_at, applied_at, audit_run_id
    FROM pending_backfill
    WHERE status = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [status, Math.min(parseInt(limit, 10) || 50, 500), parseInt(offset, 10) || 0]);
}

module.exports = { listQueue };
```

- [ ] **Step 2: Register routes in server.js**

After the audit routes added in Task 4, add:

```js
const backfillApi = require('./data/backfill/api');
const { runBackfill } = require('./data/backfill/dispatcher');

app.post('/api/data/backfill/run', requirePredictionKey, apiHandler(async (req, res) => {
  const runId = req.body?.runId ? String(req.body.runId).slice(0, 64) : null;
  const dryRun = !!(req.body?.dryRun);
  if (!runId) return res.status(400).json({ error: 'runId required' });
  const result = await runBackfill({ runId, dryRun });
  res.json(result);
}));

app.get('/api/data/backfill/queue', requirePredictionKey, apiHandler(async (req, res) => {
  const status = req.query.status ? String(req.query.status).slice(0, 32) : 'pending';
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  res.json(await backfillApi.listQueue({ status, limit, offset }));
}));
```

- [ ] **Step 3: Smoke test**

```bash
PREDICTION_SERVICE_KEY=devkey npm start &
sleep 2
# Need a recent audit run first
curl -s -X POST -H "x-prediction-key: devkey" http://localhost:3000/api/data/audit/run > /tmp/audit.json
RUN_ID=$(cat /tmp/audit.json | grep -o '"run_id":"[^"]*"' | head -1 | sed 's/.*:"\(.*\)"/\1/')
echo "audit run_id=$RUN_ID"
curl -s -X POST -H "x-prediction-key: devkey" -H "Content-Type: application/json" \
  -d "{\"runId\": \"$RUN_ID\", \"dryRun\": true}" \
  http://localhost:3000/api/data/backfill/run | head -c 500
echo
curl -s -H "x-prediction-key: devkey" 'http://localhost:3000/api/data/backfill/queue?status=pending' | head -c 500
```

Expected: backfill returns `{auto, queued, rejected, errors}`; queue returns array (possibly empty on first run).

- [ ] **Step 4: Commit**

```bash
git add server.js data/backfill/api.js
git commit -m "feat(backfill): /api/data/backfill/run and queue endpoints"
```

---

### Task 15: Backfill CLI

**Files:**
- Create: `scripts/backfill-run.js`
- Modify: `package.json` (add `backfill` script)

- [ ] **Step 1: Write CLI**

Create `scripts/backfill-run.js`:

```js
#!/usr/bin/env node
const db = require('../db');
const { runBackfill } = require('../data/backfill/dispatcher');
const auditApi = require('../data/audit/api');

function parseArgs(argv) {
  const out = { run: null, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--run=')) out.run = a.slice('--run='.length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  await db.init();
  let runId = args.run;
  if (!runId) runId = await auditApi.getLatestCompleteRunId();
  if (!runId) {
    console.error('No audit run found. Run `npm run audit` first.');
    process.exit(2);
  }
  console.log(`Backfilling against run_id=${runId} dry_run=${args.dryRun}`);
  const result = await runBackfill({ runId, dryRun: args.dryRun });
  console.log(`\nBackfill: auto=${result.auto} queued=${result.queued} rejected=${result.rejected} errors=${result.errors.length}`);
  for (const e of result.errors) console.log(`  ERR ${e.gap.table}.${e.gap.column} id=${e.gap.row_id}: ${e.error}`);
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

In `package.json` scripts:

```json
"backfill": "node scripts/backfill-run.js"
```

- [ ] **Step 3: Smoke test**

```bash
npm run audit
npm run backfill -- --dry-run
```

Expected: dry-run prints proposed actions; nothing written.

```bash
npm run backfill
```

Expected: auto-writes happen; review queue populated.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-run.js package.json
git commit -m "feat(backfill): npm run backfill CLI with --dry-run"
```

---

### Task 16: Review CLI

**Files:**
- Create: `scripts/backfill-review.js`
- Modify: `package.json` (add `backfill:review`)

- [ ] **Step 1: Implement review CLI**

Create `scripts/backfill-review.js`:

```js
#!/usr/bin/env node
const readline = require('readline');
const db = require('../db');
const { runVerify } = require('../data/backfill/verify');

function parseArgs(argv) {
  const out = { autoApproveCosmetic: false };
  for (const a of argv.slice(2)) {
    if (a === '--auto-approve-cosmetic') out.autoApproveCosmetic = true;
  }
  return out;
}

function prompt(rl, q) {
  return new Promise(resolve => rl.question(q, ans => resolve(ans.trim().toLowerCase())));
}

function parseValue(jsonStr) {
  if (jsonStr === null || jsonStr === undefined) return null;
  try { return JSON.parse(jsonStr); } catch { return jsonStr; }
}

async function applyApproved(row) {
  const proposed = parseValue(row.proposed_value);
  const expected = parseValue(row.current_value);

  // Re-check current
  const r = await db.oneRow(`SELECT ${row.column_name} AS v FROM ${row.table_name} WHERE id = ?`, [row.row_id]);
  if (!r) {
    await db.run(`UPDATE pending_backfill SET status='superseded', resolved_at=? WHERE id=?`, [new Date().toISOString(), row.id]);
    return { applied: false, reason: 'row no longer exists' };
  }
  const cur = r.v;
  if ((expected ?? null) !== (cur ?? null)) {
    await db.run(`UPDATE pending_backfill SET status='superseded', resolved_at=? WHERE id=?`, [new Date().toISOString(), row.id]);
    return { applied: false, reason: 'current value changed since queue entry' };
  }

  // Conditional write
  if (cur === null || cur === undefined) {
    await db.run(`UPDATE ${row.table_name} SET ${row.column_name} = ? WHERE id = ? AND ${row.column_name} IS NULL`, [proposed, row.row_id]);
  } else {
    await db.run(`UPDATE ${row.table_name} SET ${row.column_name} = ? WHERE id = ? AND ${row.column_name} = ?`, [proposed, row.row_id, cur]);
  }
  await db.run(`UPDATE pending_backfill SET status='applied', applied_at=?, resolved_at=? WHERE id=?`,
    [new Date().toISOString(), new Date().toISOString(), row.id]);
  return { applied: true };
}

async function main() {
  const args = parseArgs(process.argv);
  await db.init();
  const rows = await db.allRows(`SELECT * FROM pending_backfill WHERE status='pending' ORDER BY created_at`);
  if (rows.length === 0) {
    console.log('Queue empty.');
    process.exit(0);
  }

  // Fast-path: auto-approve cosmetic
  if (args.autoApproveCosmetic) {
    let applied = 0, skipped = 0;
    for (const r of rows) {
      // Cosmetic rows have safety classified by spec; we infer from confidence='auto' OR a column convention.
      // Conservative: only auto-approve rows whose source is ufc-com-athlete and column ends with _url
      const cosmetic = r.source === 'ufc-com-athlete' && /_url$/.test(r.column_name);
      if (!cosmetic) { skipped++; continue; }
      const res = await applyApproved(r);
      if (res.applied) applied++;
      else console.log(`  skip: ${r.table_name}.${r.column_name} id=${r.row_id} (${res.reason})`);
    }
    console.log(`Auto-approved cosmetic: applied=${applied} skipped=${skipped}`);
    process.exit(0);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let i = 0;
  for (const r of rows) {
    i++;
    console.log(`\n[${i} of ${rows.length}] ${r.table_name}.${r.column_name}  id=${r.row_id}`);
    console.log(`  current:  ${r.current_value === null ? 'NULL' : r.current_value}`);
    console.log(`  proposed: ${r.proposed_value}  (source: ${r.source}${r.source_url ? ', ' + r.source_url : ''})`);
    console.log(`  reason:   ${r.reason || ''}`);
    const ans = await prompt(rl, '  [a]pprove  [r]eject  [s]kip  [d]etails  [q]uit: ');
    if (ans === 'q') break;
    if (ans === 's') continue;
    if (ans === 'd') {
      console.log(JSON.stringify({ ...r, source_diff: parseValue(r.source_diff_json) }, null, 2));
      i--;  // re-show
      continue;
    }
    if (ans === 'a') {
      const res = await applyApproved(r);
      console.log(res.applied ? '  ✓ applied' : `  ✗ ${res.reason}`);
    }
    if (ans === 'r') {
      await db.run(`UPDATE pending_backfill SET status='rejected', resolved_at=? WHERE id=?`,
        [new Date().toISOString(), r.id]);
      console.log('  ✗ rejected');
    }
  }
  rl.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Add npm script**

In `package.json`:

```json
"backfill:review": "node scripts/backfill-review.js"
```

- [ ] **Step 3: Smoke test**

```bash
npm run audit
npm run backfill
npm run backfill:review
```

Expected: review prompt walks the queue. Try `a/r/s/d/q`.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-review.js package.json
git commit -m "feat(backfill): interactive npm run backfill:review CLI"
```

---

## Phase 5 — Scheduler

### Task 17: Scheduler module

**Files:**
- Create: `data/audit/scheduler.js`
- Modify: `package.json` (add `node-cron` dep)

- [ ] **Step 1: Add node-cron dep**

```bash
npm install node-cron@^3
```

This will modify `package.json` and `package-lock.json`.

- [ ] **Step 2: Implement scheduler**

Create `data/audit/scheduler.js`:

```js
/**
 * data/audit/scheduler.js
 *
 * Wires node-cron triggers to runAudit + runBackfill. Each trigger holds a
 * mutex to skip overlapping runs. Polls events table for the post-event
 * windows since end times aren't precise.
 */
const cron = require('node-cron');
const db = require('../../db');
const { runAudit } = require('./runner');
const { runBackfill } = require('../backfill/dispatcher');

const mutexes = new Map();

async function withMutex(key, fn) {
  if (mutexes.get(key)) {
    console.log(`[scheduler] skip ${key}: already running`);
    return;
  }
  mutexes.set(key, true);
  try { await fn(); }
  finally { mutexes.delete(key); }
}

async function trigger(triggerKey, scopeArg = null) {
  const audit = await runAudit({ scope: scopeArg, triggerSource: triggerKey });
  if (audit.status === 'error') {
    console.warn(`[scheduler] ${triggerKey} audit error; skipping backfill`);
    return audit;
  }
  const backfill = await runBackfill({ runId: audit.run_id });
  console.log(`[scheduler] ${triggerKey} run=${audit.run_id} audit=${audit.summary.length} bf:auto=${backfill.auto} q=${backfill.queued} r=${backfill.rejected}`);
  return { audit, backfill };
}

function nightlySweep() {
  // 03:00 daily (server-local TZ — Railway is UTC; if you want ET, set process.env.TZ to 'America/New_York' at boot)
  return cron.schedule('0 3 * * *', () => withMutex('nightly', () => trigger('cron:nightly')));
}

function preEventDaily() {
  // 04:00 daily — fires for events 6-8d out and 0-1d out
  return cron.schedule('0 4 * * *', () => withMutex('pre-event', async () => {
    const upcoming = await db.allRows(`
      SELECT id, name, date FROM events
      WHERE date IN (date('now', '+1 day'), date('now', '+7 day'), date('now', '+8 day'))
    `);
    for (const ev of upcoming) {
      await trigger('cron:pre-event', `event:${ev.id}`);
    }
  }));
}

function postEventPoller() {
  // 5-min polling for events that ended in the last hour
  const triggeredToday = new Set();
  return cron.schedule('*/5 * * * *', () => withMutex('post-event-poll', async () => {
    const today = await db.allRows(`SELECT id, end_time, date FROM events WHERE date = date('now')`);
    for (const ev of today) {
      if (!ev.end_time) continue;
      const endTs = Date.parse(ev.end_time);
      if (isNaN(endTs)) continue;
      const ageMs = Date.now() - endTs;
      if (ageMs > 0 && ageMs < 60 * 60 * 1000 && !triggeredToday.has(ev.id)) {
        triggeredToday.add(ev.id);
        await trigger('cron:post-event-1h', `event:${ev.id}`);
      }
    }
  }));
}

function postEventT24() {
  // 05:00 daily — fires for events that ended 20-28h ago
  return cron.schedule('0 5 * * *', () => withMutex('post-event-24h', async () => {
    const events = await db.allRows(`
      SELECT id FROM events WHERE date = date('now', '-1 day')
    `);
    for (const ev of events) {
      await trigger('cron:post-event-24h', `event:${ev.id}`);
    }
  }));
}

function startScheduler() {
  // Skipped in tests / when explicitly disabled
  if (process.env.AUDIT_SCHEDULER === 'off') {
    console.log('[scheduler] disabled by AUDIT_SCHEDULER=off');
    return [];
  }
  return [nightlySweep(), preEventDaily(), postEventPoller(), postEventT24()];
}

module.exports = { startScheduler, trigger };
```

- [ ] **Step 3: Hook scheduler into server.js**

In `server.js`, near the bottom, after `app.listen` (or wherever the server starts):

```js
const { startScheduler } = require('./data/audit/scheduler');
if (process.env.NODE_ENV !== 'test' && process.env.AUDIT_SCHEDULER !== 'off') {
  startScheduler();
}
```

- [ ] **Step 4: Smoke test scheduler in dev**

```bash
AUDIT_SCHEDULER=on PREDICTION_SERVICE_KEY=devkey npm start
# Wait — verify no errors at startup. Cron won't fire for hours.
```

Expected: server boots cleanly; logs show no scheduler errors. Cron jobs are registered.

- [ ] **Step 5: Commit**

```bash
git add data/audit/scheduler.js server.js package.json package-lock.json
git commit -m "feat(audit): node-cron scheduler with nightly + pre/post-event triggers"
```

---

## Phase 6 — Integration & Docs

### Task 18: End-to-end integration test

**Files:**
- Create: `tests/audit/integration.test.js`

- [ ] **Step 1: Write end-to-end test**

Create `tests/audit/integration.test.js`:

```js
const db = require('../../db');
const { runAudit } = require('../../data/audit/runner');
const { runBackfill } = require('../../data/backfill/dispatcher');

async function run() {
  const results = { passed: 0, failed: 0 };
  const assert = (cond, name) => {
    if (cond) { results.passed++; console.log(`  ✓ ${name}`); }
    else { results.failed++; console.error(`  ✗ ${name}`); }
  };

  console.log('\nAudit + Backfill End-to-End:');

  await db.init();

  // Plant a fighter with a NULL reach_cm and a known hash (mocked scraper return)
  const fid = 9701;
  await db.run(`INSERT OR REPLACE INTO fighters (id, name, ufcstats_hash, reach_cm) VALUES (?, ?, ?, NULL)`,
    [fid, 'IntegrationFixture', 'inthash9701']);

  // Run a tiny audit just for fighters.reach_cm/all
  const spec = [{ table: 'fighters', column: 'reach_cm', scopes: ['all'] }];
  const audit = await runAudit({ spec, triggerSource: 'integration-test' });
  assert(audit.status === 'complete', 'audit status complete');
  assert(audit.summary[0].non_null_rows < audit.summary[0].total_rows, 'gaps detected');

  // Backfill with a mock scraper that returns reach_cm=180
  const scraperMocks = {
    'ufcstats-fighter-page': async () => ({ reach_cm: 180, source_url: 'http://test/integration' }),
  };
  const bf1 = await runBackfill({ runId: audit.run_id, scraperMocks });
  assert(bf1.auto >= 1, 'first backfill auto-wrote at least one row');

  // Verify the row was filled
  const f1 = await db.oneRow(`SELECT reach_cm FROM fighters WHERE id = ?`, [fid]);
  assert(f1.reach_cm === 180, 'reach_cm=180 after backfill');

  // Idempotency: re-running backfill produces no new auto writes (column is filled)
  const audit2 = await runAudit({ spec, triggerSource: 'integration-test' });
  const bf2 = await runBackfill({ runId: audit2.run_id, scraperMocks });
  assert(bf2.auto === 0 || bf2.auto === undefined, 're-run produces zero new auto writes');

  // Cleanup
  await db.run(`DELETE FROM pending_backfill WHERE table_name = 'fighters' AND row_id = ?`, [String(fid)]);
  await db.run(`DELETE FROM coverage_snapshots WHERE run_id IN (?, ?)`, [audit.run_id, audit2.run_id]);
  await db.run(`DELETE FROM audit_runs WHERE run_id IN (?, ?)`, [audit.run_id, audit2.run_id]);
  await db.run(`DELETE FROM fighters WHERE id = ?`, [fid]);

  return results;
}

module.exports = { run };
```

Wire into `tests/run.js`.

- [ ] **Step 2: Run, expect pass**

Run: `npm test`
Expected: PASS on all 4 integration assertions.

- [ ] **Step 3: Commit**

```bash
git add tests/audit/integration.test.js tests/run.js
git commit -m "test(audit): end-to-end audit+backfill+idempotency integration test"
```

---

### Task 19: README updates

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Append a new section to README.md**

In `README.md`, find the section listing ETL/data scripts and after it append:

```markdown
## Data audit & backfill

Coverage of every audited column lives in `coverage_snapshots`. A confidence-gated backfill executor fills safe gaps directly and queues risky ones for CLI review.

Run an audit and read the report:

    npm run audit
    curl -H "x-prediction-key: $KEY" http://localhost:3000/api/data/coverage?diff=last2

Run backfill against the latest audit:

    npm run backfill                 # auto + queue
    npm run backfill -- --dry-run    # preview only

Review the queue interactively:

    npm run backfill:review
    npm run backfill:review -- --auto-approve-cosmetic

The scheduler runs automatically on server boot (disable with `AUDIT_SCHEDULER=off`):

| Trigger | When | Scope |
|---|---|---|
| Nightly sweep | 03:00 daily | all columns |
| Pre-event | 04:00 daily | events 7d / 1d out |
| Post-event 1h | every 5 min | events ending in last hour |
| Post-event 24h | 05:00 daily | events that ended yesterday |

Manual HTTP endpoints (require `x-prediction-key`):

- `POST /api/data/audit/run`
- `POST /api/data/backfill/run` body `{runId, dryRun?}`
- `GET  /api/data/coverage` (`?run=`, `?table=&column=`, `?diff=last2`)
- `GET  /api/data/backfill/queue?status=pending`

See the design doc at `docs/superpowers/specs/2026-04-29-etl-data-gap-audit-and-backfill-design.md` for source precedence, gate rules, and v1 scope.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(readme): document audit + backfill commands and endpoints"
```

---

## Self-Review

### Spec coverage check

- ✅ Schema: `coverage_snapshots`, `audit_runs`, `pending_backfill` (Task 1).
- ✅ Coverage spec, scopes resolver, runner with gap sampling and per-entry transactions (Tasks 2–3).
- ✅ `/api/data/coverage` with `?run=`, `?table=&column=`, `?diff=last2` (Task 4).
- ✅ `npm run audit` CLI (Task 5).
- ✅ Scraper module extraction for ufcstats-fighter, ufcstats-event, ufcstats-fight, ufc-com-athlete (Tasks 6–9). Note: `ufc-com-event.js` mentioned in the spec's file-level changes is **not** in this plan because v1 backfill scope (per the spec's narrow v1) doesn't auto-handle event metadata; if the audit shows event gaps, they surface in the report only. If you want to also extract that parser proactively, add it as a Task 9.5 mirroring Task 9.
- ✅ Confidence gate, verify rules, backfill spec, dispatcher (Tasks 10–13).
- ✅ `/api/data/backfill/run` + `/queue` endpoints (Task 14).
- ✅ `npm run backfill` and `npm run backfill:review` CLIs (Tasks 15–16).
- ✅ Scheduler with mutex + four triggers (Task 17).
- ✅ End-to-end integration test (Task 18).
- ✅ README updates (Task 19).

### Type / signature consistency

- `runAudit({ spec?, scope?, triggerSource? })` — used consistently across runner, CLI, HTTP, scheduler.
- `runBackfill({ runId, dryRun?, scraperMocks? })` — same signature in dispatcher.test, integration.test, scheduler, CLI, HTTP endpoint.
- `decide({ safety, current, proposed, sources, verifyPassed, ambiguousIdentity })` — gate.test and dispatcher pass the same shape.
- `runVerify(rule, ctx)` returns `{ passed, reason? }` — consistent in verify.test and dispatcher.
- Scope strings (`'all'`, `'upcoming-roster'`, `'completed'`, etc.) match between coverage-spec, scopes resolver, and audit runner output.

### Notes on tradeoffs taken

1. **`ufc-com-event.js` deferred.** The spec lists it under file-level changes but v1 backfill doesn't write event metadata (the spec's "narrow v1" only auto-fills the three gap categories). Including the file purely to back the audit's event scope read-side isn't necessary — events are already in the DB by other means. If you want it, add a parallel task before Task 17.
2. **Reconcile path is 'review'-only in v1.** Per gate semantics, `safety: 'reconcile'` always returns `review`. This mirrors the spec's "writes go through `official_fight_outcomes` first; existing reconciliation code remains the sole writer". The dispatcher therefore queues reconcile rows with reason "reconcile path: defer to outcomes pipeline" — operationally a flag that the existing reconciliation code (`data/scrape-results.js`) needs to run, not that the user has to approve each one. If you want auto-promotion of reconcile rows once `official_fight_outcomes` is populated, add a v1.x task that reads `official_fight_outcomes` and propagates to `fights` (this is already the existing reconciliation pattern; just may need to be wired into the dispatcher).
3. **SQLite partial index fallback.** Task 1 includes a trigger-based fallback if sql.js doesn't support `WHERE` in unique indexes. Run the test and pick the path that works.
4. **`__row__` sentinel.** The runner treats `column='__row__'` as row-existence. The coverage-spec uses it for `round_stats`, `official_fight_outcomes`, `predictions`. Audit runner Task 3 includes the test for it.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-29-etl-data-gap-audit-and-backfill.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
