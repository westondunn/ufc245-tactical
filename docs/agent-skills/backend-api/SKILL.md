---
name: backend-api
description: Work on the UFC Tactical Node/Express backend, API routes, auth bootstrap, DB adapters, validation, security headers, picks/admin/prediction endpoints, or backend tests.
---

# Backend API

Use this workflow for `server.js`, `auth/**`, `db/**`, and backend modules in `lib/**`.

## Rules

- Repo invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.
- Main app is Node.js 22+, CommonJS, Express 5.
- SQLite uses sql.js by default; PostgreSQL is selected by `DATABASE_URL` or `DB_BACKEND=postgres`.
- Do not replace the `better-auth/node` dynamic `import()` with `require()`.
- Wrap API routes in `apiHandler()` unless intentionally synchronous and reviewed.
- Keep DB queries parameterized.
- Preserve security headers, CSP, cache headers, and `X-App-Version`.
- Escape API-sourced HTML at render sites with `escHtml()` or equivalent.
- Fight data and biomechanics claims must cite credible sources; do not fabricate data.

## Handoff Checklist

- State the route or module ownership.
- Identify auth, feature flag, admin, or prediction-key requirements.
- Identify SQLite/PostgreSQL compatibility needs.
- Specify validation and error response behavior.
- Run targeted tests first; run `npm test` for shared backend behavior.
