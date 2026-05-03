# UFC Tactical Agent Guide

This is the canonical project brief for coding agents working in this repo. Keep tool-specific files thin and aligned with this file.

## Project Shape

- Main app: Node.js 22+, CommonJS, Express 5, `server.js`.
- Frontend: dense dashboard UI in `public/index.html`, `public/js/app.js`, and `public/css/styles.css`.
- Database: `db/index.js` selects PostgreSQL when `DATABASE_URL` or `DB_BACKEND=postgres` is set; otherwise sql.js/SQLite is used.
- Auth: `better-auth/node` is ESM-only and is loaded by dynamic `import()` during async bootstrap. Do not change it back to `require()`.
- Predictions service: Python FastAPI app in `ufc245-predictions/` with scheduler jobs and model tests.
- Data/ETL: seed data, UFCStats/UFC.com scrapers, audit, and backfill tooling live in `data/` and `scripts/`.

## Required Rules

- Use `apiHandler()` for API routes unless the handler is intentionally synchronous and reviewed.
- Keep DB access parameterized; never build SQL with untrusted string interpolation.
- Escape API-sourced HTML with `escHtml()` or equivalent before assigning to `innerHTML`.
- Preserve security headers and the `X-App-Version` response header in `server.js`.
- Fight data must come from official or credible sources. Do not fabricate missing stats, results, profile data, or biomechanics claims.
- Keep frontend work consistent with the existing operational dashboard. Do not turn app surfaces into marketing pages.
- Run targeted tests before broad tests, and avoid broad refactors unless they directly reduce risk for the requested change.

## Commands

- Install: `npm install`
- Main app dev/server: `npm run dev` or `npm start`
- Main tests: `npm test`
- E2E tests: `npm run test:e2e`
- Prediction tests:
  - `python ufc245-predictions/tests/test_model.py`
  - `python ufc245-predictions/tests/test_jobs.py`
  - `python ufc245-predictions/tests/test_app.py`
- Regenerate seed data after editing `data/generate_seed.py`: `python data/generate_seed.py`

## Handoff Defaults

- Backend/API: call out route shape, auth/flag requirements, DB adapter impact, validation, and tests.
- Frontend/UI: call out render path, escaping, responsive states, and Playwright coverage.
- Data/ETL: call out source URLs, parser changes, generated artifacts, and integrity checks.
- Predictions: call out FastAPI contract, scheduler impact, model features, and main-app sync.
- Review/testing: lead with findings, cite files/lines, then summarize verification.
