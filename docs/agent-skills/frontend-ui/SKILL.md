---
name: frontend-ui
description: Work on the UFC Tactical dashboard frontend in public/index.html, public/js/app.js, public/css/styles.css, browser interactions, rendering, responsive layout, escaping, or Playwright coverage.
---

# Frontend UI

Use this workflow for dashboard UI work in `public/**`.

## Rules

- Repo invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.
- Keep the app as a dense operational dashboard, not a marketing page.
- API-sourced `innerHTML` must use `escHtml()` or equivalent escaping.
- Preserve existing navigation, tabs, picks, comparison, predictions, and 3D/dashboard affordances unless the task explicitly changes them.
- Maintain responsive behavior around 375px mobile and 1440px desktop.
- Avoid text overlap, unstable controls, and layout shift.
- Respect Node.js 22+, Express 5, sql.js/SQLite fallback, and PostgreSQL contracts when frontend work depends on API behavior.
- Do not change the `better-auth/node` dynamic import pattern.

## Handoff Checklist

- State which view or render path owns the change.
- Note any API contract assumptions.
- Include empty/loading/error states where user-visible.
- Run targeted checks and `npm run test:e2e` for meaningful browser behavior.
