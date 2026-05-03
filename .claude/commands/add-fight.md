# Add Fight

Add or correct UFC fight data using the `data-etl` skill.

Project invariants: Node.js 22+, CommonJS main app, Express 5, sql.js/SQLite fallback, PostgreSQL when `DATABASE_URL` is set, dynamic `better-auth/node` import only, `apiHandler()` for API routes, parameterized DB queries, `escHtml()` for API-sourced `innerHTML`, credible fight data sources only, dense dashboard UI, targeted tests before broad tests.

## Required Inputs

- Event number, name, date, venue, city, and country when available.
- Red and blue fighter profile fields: name, nickname, height, reach, stance, weight class, nationality, and DOB when available.
- Result fields: method, detail, round, time, referee, winner, title/main status, and card position.
- Source URLs or citations for every new fact.

## Workflow

1. Search existing fighters/events/fights before adding duplicates.
2. Edit `data/generate_seed.py` when source seed data changes.
3. Regenerate with `python data/generate_seed.py`.
4. Run targeted integrity checks, then `npm test`.
5. Keep DB/API rules from `AGENTS.md`: parameterized queries, `apiHandler()`, escaped frontend rendering.

## Source Rules

- Prefer UFCStats.com for official results and fight stats.
- Use UFC.com or other credible references for fighter profiles.
- Never fabricate missing stats, profile values, or outcomes.
