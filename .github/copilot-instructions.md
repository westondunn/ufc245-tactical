# GitHub Copilot Instructions

Follow `AGENTS.md` as the canonical project brief.

This repo is a UFC Tactical dashboard with a Node.js 22+ CommonJS Express 5 main app, sql.js/SQLite fallback, optional PostgreSQL via `DATABASE_URL`, a vanilla dashboard frontend, and a Python FastAPI prediction service.

Required rules:

- Do not replace the `better-auth/node` dynamic `import()` in `server.js` with `require()`.
- Use `apiHandler()` for API routes unless intentionally synchronous and reviewed.
- Keep DB queries parameterized.
- Escape API-sourced HTML with `escHtml()` or equivalent before `innerHTML`.
- Preserve security headers and `X-App-Version`.
- Use credible fight data sources only; do not fabricate fight data, results, stats, profile metrics, or biomechanics sources.
- Keep UI work dense and operational, matching the existing dense dashboard.
- Prefer targeted tests before broad tests, then `npm test`, `npm run test:e2e`, or prediction Python tests as appropriate.

Useful commands:

- `npm test`
- `npm run test:e2e`
- `python data/generate_seed.py`
- `python ufc245-predictions/tests/test_model.py`
- `python ufc245-predictions/tests/test_jobs.py`
- `python ufc245-predictions/tests/test_app.py`
