# UFC LLM Pipeline (local, Docker)

Local-only enrichment layer for UFC predictions. Runs Stage 1 soft-signal extraction
+ Stage 2 ensemble reasoning on top of the existing logistic-regression predictions
service, then POSTs ensemble predictions to the Railway main app.

See the design at `../docs/superpowers/specs/2026-04-27-llm-prediction-pipeline-design.md`.

## Setup (one time)

```bash
cp .env.local.example .env.local
# Set MAIN_APP_URL and PREDICTION_SERVICE_KEY (must match Railway main app's key)
docker compose build
docker compose up -d ollama llm-pipeline
docker compose exec ollama ollama pull llama3.1:8b
```

## Train LR locally

```bash
docker compose run --rm pipeline-shell train
```

Pulls labeled fights from `MAIN_APP_URL`, trains a sklearn pipeline, writes joblib
to `MODEL_DIR`. Fast (~10 sec on a few hundred fights).

## Run a dry-run enrichment

```bash
docker compose run --rm pipeline-shell enrich --dry-run
```

Scrapes, extracts, reasons, but does NOT POST to Railway. Output prints the
predictions that would be sent plus an audit summary. Use this to eyeball Stage
2 quality before going live.

Limit to a single event:

```bash
docker compose run --rm pipeline-shell enrich --dry-run --event 99
```

## Live run

```bash
docker compose run --rm pipeline-shell enrich
```

Same as above but POSTs ensemble predictions to `MAIN_APP_URL`. The existing
`predictions` row for each fight gets superseded; the LR row stays in place
marked `is_stale=1` so accuracy comparisons still work.

Set `REQUIRE_AUDIT_PASS=1` to block live sync for ensemble rows with audit
blockers while still showing them in dry-run output.

## Provider swap

```bash
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5
ANTHROPIC_API_KEY=sk-ant-...
```

Restart the pipeline service after editing `.env.local`.

## Endpoints (when running as a server)

- `GET http://localhost:8787/healthz` — health check
- `GET http://localhost:8787/status` — provider, model, last run, scrapers enabled
- `GET http://localhost:8787/runs` — last 20 pipeline runs
- `POST http://localhost:8787/trigger/enrich` — manual trigger (`x-prediction-key` required)

## Evaluating

After 2-3 events resolve:

```bash
curl -s "$MAIN_APP_URL/api/predictions/accuracy?breakdown=enrichment_level" | jq
```

Returns `{ lr: {n, accuracy, ...}, ensemble: {n, accuracy, ...} }`. Compare.

## Troubleshooting

- **ollama not reachable** — `docker compose logs ollama`. Ensure model pull completed.
- **train returns insufficient_labeled_fights** — main app has fewer than 20 labeled
  fights. Run scrape-results.js or seed more events first.
- **no predictions after enrich** — check `/runs` for the last run's `error` field, then
  look at `docker compose logs llm-pipeline`.
- **pending sync backlog** — `docker compose run --rm pipeline-shell drain` retries.
