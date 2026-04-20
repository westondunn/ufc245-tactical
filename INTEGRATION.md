# Predictions Integration Guide

## Quick start (automated)

```bash
# 1. Log in to Railway (interactive, one-time)
railway login

# 2. Link to your existing project (if not already linked)
railway link

# 3. Run the setup script — creates services, generates keys, deploys
bash scripts/railway-setup.sh

# 4. Wait for deploys to go healthy, then bootstrap
bash scripts/railway-bootstrap.sh
```

That's it. The setup script will:
- Generate a shared `PREDICTION_SERVICE_KEY`
- Set it on your existing main app service
- Create `predictions-web` and `predictions-worker` services
- Wire all env vars
- Trigger deploys on all three services

The bootstrap script will:
- Health-check the predictions service
- Train the initial model
- Run the first prediction batch
- Verify the pipeline end-to-end

## Architecture

```
Railway Project
  |
  +-- main app (existing)          Node/Express on port 3000
  |     PREDICTION_SERVICE_KEY=xxx
  |     DB_PATH=/data/ufc.db
  |
  +-- predictions-web (new)        FastAPI on port 8000
  |     MAIN_APP_URL=https://main-app.railway.app
  |     PREDICTION_SERVICE_KEY=xxx
  |
  +-- predictions-worker (new)     APScheduler (no port)
        MAIN_APP_URL=https://main-app.railway.app
        PREDICTION_SERVICE_KEY=xxx
```

## Manual setup (if scripts don't work)

### Env vars

Main app — add:
```
PREDICTION_SERVICE_KEY=<random 32-char hex>
```

Predictions services — add:
```
MAIN_APP_URL=https://your-main-app.railway.app
PREDICTION_SERVICE_KEY=<same key>
```

### Railway services

**predictions-web:**
- Root directory: `ufc245-predictions/`
- Start command: `uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}`
- Health check: `/healthz`

**predictions-worker:**
- Root directory: `ufc245-predictions/`
- Start command: `python scheduler.py`
- No health check (background worker)

### Bootstrap

```bash
# Train the model
curl -X POST https://predictions-web.railway.app/trigger/retrain \
  -H "x-prediction-key: YOUR_KEY"

# Run first predictions
curl -X POST https://predictions-web.railway.app/trigger/predict \
  -H "x-prediction-key: YOUR_KEY"

# Verify
curl https://your-main-app.railway.app/api/predictions?upcoming=1
```

## API routes on main app

| Route | Method | Auth | Description |
|-------|--------|------|-------------|
| `/api/predictions` | GET | Public | Get predictions (query: fight_id, upcoming, from, to, limit) |
| `/api/predictions/accuracy` | GET | Public | Model accuracy stats |
| `/api/predictions/ingest` | POST | x-prediction-key | Ingest predictions from microservice |
| `/api/predictions/reconcile` | POST | x-prediction-key | Reconcile with actual results |

## Cron schedule (predictions-worker)

| Job | Schedule | Description |
|-----|----------|-------------|
| `daily_predict` | 06:00 UTC daily | Predict next 14 days |
| `refresh_near` | 08:00, 14:00, 20:00 UTC | Refresh next 48h |
| `daily_reconcile` | 07:00 UTC daily | Reconcile last 7 days |
| `weekly_retrain` | Monday 05:00 UTC | Retrain on all data |

## DB schema (added to main app)

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
