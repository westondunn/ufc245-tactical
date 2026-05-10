# UFC Tactical Agent Guide

This is the canonical project brief for coding agents working in this repo. Keep tool-specific files thin and aligned with this file.

## Project Shape

- Main app: Node.js 22+, CommonJS, Express 5, `server.js`.
- Frontend: dense dashboard UI in `public/index.html`, `public/js/app.js`, and `public/css/styles.css`.
- Database: `db/index.js` selects PostgreSQL when `DATABASE_URL` or `DB_BACKEND=postgres` is set; otherwise sql.js/SQLite is used.
- Auth: `better-auth/node` is ESM-only and is loaded by dynamic `import()` during async bootstrap. Do not change it back to `require()`.
- Predictions service: Python FastAPI app in `ufc245-predictions/` with scheduler jobs and model tests.
- Data/ETL: seed data, UFCStats/UFC.com scrapers, audit, and backfill tooling live in `data/` and `scripts/`.

## Required Rules

- Use `apiHandler()` for API routes unless the handler is intentionally synchronous and reviewed.
- Keep DB access parameterized; never build SQL with untrusted string interpolation.
- Escape API-sourced HTML with `escHtml()` or equivalent before assigning to `innerHTML`.
- Preserve security headers and the `X-App-Version` response header in `server.js`.
- Fight data must come from official or credible sources. Do not fabricate missing stats, results, profile data, or biomechanics claims.
- Keep frontend work consistent with the existing operational dashboard. Do not turn app surfaces into marketing pages.
- Run targeted tests before broad tests, and avoid broad refactors unless they directly reduce risk for the requested change.

## Commands

- Install: `npm install`
- Main app dev/server: `npm run dev` or `npm start`
- Main tests: `npm test`
- E2E tests: `npm run test:e2e`
- Prediction tests:
  - `python ufc245-predictions/tests/test_model.py`
  - `python ufc245-predictions/tests/test_jobs.py`
  - `python ufc245-predictions/tests/test_app.py`
- Regenerate seed data after editing `data/generate_seed.py`: `python data/generate_seed.py`

## Handoff Defaults

- Backend/API: call out route shape, auth/flag requirements, DB adapter impact, validation, and tests.
- Frontend/UI: call out render path, escaping, responsive states, and Playwright coverage.
- Data/ETL: call out source URLs, parser changes, generated artifacts, and integrity checks.
- Predictions: call out FastAPI contract, scheduler impact, model features, and main-app sync.
- Review/testing: lead with findings, cite files/lines, then summarize verification.

## Branch + PR strategy

All changes ship via pull request. Direct pushes to `main` are not used.

- **Branching**: cut a feature branch from `main` for every change. Naming convention is `<scope>/<short-kebab-desc>`:
  - `feat/<thing>`, `fix/<thing>`, `refactor/<thing>`, `chore/<thing>`
  - Subsystem prefixes are also fine: `ci/<thing>`, `db/<thing>`, `picks/<thing>`, `predictions/<thing>`
  - Avoid putting issue numbers or dates in branch names; the PR carries that context.
- **One logical change per PR**. Multi-concern branches make the e2e selector and reviewers' lives harder. Stack PRs if a chain is needed.
- **Conventional Commit subjects**, since `deploy.yml`'s version-bump derives the bump type from the merge commit's first line:
  - `feat:` → minor; `fix:` / `chore:` / `refactor:` / `ci:` / `docs:` → patch; `feat!:` or trailer `BREAKING CHANGE:` → major.
- **Self-merge is allowed** once CI is green. The branch-protection ruleset requires a PR but does not require a second reviewer.
- **Don't push back to `main` directly** even after a PR is merged. The version-bump workflow handles the post-merge `vX.Y.Z [skip-version]` commit + tag via a fine-grained PAT (`RELEASE_TOKEN` secret) that bypasses the ruleset; humans don't get that bypass and shouldn't try to.
- **Do not skip hooks (`--no-verify`) or bypass signing** unless the user explicitly asks for it. Same for `git push --force` — never to `main`, and only with explicit go on a feature branch.

### Picking the e2e scope

The `Playwright E2E` job uses `.github/scripts/select-e2e.js` to pick which spec files to run based on the PR diff. Agents don't have to think about which suite their change touches — the routing table handles it:

- `public/css/**`, `public/img/**`, `public/icons/**` → `dashboard`
- `public/index.html` → `dashboard` + `picks`
- `public/js/auth.js` → `admin` + `picks`
- `public/js/app.js`, other `public/js/**` → `dashboard` + `picks`
- `server.js`, `db/**`, `lib/**` → all four suites
- `auth/**` → `admin` + `picks`
- `data/seed.json`, `data/admin/**` → `api` + `admin`
- `data/scrapers/**`, `scripts/**`, `data/audit/**` → skip (covered by `node tests/run.js`)
- `ufc245-predictions/**`, `llm-pipeline/**` → skip (python tests / no e2e coverage)
- `*.md`, `docs/**`, `tmp/**` → skip
- `package.json`, `package-lock.json`, `playwright.config.js`, `.github/**` → all (force-full)
- anything unmapped → all (conservative default)

If a path is genuinely ambiguous, lean toward leaving it unmapped (full suite) rather than carving in a narrow rule that drifts as code moves.

**Escape hatches** in the commit message or PR title:

- `[full-e2e]` — force every spec to run regardless of paths.
- `[skip-e2e]` — skip the suite entirely. Use sparingly (the routing table already skips docs/scratch/data-only diffs cleanly).

When you change the routing rules, the `select-e2e.test.js` self-test runs in the `Quality & Security` job and gates the PR — keep adding cases there alongside any rule edits.

### Local pre-push checks

Before opening a PR, run the targeted suite plus the static gates the quality job runs:

```
node tests/run.js
node .github/scripts/select-e2e.test.js   # if you touched routing rules
npx playwright test tests/e2e/<scope>.spec.js   # the suite(s) your change maps to
```

If you don't know which spec maps to your diff, pipe the changed paths through the selector:

```
git diff --name-only origin/main...HEAD | node .github/scripts/select-e2e.js --format=args
```

Then run only those.
