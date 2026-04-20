#!/usr/bin/env bash
# ============================================================
# railway-setup.sh — Automated Railway deployment for predictions
#
# What this does:
#   - Generates a shared PREDICTION_SERVICE_KEY
#   - Sets it on the existing main app service
#   - Creates/updates a single predictions service
#   - Wires env vars for durability + in-process scheduler
#   - Triggers deploys on main + predictions services
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

command -v railway >/dev/null 2>&1 || fail "railway CLI not found. Install: npm i -g @railway/cli"
railway whoami >/dev/null 2>&1 || fail "Not logged in. Run: railway login"

log "Detecting Railway project..."
PROJECT_ID=$(railway status --json 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.projectId||j.project?.id||'')}
    catch{console.log('')}
  })
" 2>/dev/null || echo "")

if [ -z "$PROJECT_ID" ]; then
  fail "No Railway project linked. Run: railway link"
fi
ok "Project: $PROJECT_ID"

log "Looking for existing main app service..."
MAIN_SERVICE=$(railway service list --json 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{
      const svcs=JSON.parse(d);
      const preferred=svcs.find(s=>{
        const n=(s.name||'').toLowerCase();
        return !n.includes('prediction') && (n.includes('ufc') || n.includes('tactical') || n.includes('main'));
      });
      const fallback=svcs.find(s=>!(s.name||'').toLowerCase().includes('prediction'));
      console.log(preferred?.id || fallback?.id || svcs[0]?.id || '');
    }catch{console.log('')}
  })
" 2>/dev/null || echo "")
[ -z "$MAIN_SERVICE" ] && fail "No services found. Deploy the main app first."
ok "Main app service: $MAIN_SERVICE"

PREDICTION_KEY=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
log "Generated PREDICTION_SERVICE_KEY: ${PREDICTION_KEY:0:8}..."

log "Setting PREDICTION_SERVICE_KEY on main app..."
railway variables set PREDICTION_SERVICE_KEY="$PREDICTION_KEY" --service "$MAIN_SERVICE" >/dev/null
ok "Main app key set"

log "Resolving main app URL..."
MAIN_URL=$(railway domain --json --service "$MAIN_SERVICE" 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.domain ? ('https://'+j.domain) : '')}
    catch{console.log('')}
  })
" 2>/dev/null || echo "")
if [ -z "$MAIN_URL" ]; then
  read -rp "Main app URL (e.g. https://your-main-app.railway.app): " MAIN_URL
fi
[ -z "$MAIN_URL" ] && fail "Main app URL is required"
ok "Main app URL: $MAIN_URL"

log "Creating/finding predictions service..."
PRED_SERVICE_ID=$(railway service create --name predictions --json 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.id||'')}catch{console.log('')}
  })
" 2>/dev/null || echo "")
if [ -z "$PRED_SERVICE_ID" ]; then
  PRED_SERVICE_ID=$(railway service list --json 2>/dev/null | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{
        const svcs=JSON.parse(d);
        const s=svcs.find(s=>(s.name||'').toLowerCase()==='predictions');
        console.log(s?.id||'');
      }catch{console.log('')}
    })
  " 2>/dev/null || echo "")
fi
[ -z "$PRED_SERVICE_ID" ] && fail "Could not create or find predictions service"
ok "Predictions service: $PRED_SERVICE_ID"

log "Configuring predictions service vars..."
railway variables set \
  MAIN_APP_URL="$MAIN_URL" \
  PREDICTION_SERVICE_KEY="$PREDICTION_KEY" \
  PREDICTIONS_DB_PATH="/data/predictions.db" \
  MODEL_DIR="/data/model_store" \
  ENABLE_SCHEDULER="1" \
  NIXPACKS_CONFIG_FILE="ufc245-predictions/nixpacks.toml" \
  --service "$PRED_SERVICE_ID" >/dev/null
ok "Predictions env vars set"

log "Deploying main app..."
railway up --service "$MAIN_SERVICE" --detach >/dev/null || true
ok "Main app deploy triggered"

log "Deploying predictions service..."
railway up --service "$PRED_SERVICE_ID" --detach >/dev/null || true
ok "Predictions deploy triggered"

echo ""
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Railway deployment initiated${NC}"
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Main app URL:      ${CYAN}$MAIN_URL${NC}"
echo -e "  Predictions svc:   ${CYAN}$PRED_SERVICE_ID${NC}"
echo -e "  PREDICTION_KEY:    ${CYAN}${PREDICTION_KEY:0:8}...${NC}"
echo ""
echo -e "  Next:"
echo -e "    bash scripts/railway-bootstrap.sh https://<predictions-domain> $PREDICTION_KEY $MAIN_URL"
echo -e "    # get predictions domain with: railway domain --service $PRED_SERVICE_ID"
echo ""
