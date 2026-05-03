---
name: data-etl
description: Work on UFC Tactical seed data, UFCStats/UFC.com scrapers, audit/backfill modules, scripts, generated data files, source verification, or data integrity tests.
---

# Data ETL

Use this workflow for `data/**` and `scripts/**`.

## Rules

- Repo invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.
- Fight data must come from official or credible sources such as UFCStats.com, UFC.com, ESPN, athletic commissions, or cited papers.
- Do not fabricate missing stats, fighter attributes, event data, results, or source citations.
- After editing `data/generate_seed.py`, regenerate with `python data/generate_seed.py`.
- Keep scraper parsing reusable and testable; CLI wrappers should stay thin.
- Preserve audit/backfill confidence gates and review queues.
- Keep shared DB changes compatible with both sql.js/SQLite and PostgreSQL.
- Preserve API safety rules: `apiHandler()`, parameterized queries, and escaped frontend rendering.

## Handoff Checklist

- List source URLs or source classes used.
- State generated files that must be updated.
- Identify manual-review versus safe automated backfill cases.
- Run targeted scraper/audit/backfill tests, then `npm test`.
