# Local LLM Prediction Pipeline — Design

**Date:** 2026-04-27
**Status:** Approved, pending implementation plan
**Author:** Weston Dunn (with Claude)

## Problem

The existing prediction service (`ufc245-predictions/`, FastAPI on Railway) uses a logistic regression over ~37 numeric features (career stats, profile metrics, recent form, experience). It is explainable and stable but has a hard ceiling: it cannot reason over qualitative signals — injury reports, camp changes, weight-cut concerns, style matchups, recent narrative. Method/round predictions today are stuffed metadata, not reasoned outputs.

We want to expand and deepen both the **prediction service** and the **scraping** capabilities by introducing a local LLM pipeline running in Docker against a local Ollama runtime, while keeping a clean path to push everything to Railway later. If the LLM cannot run on Railway, we still want predictions produced locally and pushed to the remote main app.

## Goals

- Add an LLM-augmented prediction layer on top of the existing logistic regression model (LR), producing winner/method/round predictions with a written rationale.
- Add LLM-driven scraping of soft-signal sources: MMA news outlets, UFC.com bout previews, and Tapology fighter pages (press conference / weigh-in coverage flows through the news scraper, not a separate one).
- Keep the existing Railway predictions service unchanged so baseline predictions never go stale when local is off.
- Provider-pluggable from day one so swapping Ollama → Anthropic / OpenAI is an env-var change.
- Bake in evaluation: side-by-side accuracy between LR-only and ensemble predictions for the same fights.

## Non-Goals

- Running Ollama on Railway (assume CPU-only Railway containers cannot serve a useful local LLM at acceptable latency).
- Retraining LR with LLM-extracted features (no labeled historical news data; would need years of backfill to be viable).
- UI changes — data lands in the DB; rendering it is a separate PR.
- Holdout evaluation on historical fights. We learn forward from real outcomes.
- Replacing or demoting the existing Railway predictions service.

## Key Decisions (with rationale)

- **Ensemble shape: two-layer.** LR runs first and produces a numeric probability + factor breakdown. The LLM consumes LR output + qualitative context and produces the final prediction. Keeps LR as a stable floor; LLM adds qualitative reasoning on top.
- **LLM workflow: two-stage chain.** Stage 1 extracts structured soft features from each source (cacheable per URL). Stage 2 reasons over LR + features → final prediction. Smaller, evaluable prompts; per-source caching is the main cost win.
- **Storage: hybrid.** Soft features and scraped HTML stay in local SQLite (private working state, will evolve as prompts tune). A UI-ready `insights[]` array is pushed to Railway alongside the final ensemble prediction.
- **Deployment: local Docker, push to Railway.** Local pipeline reads main app's API for fights/stats, runs the full prediction locally, POSTs ensemble predictions back via the existing ingest endpoint (extended). Railway predictions service stays unchanged.
- **Upgrade semantics on Railway.** Railway LR scheduler keeps producing baseline predictions. Local pipeline's `'ensemble'` predictions overwrite `'lr'` rows for the same fight; `'lr'` does not overwrite `'ensemble'`. Predictions are never stale; they get richer when local has run recently.
- **Provider abstraction.** All LLM calls go through a `providers/base.py` interface (`chat_json`, `chat_text`). Default: Ollama with `llama3.1:8b`. Anthropic and OpenAI adapters present but unused.
- **Sources for v1:** MMA news outlets (MMAJunkie, MMAFighting, BloodyElbow), UFC.com bout previews, and Tapology fighter pages. Press conference and weigh-in recaps are captured via the news scraper since they publish as articles on the same outlets — no separate scraper. Reddit, X, YouTube transcripts deferred to v2.
- **Scope of fights enriched: next ~14 days only** (`ENRICH_HORIZON_DAYS=14`). Caps LLM cost; matches the existing `refresh_near` pattern.
- **Triggering: manual entrypoint + opt-in scheduler.** `docker compose run pipeline-shell enrich` always available; APScheduler runs daily when `ENABLE_SCHEDULER=1`.

## Architecture

```
┌─ Local Docker (your laptop) ─────────────────────────────┐
│                                                          │
│   ollama         (LLM runtime, llama3.1:8b default)      │
│      ▲                                                   │
│      │                                                   │
│   llm-pipeline   (Python, FastAPI + APScheduler opt-in)  │
│   ├─ scrapers/   (news, ufc.com previews, Tapology)      │
│   ├─ extract/    Stage 1: text → soft features           │
│   ├─ reason/     Stage 2: LR + features → ensemble pred  │
│   ├─ lr/         (imports existing model code, runs LR)  │
│   ├─ providers/  (ollama|anthropic|openai adapter)       │
│   └─ db/         local SQLite cache (extracts, html)     │
│                                                          │
└────────────────┬─────────────────────────────────────────┘
                 │ HTTPS (existing main app API + extensions)
                 ▼
┌─ Railway ────────────────────────────────────────────────┐
│   main app (Node/Express, Postgres)                      │
│      • /api/events, /api/fighters/:id/career-stats       │
│      • /api/predictions/ingest  (extended)               │
│      • predictions table  (+ enrichment_level, insights) │
│                                                          │
│   predictions service (FastAPI)                          │
│      • LR-only scheduler keeps producing baseline preds  │
│      • unchanged                                         │
└──────────────────────────────────────────────────────────┘
```

## Local Docker layout

```
docker-compose.yml          # 3 services
.env.local                  # local-only secrets, gitignored
llm-pipeline/               # NEW — the local-only Python service
├── Dockerfile
├── pyproject.toml
├── app.py                  # FastAPI: /healthz, /status, /runs, /trigger/enrich
├── scheduler.py            # APScheduler, opt-in via ENABLE_SCHEDULER=1
├── pipeline/
│   ├── orchestrator.py     # end-to-end run for a fight
│   ├── extract.py          # Stage 1 LLM call (text → features)
│   ├── reason.py           # Stage 2 LLM call (LR + features → ensemble)
│   ├── lr_runner.py        # imports ufc245-predictions/model code
│   └── insights.py         # build UI insights[] from extracted features
├── scrapers/
│   ├── news.py             # MMAJunkie, MMAFighting, BloodyElbow (RSS+article)
│   ├── ufc_preview.py      # ufc.com event "Fight Preview" copy
│   └── tapology.py         # fighter pages (camp, weight cut, recent activity)
├── providers/
│   ├── base.py             # abstract LLMProvider (chat_json, chat_text)
│   ├── ollama.py           # default
│   ├── anthropic.py        # ready for swap (Claude Haiku)
│   └── openai.py           # ready for swap (gpt-4o-mini)
├── db/
│   ├── schema.sql          # local SQLite tables
│   └── store.py            # cache + extracted features
└── tests/
```

| Compose service | Image | Purpose | Volumes |
|---|---|---|---|
| `ollama` | `ollama/ollama` | Local LLM runtime | `ollama_models` |
| `llm-pipeline` | built from `llm-pipeline/Dockerfile` | Long-running pipeline + HTTP API on `localhost:8787` | `pipeline_data` (SQLite + scrape cache); read-only mount of `../ufc245-predictions/model/` |
| `pipeline-shell` | same image, command override | One-shot CLI entrypoint for `docker compose run pipeline-shell enrich --event <id>` | shares volumes |

The pipeline imports `ufc245-predictions/model/__init__.py` directly via a read-only volume mount — feature engineering stays one source of truth.

## Two-stage LLM chain

### Stage 1: Soft-signal extraction (per source, cached)

Triggered when a scraper fetches a new article/preview/Tapology page. Idempotent — keyed on `sha1(source_url)` + `body_sha1`.

**Input:** source type, cleaned text body, fight context (red/blue names, event date, weight class).

**Output (strict JSON):**

```json
{
  "fighters_mentioned": ["volkanovski", "topuria"],
  "signals": [
    { "fighter": "volkanovski", "type": "camp_change",        "severity": 2, "evidence": "head striking coach left City Kickboxing in March" },
    { "fighter": "topuria",      "type": "weight_cut_concern", "severity": 1, "evidence": "missed weight at last weigh-in" },
    { "fighter": null,           "type": "style_note",         "severity": 0, "evidence": "southpaw vs orthodox; Topuria's lead hand more active" }
  ],
  "irrelevant": false
}
```

**Controlled vocabulary for `type`:** `injury`, `camp_change`, `weight_cut_concern`, `motivation`, `style_note`, `recent_form_note`, `layoff`, `personal`, `other`. **`severity`:** 0–3. `irrelevant: true` short-circuits storage.

Cached in `source_cache` and `soft_signals`. Re-runs do not re-call the LLM unless `body_sha1` changed.

### Stage 2: Ensemble reasoning (per fight, on demand)

Triggered after Stage 1 has run for all sources tied to a fight.

**Input:** LR output (`red_prob`, `blue_prob`, top factors, summary), top 8 numeric career features (red and blue values), aggregated deduped soft signals grouped by fighter, bout metadata (weight class, title fight bool, 5-round bool, event date).

**Output (strict JSON):**

```json
{
  "predicted_winner": "red",
  "win_probability": 0.61,
  "predicted_method": "Decision",
  "predicted_round": 3,
  "method_confidence": 0.55,
  "agreement_with_lr": "agrees",
  "rationale": "LR favors Volkanovski 58/42 on striking pace and accuracy edges. Soft signals reinforce: Topuria's coach change is a real risk and his last weight cut was rough. Method leans decision because both fighters have strong striking defense and Topuria's takedown defense limits sub paths.",
  "insights": [
    { "label": "Coach change for Topuria's camp", "severity": 2, "favors": "red", "source": "MMAJunkie" },
    { "label": "Weight cut concern for Topuria",  "severity": 1, "favors": "red", "source": "Tapology" },
    { "label": "Reach edge to Volkanovski",        "severity": 1, "favors": "red", "source": "lr_features" }
  ]
}
```

`predicted_method` is enum'd to `"KO/TKO" | "Submission" | "Decision"`. `predicted_round` is 1–5 or `null` for decisions. `insights[]` is what gets pushed to Railway.

### Cost ballpark (1 event ≈ 12 fights, ~3 sources/fight)

- Stage 1: ~36 calls @ ~600 in / 200 out → ~30k in / ~7k out tokens. Locally on `llama3.1:8b`: ~2–4 minutes. On Anthropic Haiku: pennies.
- Stage 2: 12 calls @ ~1200 in / 400 out → ~14k in / ~5k out. Locally: ~1 minute.

Caches mean re-runs are mostly free.

## End-to-end data flow

```
1. GET /api/events on Railway main app, filter to next ENRICH_HORIZON_DAYS days
2. For each event, GET /api/events/:id/card
3. For each fight (parallel up to MAX_CONCURRENT_FIGHTS):
   3a. GET /api/fighters/:id/career-stats for red and blue
   3b. Scrape soft-signal sources (news RSS, UFC preview, Tapology); cache to source_cache
   3c. Stage 1 extract for each new source (skip if cached); write soft_signals
   3d. Run LR locally via lr_runner (shared model code + locally trained joblib)
   3e. Stage 2 reason → ensemble prediction + insights[]
   3f. POST to Railway /api/predictions/ingest (extended schema)
4. Pipeline marks run complete in pipeline_runs
```

## LR model artifact

Local pipeline trains its own LR on first startup and on a weekly cron when scheduler is on. It calls `MAIN_APP_URL/api/events` for labeled fights and uses the existing `model.train` from the read-only volume mount. Joblib persisted in `MODEL_DIR`. Independently trained but produces equivalent scores to Railway predictions service (same code, same data).

## Railway main app changes

### Schema migration on `predictions`

```sql
ALTER TABLE predictions
  ADD COLUMN enrichment_level   TEXT NOT NULL DEFAULT 'lr',  -- 'lr' | 'ensemble'
  ADD COLUMN narrative_text     TEXT,
  ADD COLUMN method_confidence  REAL,
  ADD COLUMN insights           JSONB;                       -- [{label, severity, favors, source}]
```

### New `prediction_history` table (for evaluation)

```sql
CREATE TABLE prediction_history (
  id SERIAL PRIMARY KEY,
  fight_id INTEGER NOT NULL,
  enrichment_level TEXT NOT NULL,
  red_win_prob REAL,
  blue_win_prob REAL,
  predicted_method TEXT,
  predicted_round INTEGER,
  model_version TEXT,
  predicted_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ DEFAULT now()
);
```

When an `'ensemble'` prediction overwrites an existing `'lr'` row, the `'lr'` row is archived to `prediction_history` rather than discarded.

### `/api/predictions/ingest` upsert semantics

The existing endpoint already enforces a "locked" state via `db.getPredictionLockState` (e.g. predictions for in-progress or concluded fights). Lock checks are unchanged and run first — locked predictions are still skipped regardless of `enrichment_level`. The new layer applies only to non-locked rows:

- Incoming `'ensemble'` overwrites an existing `'lr'` row for the same `fight_id`. The displaced `'lr'` row is archived to `prediction_history` before the overwrite.
- Incoming `'lr'` does NOT overwrite an existing `'ensemble'` row (silently skipped, not treated as an error).
- Same-level upserts compare `predicted_at` and keep the newer row.
- New optional fields accepted on the request body: `enrichment_level`, `narrative_text`, `method_confidence`, `insights[]`, `predicted_method`, `predicted_round`. All default-safe — existing Python predictions service callers don't need to change.

### `/api/predictions/accuracy?breakdown=enrichment_level`

Reads `predictions` AND `prediction_history` rows for concluded fights, returns:

```json
{
  "lr":       { "n": 142, "accuracy": 0.61, "method_accuracy": 0.41 },
  "ensemble": { "n":  47, "accuracy": 0.66, "method_accuracy": 0.55 }
}
```

This is the single metric that answers "did the LLM help?" — same fights, both predictions, side-by-side accuracy.

### Reads that must span both tables

The existing accuracy / trends / leaderboard endpoints (`getPredictionAccuracy`, `getPredictionTrends`, `getModelLeaderboard`, `getPredictionOutcomeDetails`) compute correctness on read by joining predictions to official outcomes. They must be updated to read from `predictions UNION ALL prediction_history` so that archived `'lr'` predictions still count toward LR's track record after they've been upgraded. The new `?breakdown=enrichment_level` parameter is added to `/api/predictions/accuracy` and groups the result by `enrichment_level` instead of (or in addition to) `model_version`.

### Untouched

`/api/predictions` (GET), `/api/predictions/reconcile`, `/api/predictions/prune`. Reconcile updates official outcomes only; it doesn't need to know about `prediction_history` because correctness is computed on read.

## Local SQLite schema

```sql
CREATE TABLE source_cache (
  url_hash TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  source_type TEXT NOT NULL,     -- 'news_article' | 'ufc_preview' | 'tapology_fighter'
  fetched_at TEXT NOT NULL,
  body_sha1 TEXT NOT NULL,
  body TEXT
);

CREATE TABLE soft_signals (
  url_hash TEXT NOT NULL,
  fight_id INTEGER,
  fighter_side TEXT,             -- 'red' | 'blue' | null
  fighter_name TEXT,
  signal_type TEXT NOT NULL,
  severity INTEGER NOT NULL,
  evidence TEXT NOT NULL,
  extracted_at TEXT NOT NULL,
  PRIMARY KEY (url_hash, fight_id, fighter_name, signal_type)
);

CREATE TABLE pipeline_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT,                   -- 'ok' | 'partial' | 'error'
  events_processed INTEGER,
  fights_predicted INTEGER,
  predictions_synced INTEGER,
  error TEXT
);

CREATE TABLE pending_sync (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fight_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
```

## Error handling

| Failure | Behavior |
|---|---|
| `ollama` unreachable | Abort run, log error, exit non-zero. Railway LR predictions remain. No silent fallback to LR-only via the local path. |
| Stage 1 fails on one source | Skip that source, continue. Run logged `'partial'`. |
| Stage 1 returns malformed JSON | One retry with a "fix this JSON" prompt. If still bad, drop and continue. |
| Stage 2 fails for a fight | Skip that fight. Existing LR prediction on Railway remains. |
| Scraper blocked / 4xx-5xx | Per-source retry once with backoff, then skip. |
| Railway main app unreachable | Store predictions locally in `pending_sync`. Next run retries POST. |
| Provider quota / rate limit | Treat like Ollama unreachable. |
| LR feature shape change | Picked up on container rebuild via shared code mount. |

No silent degradation: if the LLM half can't run, the local pipeline posts nothing. This avoids the failure mode where local pretends to enrich but is really LR-with-extra-steps.

## Configuration (`.env.local`, gitignored)

```
# Provider
LLM_PROVIDER=ollama                    # ollama | anthropic | openai
LLM_MODEL=llama3.1:8b
OLLAMA_URL=http://ollama:11434
ANTHROPIC_API_KEY=
OPENAI_API_KEY=

# Main app
MAIN_APP_URL=https://main.railway.app
PREDICTION_SERVICE_KEY=<reuse Railway key>

# Pipeline behavior
ENRICH_HORIZON_DAYS=14
MAX_CONCURRENT_FIGHTS=4
ENABLE_SCHEDULER=0
SCHEDULER_CRON_HOUR=8

# Storage
PIPELINE_DB_PATH=/data/pipeline.db
MODEL_DIR=/data/model_store
SCRAPE_CACHE_DIR=/data/scrape_cache

# Scraper toggles
ENABLE_SCRAPER_NEWS=1
ENABLE_SCRAPER_UFC_PREVIEW=1
ENABLE_SCRAPER_TAPOLOGY=1
```

`PREDICTION_SERVICE_KEY` is reused from the existing Railway setup — no new auth surface.

## Politeness and concurrency

- Scrapers: 1 req/sec per host (matches `data/scrape.js` convention).
- LLM concurrency: bounded by `MAX_CONCURRENT_FIGHTS` (default 4). Stage 1 extraction within a fight is serialized; we parallelize across fights.

## Observability (v1, minimal)

- Structured JSON logs to stdout.
- `/healthz`, `/status`, `/runs` HTTP endpoints on `llm-pipeline` (port 8787 on localhost). Modeled on existing `ufc245-predictions/app.py`.
- `/runs` returns last 20 `pipeline_runs` rows for ad-hoc debugging.

No metrics export, tracing, or separate dashboard for v1.

## Testing

### Unit / integration (block CI)

| Layer | Test |
|---|---|
| Providers | `chat_json` returns parsed dict; retries on bad JSON; surfaces 4xx |
| Scrapers | Each scraper extracts the right fields from a fixed HTML/RSS fixture |
| Stage 1 extract | Given fixture text + mocked LLM, produces correct `soft_signals`; cache hit short-circuits LLM |
| Stage 2 reason | Given LR output + mocked LLM, produces correct ensemble row + `insights[]` |
| LR runner | `engineer_features` parity with Railway predictions service for the same input |
| Ingest contract | Pipeline POST validates against the extended `/api/predictions/ingest` schema |
| Upgrade semantics | `'ensemble'` overwrites `'lr'`; `'lr'` does not overwrite `'ensemble'`; archived row exists |

### Live integration test (manual, gated)

`docker compose run pipeline-shell enrich --event <next-event-id> --dry-run` runs the full pipeline except the final POST. Eyeball Stage 2 output for an upcoming card before letting it write to Railway.

### Out of scope for v1 testing

- Holdout evaluation on historical fights.
- Prompt regression tests against canned outputs.
- Hallucination detection beyond JSON-schema validation.

## Build sequence

1. **Railway main app schema migration** — add columns + `prediction_history`; extend `/api/predictions/ingest` with upgrade-semantics upsert and history archival; extend `/api/predictions/accuracy` with `?breakdown=enrichment_level`. Existing flow unchanged because `enrichment_level` defaults to `'lr'`.
2. **Local Docker scaffolding** — `docker-compose.yml`, `llm-pipeline/Dockerfile`, ollama service with model pull, healthchecks, volumes. Empty FastAPI with `/healthz`. Verify `docker compose up`.
3. **Provider abstraction + Ollama adapter** — `providers/base.py`, `providers/ollama.py`. Provider-swap test against mocked Anthropic.
4. **LR runner sharing existing model code** — read-only mount, import `engineer_features`, `predict`. CLI: `pipeline-shell lr --fight <id>`. Parity test with Railway.
5. **Local model training** — port `weekly_retrain` logic, persist joblib in `MODEL_DIR`. Verify cv_acc parity.
6. **Scrapers, one at a time** — `news.py`, `ufc_preview.py`, `tapology.py`. Fixture tests + dry-runs. Each writes to `source_cache`.
7. **Stage 1 extraction** — `pipeline/extract.py` + extraction prompt. Wire to `source_cache`, write `soft_signals`. Mock-LLM tests, then live on one cached article.
8. **Stage 2 reasoning** — `pipeline/reason.py` + reasoning prompt. Mock-LLM tests, then live for one fight.
9. **Orchestrator + ingest** — `orchestrator.py` ties everything together. Add `pending_sync` retry. Manual end-to-end dry-run on one upcoming event.
10. **Manual entrypoint and status endpoints** — `pipeline-shell enrich [--dry-run] [--event <id>]`; `/status`, `/runs`. README in `llm-pipeline/`.
11. **Opt-in scheduler** — APScheduler when `ENABLE_SCHEDULER=1`. Daily refresh in horizon window. Smoke test.
12. **First live run + evaluation rollout** — `--dry-run` against next real event, then live. After event resolves, hit `/api/predictions/accuracy?breakdown=enrichment_level`. Tune prompts.

Steps 1–5 don't touch LLMs; they're plumbing and let us catch integration issues early.

## Risks and open questions

- **Scraper fragility (Tapology especially).** Mitigated by per-source toggles and skip-on-failure. If Tapology breaks repeatedly, drop it from v1 and re-enable when we have time to fix.
- **LLM JSON discipline on `llama3.1:8b`.** One-retry-with-fix is the failsafe. If it's a problem in practice, switch the default to a model with stronger structured-output behavior (`qwen2.5:7b` is a candidate) — pluggable design makes this trivial.
- **Evaluation sample size.** Need 2–3 events resolved before the side-by-side accuracy comparison is meaningful. Don't draw conclusions early.
- **Provider swap on Railway.** When ready to put the LLM half on Railway, swap `LLM_PROVIDER=anthropic` (or similar) in the Railway predictions service env. The same pipeline code should run unchanged. Validate by running the same fight locally with both providers and diffing the output.
