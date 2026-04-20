# Predictions Integration Guide

## Quick start (automated)

### Single service (default)
```bash
railway login
railway link
bash scripts/railway-setup.sh
bash scripts/railway-bootstrap.sh
```

### Split services (web + worker)
```bash
railway login
railway link
bash scripts/railway-setup.sh --split
bash scripts/railway-bootstrap.sh --split
```

## What setup script does

- Generates shared `PREDICTION_SERVICE_KEY`
- Sets key on main app service
- Configures prediction services (single or split)
- Sets required env vars (`MAIN_APP_URL`, `PREDICTION_SERVICE_KEY`, `PREDICTIONS_DB_PATH`, `MODEL_DIR`)
- Deploys services

## What bootstrap script verifies

- `/healthz` reachable
- `/trigger/retrain` succeeds and model exists
- `/trigger/predict` succeeds
- `/trigger/sync` succeeds
- Main app `/api/predictions?upcoming=1` returns JSON array

## Topologies

### Single mode

```
main app
  └─ predictions (FastAPI + in-process scheduler)
```

Predictions env:
```
MAIN_APP_URL=https://your-main-app.railway.app
PREDICTION_SERVICE_KEY=<same key as main app>
PREDICTIONS_DB_PATH=/data/predictions.db
MODEL_DIR=/data/model_store
ENABLE_SCHEDULER=1
DEPLOYMENT_MODE=single
NIXPACKS_CONFIG_FILE=ufc245-predictions/nixpacks.toml
```

### Split mode

```
main app
  ├─ predictions-web (API)
  └─ predictions-worker (API runtime with scheduler enabled)
```

`predictions-web` env:
```
MAIN_APP_URL=https://your-main-app.railway.app
PREDICTION_SERVICE_KEY=<same key as main app>
PREDICTIONS_DB_PATH=/data/predictions-web.db
MODEL_DIR=/data/model-web-store
ENABLE_SCHEDULER=0
DEPLOYMENT_MODE=split-web
NIXPACKS_CONFIG_FILE=ufc245-predictions/nixpacks.web.toml
```

`predictions-worker` env:
```
MAIN_APP_URL=https://your-main-app.railway.app
PREDICTION_SERVICE_KEY=<same key as main app>
PREDICTIONS_DB_PATH=/data/predictions-worker.db
MODEL_DIR=/data/model-worker-store
ENABLE_SCHEDULER=1
DEPLOYMENT_MODE=split-worker
NIXPACKS_CONFIG_FILE=ufc245-predictions/nixpacks.worker.toml
```

Note: in split mode, web and worker keep separate local runtime state.

## Main app prediction routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/predictions` | GET | Public | Query predictions (`fight_id`, `upcoming`, `from`, `to`, `limit`) |
| `/api/predictions/accuracy` | GET | Public | Accuracy summary |
| `/api/predictions/ingest` | POST | `x-prediction-key` | Ingest prediction batch |
| `/api/predictions/reconcile` | POST | `x-prediction-key` | Reconcile outcomes |

## Prediction service trigger routes

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/trigger/retrain` | POST | `x-prediction-key` | Train model |
| `/trigger/predict` | POST | `x-prediction-key` | Predict upcoming fights |
| `/trigger/refresh` | POST | `x-prediction-key` | Refresh near-term predictions |
| `/trigger/reconcile` | POST | `x-prediction-key` | Reconcile recent outcomes |
| `/trigger/sync` | POST | `x-prediction-key` | Sync unsynced local backlog to main app |
