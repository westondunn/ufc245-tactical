# UFC 245 · Usman vs. Covington · Tactical Dashboard

Interactive broadcast-style tactical analysis for the UFC 245 welterweight title fight (14 Dec 2019). Built from official UFCStats.com round-by-round data, ESPN corner audio, NSAC medical documentation, and peer-reviewed striking biomechanics literature.

**Live demo · run locally:** `npm install && npm start` → `http://localhost:3000`

---

## Project structure

```
ufc245-tactical/
├── public/
│   └── index.html         ← the dashboard (single-file, self-contained)
├── server.js              ← Express static server + health check
├── package.json           ← Node 18+, Express 4, compression
├── railway.json           ← Railway build + healthcheck config
├── Procfile               ← fallback process type
├── .gitignore
└── README.md
```

### What the server does

- Serves `public/index.html` with gzip/brotli compression
- Sets strict security headers (CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy)
- CSP whitelists Google Fonts (Barlow Condensed + JetBrains Mono) — no other external origins
- Exposes `GET /healthz` returning `{ status, uptime_s, node, env }` for Railway's health check
- SPA-friendly 404 → serves the dashboard (useful if you want to add routes later)
- Handles SIGTERM/SIGINT gracefully (critical for zero-downtime deploys)
- One-line request log per hit

---

## Deploy to Railway

Two paths, choose your fighter.

### Option A · Railway CLI (fastest · ~2 minutes)

```bash
# 1. Install the CLI (one-time)
npm install -g @railway/cli

# 2. Authenticate (opens browser)
railway login

# 3. From this project directory:
cd ufc245-tactical
railway init            # create a new project · pick a name
railway up              # build + deploy

# 4. Generate a public URL
railway domain          # auto-generates a *.up.railway.app subdomain
```

That's it. The dashboard will be live at the generated URL within 60–90 seconds.

**Useful follow-ups:**
```bash
railway logs            # live tail
railway status          # deployment info
railway open            # open project in browser
railway variables       # manage env vars (none required for this app)
```

### Option B · GitHub → Railway (recommended for ongoing ownership)

1. Push this directory to a new GitHub repo:
   ```bash
   cd ufc245-tactical
   git init
   git add .
   git commit -m "UFC 245 tactical dashboard · initial"
   git branch -M main
   git remote add origin git@github.com:YOUR_USER/ufc245-tactical.git
   git push -u origin main
   ```

2. On [railway.app](https://railway.app):
   - **New Project** → **Deploy from GitHub repo** → authorize & pick your repo
   - Railway auto-detects Node.js via Nixpacks, uses `npm start` from `package.json`
   - In **Settings → Networking**, click **Generate Domain** for a public URL

Every `git push` to `main` now triggers an auto-deploy.

### Option C · Docker (optional, for other platforms)

A Dockerfile is not included but would be trivial:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

---

## Railway config details

`railway.json` specifies:

| Key | Value | Why |
|---|---|---|
| `builder` | `NIXPACKS` | Auto-detects Node, runs `npm install` → `npm start` |
| `healthcheckPath` | `/healthz` | Railway pings this after deploy; must return 200 for rollout |
| `healthcheckTimeout` | `60` | Generous window for cold start |
| `restartPolicyType` | `ON_FAILURE` | Auto-restart on crash |
| `restartPolicyMaxRetries` | `10` | Then give up |

The `PORT` env var is injected by Railway — the server reads `process.env.PORT` and falls back to `3000` locally.

Database backend selection:
- Set `DATABASE_URL` to use PostgreSQL (recommended on Railway).
- If `DATABASE_URL` is unset, the app uses the built-in sql.js/SQLite backend (`DB_PATH` optional for file persistence).

---

## Local development

```bash
npm install
npm run dev          # sets NODE_ENV=development
# or
npm start            # production mode
```

Visit `http://localhost:3000`.

Dashboard changes = just edit `public/index.html` and refresh. It's a single self-contained file (~95KB).

---

## CommonJS / ESM compatibility (better-auth)

**TL;DR:** `better-auth/node` is ESM-only from v1.6.9+. Do not use `require()` to load it — it will crash on Node.js v22+ with `ERR_REQUIRE_ESM`.

### The problem

`better-auth` v1.6.9 changed its Node.js adapter (`better-auth/node`) to ship exclusively as an ES Module (`.mjs`). Node.js v22 enforces strict ESM/CJS boundaries: calling `require()` on an `.mjs` file throws `ERR_REQUIRE_ESM` and crashes the process at startup.

```
Error [ERR_REQUIRE_ESM]: require() of ES Module .../better-auth/node.mjs not supported.
```

### The solution

`server.js` loads `better-auth/node` via a **dynamic `import()`** inside the async bootstrap IIFE at the bottom of the file. This is the only way to consume an ESM module from a CommonJS (`.js`) file at runtime.

```js
// ✅ Correct — dynamic import inside async function
const { toNodeHandler, fromNodeHeaders } = await import('better-auth/node');

// ❌ Wrong — throws ERR_REQUIRE_ESM on Node 22+
const { toNodeHandler, fromNodeHeaders } = require('better-auth/node');
```

The bootstrap pattern (async IIFE) is necessary because top-level `await` is not available in CommonJS modules. The auth route is registered inside the bootstrap after the import resolves, so it is always ready before the server begins accepting connections.

### Rules for future maintainers

- **Do not** convert the dynamic `import()` back to `require()`.
- **Do not** move the `import()` call outside the async bootstrap function.
- If you upgrade `better-auth`, check `node_modules/better-auth/package.json` under the `"exports"` → `"node"` condition to verify whether a CJS build has been added before changing the import strategy.
- A runtime safeguard in the bootstrap validates that `toNodeHandler` and `fromNodeHeaders` are functions after import. If they are not, the server exits immediately with a descriptive error rather than silently serving broken auth routes.

---

## Fight Picks

An additive, feature-flagged pick-em layer: users create a local profile
(display name + avatar — no email, no password), pick winners on any
event's fight card with optional confidence / method / round / notes,
and compete on event and all-time leaderboards after results reconcile.

Every pick snapshots the current model prediction at the moment of
writing, so "beating the model" is measurable per-pick and
leaderboard-visible.

### Enabling the feature

The entire stack is gated by a single env var:

```bash
ENABLE_PICKS=true
```

When unset (the default), the Picks tab is hidden, `/api/version`
reports `features.picks = false`, and every pick-related endpoint
returns `503 picks_disabled`. Existing endpoints are unchanged.

### Env vars

| Var | Required | Default | Purpose |
|---|---|---|---|
| `ENABLE_PICKS` | yes | `false` | Master flag. Set to `true` to expose the Picks tab + API. |
| `ADMIN_KEY` | for admin ops | — | Shared secret for `POST /api/admin/events/:id/lock-picks`, `/reconcile-picks`, `/api/admin/reconcile-all-picks`. |
| `PREDICTION_SERVICE_KEY` | to ingest model preds | — | Existing key for the prediction microservice. The snapshots layer reads whichever predictions it has. |
| `DATABASE_URL` | for Postgres | — | If set, picks persist there. Otherwise sqlite (see next row). |
| `DB_PATH` | sqlite only | — | With the sqlite backend, set this to a writable path so picks + users survive restarts. Without it everything is in-memory. |
| `PICKS_RATE_LIMIT_CREATE_USER` | no | `5` | Max new profiles per IP per hour. |
| `PICKS_RATE_LIMIT_PER_MIN` | no | `60` | Max pick writes per user per minute. |

### Scoring formula

Deterministic, server-authoritative, idempotent on re-reconcile.
Lives in [`lib/scoring.js`](lib/scoring.js).

Per pick, after the fight's `winner_id` is set:

| Component | Points | Trigger |
|---|---|---|
| Winner points | `round(10 × confidence / 50)` → 0–20 | Correct pick |
| Method bonus | +5 | `method_pick` matches normalized actual method |
| Round bonus | +5 | `round_pick` matches actual round |
| Upset bonus | +5 | Correct AND disagreed with the model snapshot |

**Max 35 points per fight · never negative.** Incorrect picks always
score 0. Draws / No Contest void every pick on that fight
(`correct = 0, points = 0`). Re-running reconcile produces identical
point totals.

### User flow

1. User clicks the **Picks** tab → create-profile modal auto-opens
   (first visit per session).
2. Display name + one of 12 avatar colors → `POST /api/users` → the
   server-issued UUID is stored in `localStorage['ufc_user']`.
3. Back on the tab, the event picker defaults to UFC 245 (the demo
   event). Switching events loads the card, existing picks, and
   model-comparison in parallel.
4. For each fight, users pick a winner, move the confidence slider
   (0–100), optionally select method / round, and write notes up to
   280 chars. Save → `POST /api/picks` with `X-User-Id` header.
5. After event results land (`fights.winner_id` set), admin runs
   `POST /api/admin/events/:id/reconcile-picks` or
   `POST /api/admin/reconcile-all-picks` for the whole DB.
6. History + leaderboard views update. The stats strip shows
   Points / Accuracy / Beat-the-model / Avg-per-pick.

### Key API endpoints

All gated by `ENABLE_PICKS`. Writes need an `X-User-Id` header.

| Method | Path | Protection |
|---|---|---|
| POST | `/api/users` | rate-limited per IP |
| GET | `/api/users/:id` | none |
| PATCH | `/api/users/:id` | `X-User-Id` must match `:id` |
| GET | `/api/users/:id/picks` | none (query: `event_id`, `reconciled=0|1`) |
| GET | `/api/users/:id/stats` | none |
| POST | `/api/picks` | `X-User-Id` + rate limit |
| DELETE | `/api/picks/:pickId` | `X-User-Id` must own pick |
| GET | `/api/leaderboard` | none |
| GET | `/api/events/:id/picks/leaderboard` | none |
| GET | `/api/events/:id/picks/model-comparison` | none |
| POST | `/api/admin/events/:id/lock-picks` | `X-Admin-Key` |
| POST | `/api/admin/events/:id/reconcile-picks` | `X-Admin-Key` |
| POST | `/api/admin/reconcile-all-picks` | `X-Admin-Key` |

### Local demo data

To populate the three subviews (Upcoming / History / Leaderboard)
with realistic data during local dev, use the seeder script:

```bash
DB_PATH=/tmp/ufc-picks-demo.db node scripts/seed-demo-picks.js
DB_PATH=/tmp/ufc-picks-demo.db \
  ENABLE_PICKS=true ADMIN_KEY=test PORT=3100 node server.js
```

The script creates 4 demo users (Weston / Friend A / Friend B /
Sharp Eye), ingests a `demo-v0.3` model prediction per fight on the
5 most recent events, writes ~25–35 picks per user, and reconciles
everything. The printed UUIDs can be pasted into the
**Switch profile** flow in the UI for instant cross-user demos.
The script is idempotent — rerunning deletes + recreates the demo
users without touching other data.

### Rollout checklist (Railway)

1. Confirm `DATABASE_URL` is already set (predictions feature). If
   on sqlite, set `DB_PATH=/data/ufc.db` or similar to a mounted
   volume so picks + users persist.
2. Set `ADMIN_KEY` to a strong random value.
3. Flip the feature flag: `ENABLE_PICKS=true`.
4. Deploy. After rollout, verify:
   - `GET /healthz` reports `features.picks: true`
   - `GET /api/version` reports `features.picks: true`
   - Loading the app shows the **Picks** tab
   - Creating a profile returns 200 (watch for 429 if rate limits
     are too tight — tune `PICKS_RATE_LIMIT_*` if needed)
5. Feature can be rolled back instantly by unsetting
   `ENABLE_PICKS`. No schema migration is needed — all four new
   tables (`users`, `user_picks`, `pick_model_snapshots`) are
   additive and left alone when the flag is off.

---

## Data sources & credits

- **Strike-by-strike stats:** [UFCStats.com official fight page](http://ufcstats.com/fight-details/82177c0f91d9618a)
- **Play-by-play & timing:** Sherdog, MMA Mania, ESPN round-by-round
- **Scorecards:** theScore, MMA Junkie
- **Medical:** UFC medical staff statement, Nevada State Athletic Commission suspensions
- **Biomechanics:**
  - Walilko, Viano & Bir (2005) — Olympic boxer punch force (Br J Sports Med)
  - Kacprzak et al. (2025) — Effective mass in boxing punches (Applied Sciences)
  - Dunn et al. (2023) — Elite amateur boxer strike forces (PLOS ONE)
  - Corcoran et al. (2024) — Kick biomechanics meta-review (Sports)
  - Mandible fracture threshold: cadaver impact study (PubMed 18227031)

All fighter-specific force values are **estimates scaled from the published cohorts** — no fighter-specific force plate data exists publicly for either athlete. Estimates are flagged as such in the dashboard UI.

---

## License & use

Data sourced from public records. Dashboard code and visualization design © 2026 — use freely for non-commercial analysis, scouting, and educational purposes.
