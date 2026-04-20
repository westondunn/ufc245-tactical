# Predictions Integration Guide

## Quick start (automated)

```bash
# 1. Log in to Railway (interactive, one-time)
railway login

# 2. Link to your existing project (if not already linked)
railway link

# 3. Run setup — creates/updates the single predictions service
bash scripts/railway-setup.sh

# 4. After deploy is healthy, bootstrap + verify end-to-end
bash scripts/railway-bootstrap.sh
```

The setup script will:
- Generate a shared `PREDICTION_SERVICE_KEY`
- Set it on your existing main app service
- Create/find a single `predictions` service
- Set required env vars (`MAIN_APP_URL`, `PREDICTION_SERVICE_KEY`, `PREDICTIONS_DB_PATH`, `MODEL_DIR`, `ENABLE_SCHEDULER`)
- Trigger deploys for main app and predictions service

The bootstrap script will hard-verify:
- `/healthz` returns healthy with scheduler running
- `/trigger/retrain` succeeds and a model exists
- `/trigger/predict` succeeds
- Main app `/api/predictions?upcoming=1` is reachable and returns JSON

## Architecture

```
Railway Project
  |
  +-- main app (existing)         Node/Express
  |     PREDICTION_SERVICE_KEY=xxx
  |     DB_PATH=/data/ufc.db
  |
  +-- predictions (new/updated)   FastAPI + APScheduler (single process)
        MAIN_APP_URL=https://main-app.railway.app
        PREDICTION_SERVICE_KEY=xxx
        PREDICTIONS_DB_PATH=/data/predictions.db
        MODEL_DIR=/data/model_store
        ENABLE_SCHEDULER=1
```

## Manual setup (if scripts don't work)

### Env vars

Main app:
```
PREDICTION_SERVICE_KEY=<random 32-48 char secret>
```

Predictions service:
```
MAIN_APP_URL=https://your-main-app.railway.app
PREDICTION_SERVICE_KEY=<same key>
PREDICTIONS_DB_PATH=/data/predictions.db
MODEL_DIR=/data/model_store
ENABLE_SCHEDULER=1
NIXPACKS_CONFIG_FILE=ufc245-predictions/nixpacks.toml
```

### Railway service

**predictions:**
- Root directory: repo root (Nixpacks config points to `ufc245-predictions/`)
- Start command: `uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}`
- Health check: `/healthz`

## Manual bootstrap

```bash
# Train model
curl -X POST https://predictions.railway.app/trigger/retrain \
  -H "x-prediction-key: YOUR_KEY"

# Generate predictions
curl -X POST https://predictions.railway.app/trigger/predict \
  -H "x-prediction-key: YOUR_KEY"

# Verify main app ingestion
curl https://your-main-app.railway.app/api/predictions?upcoming=1
```

## API routes on main app

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/predictions` | GET | Public | Get predictions (query: `fight_id`, `upcoming`, `from`, `to`, `limit`) |
| `/api/predictions/accuracy` | GET | Public | Model accuracy stats |
| `/api/predictions/ingest` | POST | `x-prediction-key` | Ingest predictions from microservice |
| `/api/predictions/reconcile` | POST | `x-prediction-key` | Reconcile with actual results |

## Scheduler cron (in-process)

| Job | Schedule (UTC) | Description |
|-----|----------------|-------------|
| `daily_predict` | 06:00 daily | Predict next 14 days |
| `refresh_near` | 08:00, 14:00, 20:00 | Refresh next 48h |
| `daily_reconcile` | 07:00 daily | Reconcile last 7 days |
| `weekly_retrain` | Monday 05:00 | Retrain on all data |
