# UFC Tactical Predictions

Fight outcome prediction microservice for the UFC Tactical Dashboard.

## Architecture

- **Web process** (`app.py`): FastAPI server with health check, status, and manual trigger endpoints
- **Worker process** (`scheduler.py`): APScheduler with 4 cron jobs
- **Model** (`model/`): Logistic regression with 12 engineered features
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
# Web process
uvicorn app:app --port 8000

# Worker process (separate terminal)
python scheduler.py
```

## Smoke tests

```bash
python tests/test_model.py
```

## First training run

After deploying, trigger the initial training:

```bash
curl -X POST http://localhost:8000/trigger/retrain \
  -H "x-prediction-key: YOUR_KEY"
```

## Cron schedule

| Job | Schedule | Description |
|-----|----------|-------------|
| `daily_predict` | 06:00 UTC daily | Predict next 14 days |
| `refresh_near` | 08:00, 14:00, 20:00 UTC | Refresh next 48h |
| `daily_reconcile` | 07:00 UTC daily | Reconcile last 7 days |
| `weekly_retrain` | Monday 05:00 UTC | Retrain on all data |

## Env vars

| Variable | Required | Description |
|----------|----------|-------------|
| `MAIN_APP_URL` | Yes | URL of the main Express app |
| `PREDICTION_SERVICE_KEY` | Yes | Shared auth key (must match main app) |
| `PORT` | No | Web server port (default: 8000) |
| `PREDICTIONS_DB_PATH` | No | SQLite path (default: predictions.db) |
| `MODEL_DIR` | No | Model blob directory (default: model_store) |

## Features (12)

1. Red avg sig strikes per fight
2. Blue avg sig strikes per fight
3. Red sig strike accuracy
4. Blue sig strike accuracy
5. Red takedowns per fight
6. Blue takedowns per fight
7. Red control time per fight
8. Blue control time per fight
9. Reach delta (cm)
10. Height delta (cm)
11. Red win % last 3
12. Blue win % last 3
