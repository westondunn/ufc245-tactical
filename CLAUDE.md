# UFC Tactical Claude Guide

Use `AGENTS.md` as the shared project brief. This file keeps Claude-specific entrypoints visible and points to project skills.

## Always Apply

- Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set.
- Do not replace the `better-auth/node` dynamic `import()` in `server.js` with `require()`.
- API routes should use `apiHandler()` unless intentionally synchronous and reviewed.
- API-sourced `innerHTML` must use `escHtml()` or equivalent escaping.
- DB queries must remain parameterized.
- Fight data must cite official or credible sources; never fabricate missing stats.
- Keep frontend changes in the existing dense dashboard style, not a marketing style.
- Run targeted tests first, then broader checks when touching shared behavior.

## Project Skills

Use these project skills from `.claude/skills/` when the task matches:

- `backend-api`: Express routes, auth bootstrap, DB adapters, validation, and security headers.
- `frontend-ui`: dashboard rendering, escaping, responsive UI, and Playwright checks.
- `data-etl`: seed data, scrapers, audit/backfill, and source discipline.
- `predictions-service`: FastAPI prediction service, scheduler jobs, model tests, and main-app contract.
- `review-testing`: CI parity, security review, e2e checks, and PR review checklist.

Existing slash commands in `.claude/commands/` provide explicit workflows for common tasks.
