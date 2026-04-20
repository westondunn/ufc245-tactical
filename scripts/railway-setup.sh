#!/usr/bin/env bash
# ============================================================
# railway-setup.sh — Automated Railway deployment for predictions
#
# Prerequisites:
#   1. railway CLI installed (npm i -g @railway/cli)
#   2. railway login (run interactively first)
#   3. Main app service already deployed on Railway
#
# Usage:
#   cd ufc245-tactical
#   bash scripts/railway-setup.sh
#
# What this does:
#   - Generates a shared PREDICTION_SERVICE_KEY
#   - Sets it on the existing main app service
#   - Creates the predictions web service
#   - Creates the predictions worker service (scheduler)
#   - Wires env vars on both new services
#   - Triggers first deploy
#   - Runs bootstrap (retrain + first predict)
# ============================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[setup]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
fail() { echo -e "${RED}[error]${NC} $*"; exit 1; }

# ── Preflight checks ──
command -v railway >/dev/null 2>&1 || fail "railway CLI not found. Install: npm i -g @railway/cli"
railway whoami >/dev/null 2>&1    || fail "Not logged in. Run: railway login"

# ── Detect project ──
log "Detecting Railway project..."
PROJECT_ID=$(railway status --json 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.projectId||j.project?.id||'')}
    catch{console.log('')}
  })
" 2>/dev/null || echo "")

if [ -z "$PROJECT_ID" ]; then
  log "No project linked. Listing your projects..."
  railway project list 2>/dev/null || true
  echo ""
  read -rp "Enter your Railway project ID (or press Enter to create new): " PROJECT_ID
  if [ -z "$PROJECT_ID" ]; then
    log "Creating new Railway project: ufc-tactical"
    PROJECT_ID=$(railway project create --name ufc-tactical --json | node -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        const j=JSON.parse(d);console.log(j.id||j.projectId||'')
      })
    ")
    [ -z "$PROJECT_ID" ] && fail "Could not create project"
    ok "Created project: $PROJECT_ID"
  fi
  railway link "$PROJECT_ID"
  ok "Linked to project"
fi

log "Project: $PROJECT_ID"

# ── Find main app service ──
log "Looking for existing main app service..."
MAIN_SERVICE=$(railway service list --json 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{
      const svcs=JSON.parse(d);
      const main=svcs.find(s=>
        s.name?.includes('ufc') || s.name?.includes('tactical') || s.name?.includes('main')
      );
      console.log(main?.id||svcs[0]?.id||'')
    }catch{console.log('')}
  })
" 2>/dev/null || echo "")

if [ -z "$MAIN_SERVICE" ]; then
  fail "No services found. Deploy the main app first, then re-run this script."
fi
ok "Main app service: $MAIN_SERVICE"

# ── Generate shared key ──
PREDICTION_KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
log "Generated PREDICTION_SERVICE_KEY: ${PREDICTION_KEY:0:8}..."

# ── Set key on main app ──
log "Setting PREDICTION_SERVICE_KEY on main app..."
railway variables set PREDICTION_SERVICE_KEY="$PREDICTION_KEY" --service "$MAIN_SERVICE" 2>/dev/null
ok "Main app env var set"

# ── Get main app domain ──
log "Fetching main app URL..."
MAIN_URL=$(railway domain --json --service "$MAIN_SERVICE" 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log('https://'+j.domain||'')}
    catch{console.log('')}
  })
" 2>/dev/null || echo "")

if [ -z "$MAIN_URL" ] || [ "$MAIN_URL" = "https://" ]; then
  read -rp "Could not auto-detect main app URL. Enter it (e.g. https://your-app.railway.app): " MAIN_URL
fi
ok "Main app URL: $MAIN_URL"

# ── Create predictions web service ──
log "Creating predictions-web service..."
PRED_WEB_ID=$(railway service create --name predictions-web --json 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.id||'')}catch{console.log('')}
  })
" 2>/dev/null || echo "")

if [ -z "$PRED_WEB_ID" ]; then
  log "Service may already exist, trying to find it..."
  PRED_WEB_ID=$(railway service list --json 2>/dev/null | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const svcs=JSON.parse(d);const s=svcs.find(s=>s.name==='predictions-web');console.log(s?.id||'')}
      catch{console.log('')}
    })
  " 2>/dev/null || echo "")
fi
[ -z "$PRED_WEB_ID" ] && fail "Could not create or find predictions-web service"
ok "predictions-web service: $PRED_WEB_ID"

# ── Create predictions worker service ──
log "Creating predictions-worker service..."
PRED_WORKER_ID=$(railway service create --name predictions-worker --json 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.id||'')}catch{console.log('')}
  })
" 2>/dev/null || echo "")

if [ -z "$PRED_WORKER_ID" ]; then
  PRED_WORKER_ID=$(railway service list --json 2>/dev/null | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const svcs=JSON.parse(d);const s=svcs.find(s=>s.name==='predictions-worker');console.log(s?.id||'')}
      catch{console.log('')}
    })
  " 2>/dev/null || echo "")
fi
[ -z "$PRED_WORKER_ID" ] && fail "Could not create or find predictions-worker service"
ok "predictions-worker service: $PRED_WORKER_ID"

# ── Configure predictions-web ──
log "Configuring predictions-web..."
railway variables set \
  MAIN_APP_URL="$MAIN_URL" \
  PREDICTION_SERVICE_KEY="$PREDICTION_KEY" \
  NIXPACKS_CONFIG_FILE="ufc245-predictions/nixpacks.toml" \
  --service "$PRED_WEB_ID" 2>/dev/null
ok "predictions-web env vars set"

# ── Configure predictions-worker ──
log "Configuring predictions-worker..."
railway variables set \
  MAIN_APP_URL="$MAIN_URL" \
  PREDICTION_SERVICE_KEY="$PREDICTION_KEY" \
  NIXPACKS_CONFIG_FILE="ufc245-predictions/nixpacks.toml" \
  --service "$PRED_WORKER_ID" 2>/dev/null
ok "predictions-worker env vars set"

# ── Deploy main app (picks up new env var) ──
log "Redeploying main app with PREDICTION_SERVICE_KEY..."
railway up --service "$MAIN_SERVICE" --detach 2>/dev/null || true
ok "Main app deploy triggered"

# ── Deploy predictions services ──
log "Deploying predictions-web..."
railway up --service "$PRED_WEB_ID" --detach 2>/dev/null || true
ok "predictions-web deploy triggered"

log "Deploying predictions-worker..."
railway up --service "$PRED_WORKER_ID" --detach 2>/dev/null || true
ok "predictions-worker deploy triggered"

# ── Summary ──
echo ""
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Railway deployment initiated${NC}"
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Main app:          ${CYAN}$MAIN_URL${NC}"
echo -e "  PREDICTION_KEY:    ${CYAN}${PREDICTION_KEY:0:8}...${NC}"
echo -e "  predictions-web:   ${CYAN}$PRED_WEB_ID${NC}"
echo -e "  predictions-worker:${CYAN}$PRED_WORKER_ID${NC}"
echo ""
echo -e "  ${BOLD}After deploy completes, run the bootstrap:${NC}"
echo ""
echo -e "    bash scripts/railway-bootstrap.sh"
echo ""
echo -e "  Or manually:"
echo -e "    railway domain --service $PRED_WEB_ID"
echo -e "    curl -X POST https://<predictions-domain>/trigger/retrain \\"
echo -e "      -H 'x-prediction-key: $PREDICTION_KEY'"
echo ""
