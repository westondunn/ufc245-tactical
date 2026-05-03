---
name: predictions-service
description: Work on the UFC Tactical Python prediction microservice, FastAPI routes, scheduler jobs, model features, training/prediction sync, health contracts, or prediction service tests.
---

# Predictions Service

Use this workflow for `ufc245-predictions/**`.

## Rules

- Repo invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.
- Prediction service is Python FastAPI with scheduler jobs and local model/prediction persistence.
- Preserve `MAIN_APP_URL`, `PREDICTION_SERVICE_KEY`, health response fields, trigger endpoints, and sync behavior.
- Keep jobs idempotent where possible; avoid duplicating unsynced prediction rows.
- Model changes should account for feature extraction, persisted model blobs, and test fixtures.
- Do not fabricate fight outcomes or training data.
- If main app API contracts change, keep Node.js 22+/Express 5 backend rules intact, including dynamic `better-auth/node` import and parameterized DB access.

## Handoff Checklist

- State whether the change affects API, scheduler, model, DB, or sync.
- Identify env vars and main-app endpoint contracts.
- Run:
  - `python ufc245-predictions/tests/test_model.py`
  - `python ufc245-predictions/tests/test_jobs.py`
  - `python ufc245-predictions/tests/test_app.py`
