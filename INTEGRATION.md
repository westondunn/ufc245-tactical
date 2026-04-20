# Predictions Integration Guide

## Deployment order

1. **Main app** (this repo's root) -- deploy first so prediction routes are live
2. **Prediction service** (`ufc245-predictions/`) -- deploy as a second Railway service

## Env vars

### Main app (existing Railway service)

Add to the existing service's environment:

```
PREDICTION_SERVICE_KEY=<generate a random 32-char string>
```

### Prediction service (new Railway service)

```
MAIN_APP_URL=https://your-main-app.railway.app
PREDICTION_SERVICE_KEY=<same key as above>
PORT=8000
```

## Railway setup for prediction service

1. In your Railway project, click "New Service"
2. Point to this repo, set root directory to `ufc245-predictions/`
3. Build will auto-detect Python via Nixpacks
4. Set start command: `uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}`
5. Set health check path: `/healthz`
6. Add env vars listed above

For the worker process (scheduler), create a second service in the same project:
- Same repo and root directory (`ufc245-predictions/`)
- Start command: `python scheduler.py`
- No health check needed (it's a background worker)

## Bootstrap sequence

After both services are deployed:

```bash
# 1. Verify health
curl https://your-predictions.railway.app/healthz

# 2. Trigger initial training (takes ~2-5 min depending on data volume)
curl -X POST https://your-predictions.railway.app/trigger/retrain \
  -H "x-prediction-key: YOUR_KEY"

# 3. Verify model was trained
curl https://your-predictions.railway.app/status

# 4. Trigger first prediction run
curl -X POST https://your-predictions.railway.app/trigger/predict \
  -H "x-prediction-key: YOUR_KEY"

# 5. Verify predictions landed in main app
curl https://your-main-app.railway.app/api/predictions?upcoming=1
```

## API routes added to main app

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/predictions` | GET | Public | Get predictions (query: fight_id, upcoming, from, to, limit) |
| `/api/predictions/accuracy` | GET | Public | Model accuracy stats |
| `/api/predictions/ingest` | POST | x-prediction-key | Ingest predictions from microservice |
| `/api/predictions/reconcile` | POST | x-prediction-key | Reconcile with actual results |

## DB schema added to main app

```sql
CREATE TABLE predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fight_id INTEGER REFERENCES fights(id),
    red_fighter_id INTEGER REFERENCES fighters(id),
    blue_fighter_id INTEGER REFERENCES fighters(id),
    red_win_prob REAL NOT NULL,
    blue_win_prob REAL NOT NULL,
    model_version TEXT NOT NULL,
    feature_hash TEXT,
    predicted_at TEXT NOT NULL,
    event_date TEXT,
    is_stale INTEGER DEFAULT 0,
    actual_winner_id INTEGER,
    reconciled_at TEXT,
    correct INTEGER
);
```
