# Contributing to UFC Tactical Dashboard

Thanks for your interest! This project welcomes contributions — from adding fight data to building new visualizations.

## Quick Start

```bash
git clone https://github.com/westondunn/ufc245-tactical.git
cd ufc245-tactical
npm install
npm run dev     # http://localhost:3000
node tests/run.js  # run test suite
```

## How to Contribute

### Adding Fight Data (easiest way to contribute)

1. Edit `data/generate_seed.py`
2. Add fighters with `F(name, nickname, height_cm, reach_cm, stance, weight_class, nationality)`
3. Add events with `E(number, name, date, venue, city)`
4. Add fights with `FIGHT(event_id, red_id, blue_id, weight_class, is_title, is_main, position, method, detail, round, time, winner_id)`
5. Run `npm run seed` to regenerate `data/seed.json`
6. Verify with `node tests/run.js`
7. Submit a PR

**Data sourcing rules:**
- Fight results from [UFCStats.com](http://ufcstats.com/) (official UFC statistics)
- Fighter profiles from UFC.com or Wikipedia
- Biomechanics from peer-reviewed papers only (cite in the code)
- Never fabricate stats — if data isn't available, leave it out

### Adding Features

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make changes
4. Run `node tests/run.js` — all tests must pass
5. Submit a PR using the template

### Architecture Overview

```
server.js              → Express server + API routes
db/index.js            → DB backend selector (Postgres or SQLite)
db/postgres.js         → PostgreSQL database layer
db/sqlite.js           → SQLite (sql.js) database layer
lib/biomechanics.js    → Force calculation framework
lib/version.js         → Centralized version module
data/seed.json         → Fight database (generated)
data/generate_seed.py  → Seed data generator script
public/index.html      → Dashboard frontend (single-file)
tests/run.js           → Test suite
```

**Key design decisions:**
- **Single HTML file** — the dashboard is self-contained for simplicity. CSS, JS, SVG all inline.
- **Dual backend support** — uses PostgreSQL when `DATABASE_URL` is set, otherwise sql.js/SQLite seeded from JSON.
- **Biomechanics framework** — all force estimates use allometric scaling from peer-reviewed literature. Every number has a citation.
- **Three.js 3D** — the fight recreation uses a WebGL scene that reads joint positions from a hidden SVG layer.

### Security Guidelines

- All API-sourced data rendered via `innerHTML` must be escaped with `escHtml()`
- All API routes must be wrapped in `apiHandler()` for error containment
- All database queries must use parameterized statements (`?` placeholders)
- No secrets in code — use environment variables
- CSP header in `server.js` must be maintained

### Commit Messages

Use conventional-ish prefixes so the auto-version-bumper works:
- `feat:` or `add:` → minor version bump (2.1.0 → 2.2.0)
- `fix:` → patch version bump (2.1.0 → 2.1.1)
- `BREAKING:` → major version bump (2.1.0 → 3.0.0)
- Other prefixes → patch bump

### Quality Gates (enforced by CI)

Every PR must pass:
1. ✅ `node tests/run.js` — full test suite
2. ✅ `npm audit` — no critical vulnerabilities
3. ✅ Seed data integrity — all fight refs valid
4. ✅ HTML structure check — required elements present
5. ✅ Security header check — CSP, nosniff, etc.
6. ✅ No secrets in codebase — grep scan
7. ✅ Server boot test — healthcheck returns 200

## Code of Conduct

Be respectful. This is a technical project about sports analytics. Keep discussions focused on the code and the data.

## License

By contributing, you agree that your contributions will be licensed under the same terms as the project.
