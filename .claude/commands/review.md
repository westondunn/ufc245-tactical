# Code Review

Use the `review-testing` skill. Lead with findings, then summarize verification.

Project invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.

## Checklist

- `better-auth/node` remains dynamically imported; no `require()` regression.
- API routes use `apiHandler()` unless intentionally synchronous and reviewed.
- DB queries are parameterized.
- API-sourced `innerHTML` uses `escHtml()` or equivalent.
- CSP, security headers, cache behavior, and `X-App-Version` are preserved.
- Fight data and biomechanics claims have credible sources; no fabricated values.
- Frontend remains a dense dashboard and renders correctly on mobile and desktop.
- Prediction service changes preserve health, trigger, scheduler, and sync contracts.
- GitHub workflow changes preserve CI gates, version bump behavior, and deploy verification.

## Commands

```bash
npm test
npm run test:e2e
python ufc245-predictions/tests/test_model.py
python ufc245-predictions/tests/test_jobs.py
python ufc245-predictions/tests/test_app.py
```
