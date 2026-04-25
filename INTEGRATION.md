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

## Main app database backend

Main app now supports two DB backends:

- `DATABASE_URL` set → PostgreSQL backend (recommended on Railway)
- `DATABASE_URL` unset → existing sql.js/SQLite backend (`DB_PATH` optional)

For Railway with a Postgres plugin attached to the main app service:

```bash
railway variables set DATABASE_URL="${{Postgres.DATABASE_URL}}" --service <main-service>
```

Notes:
- Keep `DB_PATH` only if you intentionally want SQLite fallback in non-Postgres environments.
- Existing API contracts are unchanged.

## Railway config-as-code

Each Railway service must point at its own service root so Railway reads the right `railway.json`:

| Service | Root Directory | Config File Path | Notes |
|---------|----------------|-------------|-------|
| `web` | `/` | `/railway.json` | Node/Express app; starts with `npm start` |
| `predictions` | `ufc245-predictions` | `/ufc245-predictions/railway.json` | FastAPI service; starts with `uvicorn` |
| `Postgres` | managed plugin | Railway managed | Attach to `web` through `DATABASE_URL` |

This matters in a monorepo: if `predictions` is left at root `/`, Railway can inherit the web app start command from the root `railway.json` and run `npm start` instead of Uvicorn.

For the current single-service prediction topology, remove `NIXPACKS_CONFIG_FILE` from `predictions` once the service root is `ufc245-predictions`; Railway will find `nixpacks.toml` from that root.

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
```

`predictions-worker` env:
```
MAIN_APP_URL=https://your-main-app.railway.app
PREDICTION_SERVICE_KEY=<same key as main app>
PREDICTIONS_DB_PATH=/data/predictions-worker.db
MODEL_DIR=/data/model-worker-store
ENABLE_SCHEDULER=1
DEPLOYMENT_MODE=split-worker
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

## Railway Function (copy/paste)

Use this in a Railway HTTP Function (Bun runtime) for operational triggers.
Set function env vars:
- `PREDICTIONS_URL` (e.g. `https://predictions.railway.app`)
- `MAIN_APP_URL` (e.g. `https://main.railway.app`)
- `PREDICTION_SERVICE_KEY`

```ts
const PREDICTIONS_URL = (process.env.PREDICTIONS_URL || "").replace(/\/+$/, "");
const MAIN_APP_URL = (process.env.MAIN_APP_URL || "").replace(/\/+$/, "");
const KEY = process.env.PREDICTION_SERVICE_KEY || "";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function call(path: string, method = "POST") {
  const res = await fetch(`${PREDICTIONS_URL}${path}`, {
    method,
    headers: { "x-prediction-key": KEY }
  });
  const text = await res.text();
  let data: unknown = text;
  try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data };
}

Bun.serve({
  port: Number(process.env.PORT || 3000),
  async fetch(req) {
    if (!PREDICTIONS_URL || !MAIN_APP_URL || !KEY) {
      return json(500, { error: "missing_env", required: ["PREDICTIONS_URL", "MAIN_APP_URL", "PREDICTION_SERVICE_KEY"] });
    }

    const url = new URL(req.url);
    const action = (url.searchParams.get("action") || "daily").toLowerCase();

    try {
      if (action === "health") {
        const p = await fetch(`${PREDICTIONS_URL}/healthz`);
        const m = await fetch(`${MAIN_APP_URL}/healthz`);
        return json(200, { predictions: p.status, main: m.status });
      }

      if (action === "retrain") {
        const retrain = await call("/trigger/retrain");
        return json(retrain.ok ? 200 : 502, { action, retrain });
      }

      if (action === "predict") {
        const predict = await call("/trigger/predict");
        const sync = await call("/trigger/sync");
        const upcoming = await fetch(`${MAIN_APP_URL}/api/predictions?upcoming=1`);
        const upcomingData = await upcoming.json();
        return json(predict.ok && sync.ok ? 200 : 502, { action, predict, sync, upcoming_count: Array.isArray(upcomingData) ? upcomingData.length : null });
      }

      // default: daily run
      const predict = await call("/trigger/predict");
      const reconcile = await call("/trigger/reconcile");
      const sync = await call("/trigger/sync");
      const upcoming = await fetch(`${MAIN_APP_URL}/api/predictions?upcoming=1`);
      const upcomingData = await upcoming.json();

      const ok = predict.ok && reconcile.ok && sync.ok;
      return json(ok ? 200 : 502, {
        action: "daily",
        predict,
        reconcile,
        sync,
        upcoming_count: Array.isArray(upcomingData) ? upcomingData.length : null
      });
    } catch (err) {
      return json(500, { error: "function_failed", message: err instanceof Error ? err.message : String(err) });
    }
  }
});
```
