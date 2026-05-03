---
applyTo: "server.js,auth/**,db/**,lib/**"
---

# Backend/API Instructions

- Repo invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.
- Main app uses Node.js 22+, CommonJS, Express 5.
- `db/index.js` selects PostgreSQL when `DATABASE_URL` or `DB_BACKEND=postgres` is set; otherwise sql.js/SQLite is used.
- Do not replace the `better-auth/node` dynamic `import()` with `require()`.
- Wrap API routes in `apiHandler()` unless the route is intentionally synchronous and reviewed.
- Keep all DB queries parameterized.
- Preserve security headers, CSP, cache behavior, and `X-App-Version`.
- For picks/auth/prediction-key/admin routes, preserve feature flag and authorization checks.
- Test with the narrowest relevant Node test first, then `npm test`; use `npm run test:e2e` for user-visible route behavior.
