---
applyTo: "ufc245-predictions/**"
---

# Predictions Service Instructions

- Repo invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.
- Prediction service is a Python FastAPI app in `ufc245-predictions/`.
- Preserve the main-app contract: `MAIN_APP_URL`, `PREDICTION_SERVICE_KEY`, health responses, trigger endpoints, and prediction sync.
- Keep scheduler jobs explicit and idempotent where possible.
- Model changes should account for feature extraction, persisted model blobs, and prediction log behavior.
- Run:
  - `python ufc245-predictions/tests/test_model.py`
  - `python ufc245-predictions/tests/test_jobs.py`
  - `python ufc245-predictions/tests/test_app.py`
- If the main Express app contract changes too, also run relevant Node tests.
