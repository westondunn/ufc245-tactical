---
applyTo: "data/**,scripts/**"
---

# Data/ETL Instructions

- Repo invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.
- Fight data must come from official or credible sources such as UFCStats.com, UFC.com, or cited documentation.
- Do not fabricate missing stats, fighter profile values, event data, or results.
- Regenerate seed data with `python data/generate_seed.py` after editing `data/generate_seed.py`.
- Keep scrapers reusable as libraries where possible; CLI wrappers should stay thin.
- Audit/backfill work should preserve confidence gates and review queues.
- Keep DB writes parameterized and compatible with SQLite and PostgreSQL where shared app data is affected.
- Validate with targeted scraper/audit/backfill tests, then `npm test`.
