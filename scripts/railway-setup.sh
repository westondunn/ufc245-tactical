#!/usr/bin/env bash
# ============================================================
# railway-setup.sh — Automated Railway deployment for predictions
#
# Modes:
#   - single (default): one predictions service (API + scheduler)
#   - split (--split): predictions-web + predictions-worker services
#
# Usage:
#   bash scripts/railway-setup.sh
#   bash scripts/railway-setup.sh --split
# ============================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[setup]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
warn() { echo -e "${CYAN}[warn]${NC} $*"; }
fail() { echo -e "${RED}[error]${NC} $*"; exit 1; }

MODE="single"
for arg in "$@"; do
  case "$arg" in
    --split) MODE="split" ;;
    --single) MODE="single" ;;
    *) fail "Unknown argument: $arg (supported: --split, --single)" ;;
  esac
done

command -v railway >/dev/null 2>&1 || fail "railway CLI not found. Install: npm i -g @railway/cli"
railway whoami >/dev/null 2>&1 || fail "Not logged in. Run: railway login"

create_or_find_service() {
  local service_name="$1"
  local service_id=""
  service_id=$(railway service create --name "$service_name" --json 2>/dev/null | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const j=JSON.parse(d);console.log(j.id||'')}catch{console.log('')}
    })
  " 2>/dev/null || echo "")
  if [ -z "$service_id" ]; then
    service_id=$(railway service list --json 2>/dev/null | node -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        try{
          const svcs=JSON.parse(d);
          const s=svcs.find(s=>(s.name||'').toLowerCase()==='${service_name}');
          console.log(s?.id||'');
        }catch{console.log('')}
      })
    " 2>/dev/null || echo "")
  fi
  [ -n "$service_id" ] || fail "Could not create or find service: $service_name"
  echo "$service_id"
}

log "Detecting Railway project..."
PROJECT_ID=$(railway status --json 2>/dev/null | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.projectId||j.project?.id||'')}
    catch{console.log('')}
  })
" 2>/dev/null || echo "")
[ -n "$PROJECT_ID" ] || fail "No Railway project linked. Run: railway link"
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
[ -n "$MAIN_SERVICE" ] || fail "No services found. Deploy the main app first."
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
[ -n "$MAIN_URL" ] || fail "Main app URL is required"
ok "Main app URL: $MAIN_URL"

if [ "$MODE" = "single" ]; then
  log "Mode: single-service predictions"
  PRED_SERVICE_ID=$(create_or_find_service "predictions")
  ok "Predictions service: $PRED_SERVICE_ID"

  log "Configuring predictions vars..."
  railway variables set \
    MAIN_APP_URL="$MAIN_URL" \
    PREDICTION_SERVICE_KEY="$PREDICTION_KEY" \
    PREDICTIONS_DB_PATH="/data/predictions.db" \
    MODEL_DIR="/data/model_store" \
    ENABLE_SCHEDULER="1" \
    DEPLOYMENT_MODE="single" \
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
  echo -e "${GREEN}  Railway deployment initiated (single mode)${NC}"
  echo -e "${BOLD}════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "  Main app URL:      ${CYAN}$MAIN_URL${NC}"
  echo -e "  Predictions svc:   ${CYAN}$PRED_SERVICE_ID${NC}"
  echo -e "  PREDICTION_KEY:    ${CYAN}${PREDICTION_KEY:0:8}...${NC}"
  echo ""
  echo -e "  Next:"
  echo -e "    bash scripts/railway-bootstrap.sh https://<predictions-domain> $PREDICTION_KEY $MAIN_URL"
  echo -e "    # domain: railway domain --service $PRED_SERVICE_ID"
  echo ""
  exit 0
fi

log "Mode: split-service predictions"
warn "Split mode uses separate web/worker runtime state. Keep manual triggers to a minimum."

PRED_WEB_ID=$(create_or_find_service "predictions-web")
PRED_WORKER_ID=$(create_or_find_service "predictions-worker")
ok "predictions-web: $PRED_WEB_ID"
ok "predictions-worker: $PRED_WORKER_ID"

log "Configuring predictions-web vars..."
railway variables set \
  MAIN_APP_URL="$MAIN_URL" \
  PREDICTION_SERVICE_KEY="$PREDICTION_KEY" \
  PREDICTIONS_DB_PATH="/data/predictions-web.db" \
  MODEL_DIR="/data/model-web-store" \
  ENABLE_SCHEDULER="0" \
  DEPLOYMENT_MODE="split-web" \
  NIXPACKS_CONFIG_FILE="ufc245-predictions/nixpacks.web.toml" \
  --service "$PRED_WEB_ID" >/dev/null
ok "predictions-web env vars set"

log "Configuring predictions-worker vars..."
railway variables set \
  MAIN_APP_URL="$MAIN_URL" \
  PREDICTION_SERVICE_KEY="$PREDICTION_KEY" \
  PREDICTIONS_DB_PATH="/data/predictions-worker.db" \
  MODEL_DIR="/data/model-worker-store" \
  ENABLE_SCHEDULER="1" \
  DEPLOYMENT_MODE="split-worker" \
  NIXPACKS_CONFIG_FILE="ufc245-predictions/nixpacks.worker.toml" \
  --service "$PRED_WORKER_ID" >/dev/null
ok "predictions-worker env vars set"

log "Deploying main app..."
railway up --service "$MAIN_SERVICE" --detach >/dev/null || true
ok "Main app deploy triggered"

log "Deploying predictions-web..."
railway up --service "$PRED_WEB_ID" --detach >/dev/null || true
ok "predictions-web deploy triggered"

log "Deploying predictions-worker..."
railway up --service "$PRED_WORKER_ID" --detach >/dev/null || true
ok "predictions-worker deploy triggered"

echo ""
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Railway deployment initiated (split mode)${NC}"
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Main app URL:         ${CYAN}$MAIN_URL${NC}"
echo -e "  predictions-web:      ${CYAN}$PRED_WEB_ID${NC}"
echo -e "  predictions-worker:   ${CYAN}$PRED_WORKER_ID${NC}"
echo -e "  PREDICTION_KEY:       ${CYAN}${PREDICTION_KEY:0:8}...${NC}"
echo ""
echo -e "  Next:"
echo -e "    bash scripts/railway-bootstrap.sh --split https://<predictions-web-domain> $PREDICTION_KEY $MAIN_URL"
echo -e "    # web domain: railway domain --service $PRED_WEB_ID"
echo ""
