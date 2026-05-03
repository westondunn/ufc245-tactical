---
name: review-testing
description: Review or verify UFC Tactical changes, CI parity, security checks, Playwright coverage, test selection, PR readiness, GitHub workflow behavior, or release/deploy risks.
---

# Review Testing

Use this workflow for reviews, test planning, CI changes, and release readiness.

## Rules

- Repo invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.
- Lead reviews with bugs, regressions, security risks, and missing tests.
- Cite concrete files and lines for findings.
- Check repo invariants: dynamic `better-auth/node` import, `apiHandler()`, parameterized queries, escaped `innerHTML`, data source discipline, and dashboard-style UI.
- Match CI: Node 22, `npm ci`, `npm test`, Python prediction tests, server boot smoke, Playwright Chromium, and gitleaks.
- For docs-only changes, validate links and commands instead of running full runtime tests unless commands appear stale.

## Handoff Checklist

- Identify changed subsystems and likely blast radius.
- Select the narrowest useful tests, then broader CI parity checks.
- For workflow changes, check permissions, version bump behavior, and deploy verification.
- Summarize residual risk after verification.
