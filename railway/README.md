# Railway service config

This repository uses Railway config-as-code with one `railway.json` per deployable service.

| Railway service | Root Directory | Config File Path | Runtime |
| --- | --- | --- | --- |
| `web` | `/` | `/railway.json` | Node/Express |
| `predictions` | `ufc245-predictions` | `/ufc245-predictions/railway.json` | FastAPI/Uvicorn |
| `Postgres` | managed plugin | Railway managed | PostgreSQL |

Important: keep the `predictions` service root directory set to `ufc245-predictions`. If it stays at `/`, Railway will read the root `railway.json` and start `npm start`, which launches the web app instead of the prediction service.

## Required variables

### `web`

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
PREDICTION_SERVICE_KEY=<shared strong key>
PREDICTIONS_URL=https://predictions-production-fd63.up.railway.app
ADMIN_KEY=<shared admin key>
```

### `predictions`

```text
MAIN_APP_URL=https://web-production-96d6e.up.railway.app
PREDICTION_SERVICE_KEY=<same shared key as web>
PREDICTIONS_DB_PATH=/data/predictions.db
MODEL_DIR=/data/model_store
ENABLE_SCHEDULER=1
DEPLOYMENT_MODE=single
```

Do not set `NIXPACKS_CONFIG_FILE` for the predictions service when its root directory is `ufc245-predictions`; Railway will use `ufc245-predictions/nixpacks.toml` automatically from that root.
