# ETL — Data Gap Audit and Automated Backfill

**Date:** 2026-04-29
**Status:** Design approved; pending implementation plan

## Goal

Give the project two things it doesn't have today:

1. **Audit visibility** — a per-table, per-column, per-scope coverage report with history so we can see at a glance what's missing and detect regressions when a scraper silently breaks.
2. **Automated backfill** — a confidence-gated executor that fills gaps using the existing scrapers, writing safe values directly and queuing risky/ambiguous proposals for one-click human review via CLI.

Coverage priorities are weighted across three consumers: prediction features (LR + ensemble), user-facing UI, and post-event reconciliation.

## Non-goals (v1)

- No web admin UI for the review queue. CLI only.
- No alerting/notifications (Slack, email). Read regressions from the coverage diff endpoint.
- No cross-source reconciliation when sources silently agree on the same wrong value.
- No new scraper sources. v1 wraps the existing ufcstats.com / ufc.com scrapers as libraries.
- No port of the JS scrapers into the python `llm-pipeline`.

## Architecture

Three new pieces, all Node, all inside the main Railway app:

```
                ┌────────────────────────────────────────────────┐
                │  Node main app (Railway)                       │
                │                                                │
   schedule ──► │  data/audit/ ── runAudit() ──► Postgres        │
   (node-cron) │  data/backfill/ ── runBackfill() ──► dispatch  │
   + manual    │     │                              │            │
   triggers    │     ▼                              ▼            │
                │  /api/data/coverage    spawn data/scrape*.js   │
                │  (read coverage_       OR call llm-pipeline    │
                │   snapshots)              REST trigger         │
                └────────────────────────────────────────────────┘
                              │                    │
                              ▼                    ▼
                       ┌─────────────┐     ┌──────────────────┐
                       │ Postgres    │     │ Existing JS      │
                       │  + audit    │     │  scrapers, plus  │
                       │  tables     │     │  llm-pipeline    │
                       └─────────────┘     └──────────────────┘
```

- **Audit module** (`data/audit/`) — read-only SQL pass; writes `coverage_snapshots`; serves `/api/data/coverage`.
- **Backfill executor** (`data/backfill/`) — given gap rows, dispatches the right scraper, runs the confidence gate, writes directly OR queues to `pending_backfill`.
- **Scheduler** — `node-cron` for nightly + event-window triggers; HTTP endpoints for manual triggers.

The python `llm-pipeline` is unchanged. Audit reads its output columns like any other table; if a soft-signal gap shows up, the dispatcher hits the existing `POST /trigger/enrich` endpoint.

## New schema

```sql
CREATE TABLE coverage_snapshots (
  id BIGSERIAL PRIMARY KEY,
  run_id TEXT NOT NULL,
  ran_at TIMESTAMPTZ NOT NULL,
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  scope TEXT NOT NULL,              -- 'all' | 'upcoming' | 'completed' | 'event:<id>' | etc.
  total_rows INTEGER NOT NULL,
  non_null_rows INTEGER NOT NULL,
  coverage_pct DOUBLE PRECISION NOT NULL,
  gap_row_ids JSONB                 -- ≤50 sample row ids missing the column
);
CREATE INDEX idx_coverage_run ON coverage_snapshots(run_id);
CREATE INDEX idx_coverage_table_col ON coverage_snapshots(table_name, column_name, ran_at DESC);

CREATE TABLE audit_runs (
  run_id TEXT PRIMARY KEY,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',  -- 'running' | 'complete' | 'partial' | 'error'
  trigger_source TEXT NOT NULL,            -- 'cron:nightly' | 'cron:pre-event' | 'http' | 'cli' | etc.
  scope_input JSONB,
  summary JSONB,
  error_text TEXT
);

CREATE TABLE pending_backfill (
  id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  row_id TEXT NOT NULL,                    -- text so it works for compound keys
  column_name TEXT NOT NULL,
  current_value TEXT,                      -- JSON-encoded
  proposed_value TEXT NOT NULL,            -- JSON-encoded
  source TEXT NOT NULL,                    -- 'ufcstats' | 'ufc.com' | etc.
  source_url TEXT,
  confidence TEXT NOT NULL,                -- 'auto' | 'review' | 'reject'
  reason TEXT,
  source_diff_json JSONB,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected' | 'applied' | 'superseded'
  created_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  audit_run_id TEXT
);
CREATE INDEX idx_pending_status ON pending_backfill(status);
CREATE UNIQUE INDEX uq_pending_open ON pending_backfill(table_name, row_id, column_name)
  WHERE status IN ('pending', 'approved');
```

The unique partial index keeps a single open proposal per (row, column); re-running audit doesn't duplicate the queue.

## Audit subsystem

### Coverage spec

`data/audit/coverage-spec.js` is the single declarative source for what gets audited:

```js
module.exports = [
  { table: 'fighters', column: 'height_cm',  scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'reach_cm',   scopes: ['all', 'upcoming-roster'] },
  { table: 'fighters', column: 'slpm',       scopes: ['all', 'upcoming-roster'] },
  { table: 'events',   column: 'venue',      scopes: ['all', 'upcoming'] },
  { table: 'fights',   column: 'winner_id',  scopes: ['completed'] },
  { table: 'fight_stats', column: 'sig_str_landed', scopes: ['completed-fights'] },
  // ~40 entries; full list in section "v1 audit coverage"
];
```

### Scopes

`data/audit/scopes.js` registers SQL fragments. Examples:

- `all` — no filter.
- `upcoming` — `events WHERE date >= CURRENT_DATE`.
- `upcoming-roster` — fighters appearing in fights of upcoming events.
- `completed` — `events WHERE date < CURRENT_DATE`.
- `completed-fights` — fights of completed events.
- `upcoming-fights` — fights of upcoming events.
- `event:<id>` — restricted to one event id, computed at audit time.

New scopes are one-line additions.

### Runner

`data/audit/runner.js`:

- Loops the spec; for each (column × scope) builds a `SELECT count(*) FILTER (WHERE col IS NOT NULL) ...` against the scope join.
- Persists one `coverage_snapshots` row per (column × scope), with up to 50 sample gap row ids in `gap_row_ids` JSONB.
- Each spec entry is its own transaction so partial runs still produce useful data.
- Returns `{ run_id, summary, duration_ms }`.

### v1 audit coverage

| Table | Columns | Scopes |
|---|---|---|
| `fighters` | `height_cm, reach_cm, stance, dob, weight_class, nationality, slpm, str_acc, sapm, str_def, td_avg, td_acc, td_def, sub_avg, headshot_url, body_url, ufcstats_hash` | `all`, `upcoming-roster` |
| `events` | `date, venue, city, country, start_time, end_time, timezone` | `all`, `upcoming` |
| `fights` | `winner_id, method, method_detail, round, time, has_stats` | `completed` |
| `fight_stats` | `sig_str_landed, sig_str_attempted, total_str_landed, takedowns_landed, knockdowns, sub_attempts, control_time_sec, head_landed, body_landed, leg_landed, distance_landed, clinch_landed, ground_landed` | `completed-fights` |
| `round_stats` | row-existence per `(fight_id, fighter_id, round)` | `completed-fights` |
| `official_fight_outcomes` | row-existence per fight | `completed-fights` |
| `predictions` | row-existence per upcoming fight; `enrichment_level` distribution | `upcoming-fights` |

~40 spec rows × 2 scopes ≈ 80 `coverage_snapshots` rows per run.

### Endpoint

`GET /api/data/coverage` (auth: `x-prediction-key`):

- `?run=latest` (default) — most recent complete run.
- `?run=<run_id>` — specific run.
- `?table=fighters&column=reach_cm` — last 30 runs for that column × scope.
- `?diff=last2` — coverage_pct delta between the two most recent complete runs per (column × scope). The "did a scraper just break" view.

### Bootstrap note

The first audit will show many columns at <100% that have always been incomplete and aren't fixable (defunct events, very old fighters). The `diff=last2` view is the practical day-to-day surface; absolute coverage is mostly background.

## Backfill subsystem

### Backfill spec

`data/backfill/backfill-spec.js` is paired with the coverage spec:

```js
module.exports = {
  'fighters.height_cm':    { source: 'ufcstats-fighter-page', safety: 'safe',     verify: 'numeric-tolerance:1' },
  'fighters.reach_cm':     { source: 'ufcstats-fighter-page', safety: 'safe',     verify: 'numeric-tolerance:1' },
  'fighters.slpm':         { source: 'ufcstats-fighter-page', safety: 'risky',    verify: 'second-source-or-review' },
  'fighters.headshot_url': { source: 'ufc-com-athlete',       safety: 'cosmetic', verify: 'url-200' },
  'fights.winner_id':      { source: 'ufcstats-event-page',   safety: 'reconcile',verify: 'cross-check:official_fight_outcomes' },
  'fight_stats.*':         { source: 'ufcstats-fight-page',   safety: 'safe',     verify: 'completeness' },
  // ...
};
```

Adding a new gap type = one row.

### Confidence gate

`data/backfill/gate.js`. Every proposed write is classified:

| Rule | Decision |
|---|---|
| `safety: 'cosmetic'` and `verify` passes | **auto** |
| `safety: 'safe'`, current NULL, proposed present | **auto** |
| `safety: 'safe'`, proposed differs from non-NULL current | **review** (reason: "overwrite of existing value") |
| `safety: 'risky'`, single source | **review** (reason: "single-source for risky column") |
| `safety: 'risky'`, two sources agree within tolerance | **auto** |
| `safety: 'risky'`, sources disagree | **review** (reason: "source disagreement"; `source_diff_json` populated) |
| `safety: 'reconcile'` | always written through `official_fight_outcomes` first, then propagated to `fights` via existing reconciliation code |
| Fighter match ambiguous (>1 row matches by name) | **reject** (queued, never auto-promoted) |

Every gate decision — including `auto` — gets a `pending_backfill` row (status `applied` for autos, with `applied_at` set) for full audit trail.

### Dispatcher

`data/backfill/dispatcher.js`:

```
runBackfill({ runId?, scope?, dryRun? }) →
  load gap_row_ids from latest coverage_snapshots (or for runId)
  group gaps by source
  for each source, batch-fetch (re-using extracted scraper modules)
  for each (row, column) gap:
    proposed = extractFromSource(...)
    decision = gate(spec, currentValue, proposed, sources)
    if 'auto'    → write to target table, log to pending_backfill (status='applied')
    if 'review'  → upsert pending_backfill (status='pending')
    if 'reject'  → upsert pending_backfill (status='pending', reason set)
  return { auto: N, queued: M, rejected: K, errors: [...] }
```

**Per-run gap throughput:** `coverage_snapshots.gap_row_ids` stores at most 50 sample row ids per (column × scope), so each backfill run processes up to 50 gaps per column × scope — not the full long tail. This is intentional for v1: it bounds run duration, rate-limits external sources, and gives the nightly sweep multiple days to chip away at large historical backlogs. Event-window triggers usually have far fewer than 50 gaps per column for one event, so they're unaffected.

### Scraper module extraction

The dispatcher needs scrapers as libraries, not CLIs. v1 extracts the parsing functions out of `data/scrape.js`, `data/scrape-upcoming.js`, `data/scrape-results.js` into pure modules under `data/scrapers/` (e.g., `data/scrapers/ufcstats-fighter.js` exporting `fetchFighter(hash)`). The existing CLIs become thin wrappers over those modules. This is the only refactor of existing code in v1; everything else is additive.

### Source precedence

| Field class | Authoritative | Tiebreaker |
|---|---|---|
| Career stats (slpm, str_acc, etc.) | `ufcstats.com` fighter page | None — single source in v1; gate's other rules handle anomalies |
| Physicals (height/reach/stance/dob) | `ufcstats.com` fighter page | Disagreement with `ufc.com` (if fetched) → **review** |
| Headshot URL | `ufc.com/athlete` | Single source |
| Event metadata (date, venue, location, timezone) | `ufcstats.com` for completed; `ufc.com` for upcoming | Both available + disagree → **review** |
| Fight results (winner, method, round, time) | `ufcstats.com` event/fight page | Cross-check `official_fight_outcomes`; mismatch → **review** (never auto-overwrite) |
| Fighter identity | `fighters.ufcstats_hash` if both sides have it; else normalized name match | Multiple matches → **reject** (queued) |

### Verify rules (write-time guard)

- `numeric-tolerance:N` — `|proposed - current| <= N` if current non-NULL; else bounds-sanity check.
- `url-200` — HEAD request returns 200.
- `completeness` (for `fight_stats`) — both fighter rows present, required columns non-NULL, plausible round count.
- `cross-check:official_fight_outcomes` — if the row exists and disagrees, demote to review.

Verify failure on a previously-`auto` row demotes it to `review`.

### v1 auto-backfill scope (narrow)

Only three gap categories are auto-handled in v1. Everything else surfaces in the audit report and waits for v2.

| # | Gap type | Source | Safety | Verify |
|---|---|---|---|---|
| 1 | Fighter career stats (slpm/str_acc/sapm/str_def/td_avg/td_acc/td_def/sub_avg) for upcoming-roster fighters | `ufcstats-fighter-page` | risky | second-source-or-review |
| 2 | Fighter profile basics (height_cm/reach_cm/stance/dob/weight_class/headshot_url) for upcoming-roster fighters | `ufcstats-fighter-page` + `ufc-com-athlete` (headshot only) | safe + cosmetic | numeric-tolerance:1; url-200 |
| 3 | Fight results & stats for completed fights missing them (`fights.winner_id/method/round`, `fight_stats.*`, `round_stats` row-existence, `official_fight_outcomes`) | `ufcstats-event-page` + `ufcstats-fight-page` | reconcile | completeness; cross-check |

### Review CLI

`scripts/backfill-review.js` → `npm run backfill:review`:

```
[3 of 17] fighters.reach_cm  fighter_id=842 (Ilia Topuria)
  current:  NULL
  proposed: 175  (source: ufcstats-fighter-page, http://ufcstats.com/fighter/abc123)
  reason:   safe-column gap fill
  [a]pprove  [r]eject  [s]kip  [d]etails  [q]uit
```

Approving runs the write inline with the same gate's verify check at write time. Rejecting marks `status='rejected'`. `--auto-approve-cosmetic` flag bulk-approves cosmetic-tier entries.

## Triggers

All triggers call the same `runAudit()` and `runBackfill()` functions; only the scope/inputs differ.

### Scheduled (`data/audit/scheduler.js`, `node-cron`)

| Trigger | When | What runs | Scope |
|---|---|---|---|
| Nightly sweep | 03:00 ET daily | `runAudit({scope:'all'})` then `runBackfill({runId:latest})` | Full coverage spec |
| Pre-event T-7d | Daily 04:00 ET, fires for events 6–8 days out | Same pair, scoped | upcoming-roster + event metadata for that event |
| Pre-event T-1d | Daily 04:00 ET, fires for events 0–1 day out | Same pair, scoped | Same |
| Post-event T+1h | 5-min `setInterval` polling for `events WHERE date=today AND end_time<now()` | Same pair, scoped | Reconcile + fight_stats |
| Post-event T+24h | Daily, fires for events that ended 20–28h ago | Same pair, scoped | Same |

Each invocation gets a distinct `run_id`. In-memory dedupe (a `Set` per polling pass) prevents re-firing for the same event in the T+1h window. In-process per-trigger-key mutex prevents overlapping runs (next tick logs warning and skips).

### Manual — HTTP

| Endpoint | Purpose |
|---|---|
| `POST /api/data/audit/run` | Trigger audit. Body: `{scope?, scopeFilter?}`. Returns `{run_id}`. |
| `POST /api/data/backfill/run` | Trigger backfill. Body: `{runId?, gapFilter?, dryRun?}`. |
| `GET  /api/data/coverage` | Coverage report (above). |
| `GET  /api/data/backfill/queue` | List `pending_backfill` rows; supports `?status=pending`. |

All require `x-prediction-key` (matches existing internal endpoint convention).

### Manual — CLI

| Command | Purpose |
|---|---|
| `npm run audit` | Full audit run, print summary |
| `npm run audit -- --scope=event:110` | One event |
| `npm run backfill -- --run=<run_id>` | Backfill against a specific audit run |
| `npm run backfill -- --dry-run` | Print proposed actions, write nothing |
| `npm run backfill:review` | Interactive queue review |
| `npm run backfill:review -- --auto-approve-cosmetic` | Bulk-approve cosmetic entries |

## Error handling

| Failure | Behavior |
|---|---|
| Scraper HTTP 5xx/timeout | Retry 3× with backoff (existing pattern); on final failure, log + skip; gap re-surfaces next audit |
| Malformed HTML / parse fail | Log with `run_id`+URL, skip row, no queue entry (it's a scraper bug) |
| Verify fails at write time on `auto` row | Demote to `review`; queue with reason `verify-failed:<rule>` |
| Postgres write fails | Per-row try/catch; aggregate into `errors[]` summary; one bad row doesn't kill run |
| Audit run fails partway | Per-spec-entry transactions commit; `audit_runs.status='partial'`; `?run=latest` prefers `complete` |
| Cron tick during long run | In-process per-trigger mutex; skipped tick logs warning |
| Scraper module sync throw | Caught by dispatcher's per-row try/catch; treated like HTTP failure |

Net: every failure is retried, logged + skipped, or queued. Nothing crashes the run. Logs + `errors[]` summary + `pending_backfill` are the three places to look.

## Idempotency

1. **`coverage_snapshots`** — append-only with fresh UUID per run.
2. **`pending_backfill`** — unique partial index on `(table_name, row_id, column_name) WHERE status IN ('pending','approved')`. Re-running:
   - Open row found → updates `proposed_value` if changed; else no-op.
   - Rejected row found → inserts new pending row (partial index allows it).
   - Applied row matching current DB → no-op.
3. **Auto-writes** — always conditional: `WHERE col IS NULL` for safe gap-fills; `WHERE col = $current` for risky overwrites.
4. **Approve-via-CLI** — re-checks `current_value` at write time; if intervening write happened, marks `status='superseded'`.

## Observability (v1)

- stdout logs prefixed with `run_id` → Railway logs.
- `coverage_snapshots` history is the trend record.
- `pending_backfill` is the action ledger (autos + reviews + rejects).
- No alerting; `?diff=last2` is the regression surface.

## Testing

| Layer | Type | Coverage |
|---|---|---|
| `data/audit/scopes.js` | Unit (sqlite or test schema) | Each scope SQL compiles, returns expected counts on fixture |
| `data/audit/runner.js` | Unit | Fixture DB with planted gaps → expected `coverage_snapshots` + samples |
| `data/backfill/gate.js` | Unit (pure) | One test per row in the gate rule table |
| `data/scrapers/*` | Unit with HTML fixtures (`tests/fixtures/scrapers/`) | Each module parses saved HTML correctly; regression-detects markup changes |
| `data/backfill/dispatcher.js` | Integration | Fixture DB + mocked scraper modules; planted gap → 1 auto + 1 queued + 1 rejected |
| `runAudit` + `runBackfill` end-to-end | Integration | Postgres test container, full flow run twice for idempotency |
| `npm run backfill:review` | Manual smoke | Interactive; not unit-tested |

Not tested in v1: live scraper HTTP, cron timing, live name-disambiguation against ufcstats search.

The scraper-module extraction gives the existing JS scrapers their first regression coverage — a side-benefit, but explicit v1 scope (~few hundred LOC of test code).

## File-level changes

**New:**
- `data/audit/coverage-spec.js`
- `data/audit/scopes.js`
- `data/audit/runner.js`
- `data/audit/scheduler.js`
- `data/backfill/backfill-spec.js`
- `data/backfill/gate.js`
- `data/backfill/dispatcher.js`
- `data/scrapers/ufcstats-fighter.js`
- `data/scrapers/ufcstats-event.js`
- `data/scrapers/ufcstats-fight.js`
- `data/scrapers/ufc-com-athlete.js`
- `data/scrapers/ufc-com-event.js`
- `scripts/backfill-review.js`
- `tests/audit/*`, `tests/backfill/*`, `tests/scrapers/*`, `tests/fixtures/scrapers/*`

**Modified:**
- `db/postgres.js` — add `coverage_snapshots`, `audit_runs`, `pending_backfill` to `ensureSchema()`.
- `db/sqlite.js` — same (mirror).
- `server.js` — register `/api/data/audit/*`, `/api/data/coverage`, `/api/data/backfill/*` routes; start scheduler on boot.
- `data/scrape.js`, `data/scrape-upcoming.js`, `data/scrape-results.js` — refactor parsing into the new `data/scrapers/*` modules; existing CLIs become thin wrappers.
- `package.json` — add `node-cron` dep; add `audit`, `backfill`, `backfill:review` scripts.

## Open v2 candidates (not in scope)

- Web admin UI for the review queue.
- Coverage regression alerting (Slack/email webhook on `diff=last2` threshold).
- Cross-source reconciliation (catching silent same-but-wrong agreement).
- Backfill for `events.timezone/start_time/venue` parsing.
- Backfill for biomechanics inputs.
- Coverage scoring for `llm-pipeline` soft signals.
- Multi-source fighter identity matching (beyond ufcstats_hash + normalized name).
