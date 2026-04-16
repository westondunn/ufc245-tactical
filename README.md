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

The `PORT` env var is injected by Railway — the server reads `process.env.PORT` and falls back to `3000` locally. No other env vars needed.

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
