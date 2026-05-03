---
applyTo: "public/**"
---

# Frontend/UI Instructions

- Repo invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.
- The frontend is a dense operational dashboard in `public/index.html`, `public/js/app.js`, and `public/css/styles.css`.
- Keep visual changes consistent with the existing dashboard, not a marketing or landing page treatment.
- API-sourced `innerHTML` must use `escHtml()` or equivalent escaping.
- Preserve responsive behavior for mobile around 375px and desktop around 1440px.
- Keep controls stable in size; avoid text overlap and layout shift.
- Use Playwright coverage for meaningful UI or interaction changes with `npm run test:e2e`.
- Run `npm test` when frontend changes affect server-rendered contracts or shared app assumptions.
