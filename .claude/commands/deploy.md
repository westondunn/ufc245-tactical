# Deploy

Use this command for Railway deployment checks and release readiness.

Project invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.

## CI Gates

- Main app: `npm test`
- E2E: `npm run test:e2e`
- Prediction service:
  - `python ufc245-predictions/tests/test_model.py`
  - `python ufc245-predictions/tests/test_jobs.py`
  - `python ufc245-predictions/tests/test_app.py`
- Server boot smoke and security header checks run in `.github/workflows/ci.yml`.

## Version Bump Rules

`.github/workflows/deploy.yml` bumps versions from the first commit subject:

- `feat:` or `feat(scope):` -> minor
- `fix:` and other non-breaking changes -> patch
- `BREAKING CHANGE:` trailer or `type!:` subject -> major
- `[skip-version]` skips the bump loop.

## Deployment Notes

- Railway deploys from `main` through the GitHub integration.
- Preserve `RAILWAY_WEB_URL`, `RAILWAY_PREDICTIONS_URL`, and `PREDICTION_SERVICE_KEY` verification behavior.
- Do not change auth startup, CSP, or health contracts without matching CI and deploy verification updates.
