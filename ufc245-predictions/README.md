# UFC Tactical Predictions

Fight outcome prediction microservice for the UFC Tactical Dashboard.

## Architecture

- **Single process** (`app.py`): FastAPI server with health/status, manual trigger endpoints, and in-process APScheduler cron jobs
- **Model** (`model/`): Regularized logistic regression with matchup deltas,
  career aggregates, profile metrics, recent form, and experience features
- **Local DB** (`db/`): SQLite for model blobs and prediction log

## Setup

```bash
cd ufc245-predictions
python -m venv .venv
source .venv/bin/activate  # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
```

Copy `.env.example` to `.env` and set your values.

## Running locally

```bash
# Single process (API + scheduler)
uvicorn app:app --port 8000
```

## Smoke tests

```bash
python tests/test_model.py
python tests/test_jobs.py
python tests/test_app.py
```

## First training run

After deploying, trigger the initial training:

```bash
curl -X POST http://localhost:8000/trigger/retrain \
  -H "x-prediction-key: YOUR_KEY"

curl -X POST http://localhost:8000/trigger/sync \
  -H "x-prediction-key: YOUR_KEY"

# Optional: snapshot official/in-progress outcomes from the main app feed
curl -X POST http://localhost:8000/trigger/outcomes \
  -H "x-prediction-key: YOUR_KEY"
```

## Cron schedule

| Job | Schedule | Description |
|-----|----------|-------------|
| `daily_predict` | 06:00 UTC daily | Predict next 14 days |
| `refresh_near` | 08:00, 14:00, 20:00 UTC | Refresh next 48h and snapshot official outcomes |
| `daily_reconcile` | 07:00 UTC daily | Capture official outcomes and reconcile last 7 days |
| `weekly_retrain` | Monday 05:00 UTC | Retrain on all data |
| `sync_unsynced` | Every hour at :30 | Sync unsynced local backlog to main app |

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `MAIN_APP_URL` | Yes | URL of the main Express app |
| `PREDICTION_SERVICE_KEY` | Yes | Shared auth key (must match main app) |
| `PORT` | No | Web server port (default: 8000) |
| `PREDICTIONS_DB_PATH` | No | SQLite path (default: predictions.db) |
| `MODEL_DIR` | No | Model blob directory (default: model_store) |
| `ENABLE_SCHEDULER` | No | Set to `0` to disable in-process cron scheduler |
| `DEPLOYMENT_MODE` | No | Informational mode flag (`single`, `split-web`, `split-worker`) |

## Railway build configs

- `nixpacks.toml` — single-service mode
- `nixpacks.web.toml` — split web service mode
- `nixpacks.worker.toml` — split worker service mode

## Feature Groups

- Significant strike pace and accuracy, including red-blue deltas
- Takedown pace and accuracy, including red-blue deltas
- Control time, knockdowns, and submission attempts per fight
- Reach and height deltas
- Fighter profile metrics: SLpM, striking defense, and takedown defense
- Recent form: win percentage over the last three fights
- Experience: historical fight counts and matchup delta
