---
applyTo: "tests/**,.github/workflows/**,playwright.config.js,package.json,package-lock.json"
---

# Review/Testing Instructions

- Repo invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.
- Match CI before inventing new gates: Node 22, `npm ci`, `npm test`, prediction Python tests, server boot smoke, and Playwright Chromium.
- For reviews, lead with bugs, regressions, security risks, and missing tests; cite file/line references.
- Keep workflow changes careful around version bumping, deploy verification, and GitHub token permissions.
- Use `npm test` for main app coverage and `npm run test:e2e` for browser behavior.
- Run prediction Python tests when `ufc245-predictions/**` behavior or contracts change.
- Do not add flaky sleeps where polling or deterministic checks are possible.
