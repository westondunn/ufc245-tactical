#!/usr/bin/env bash
# ============================================================
# railway-bootstrap.sh — Post-deploy bootstrap + hard verification
#
# Usage:
#   bash scripts/railway-bootstrap.sh
#   bash scripts/railway-bootstrap.sh https://predictions.railway.app KEY https://main.railway.app
# ============================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log()  { echo -e "${CYAN}[bootstrap]${NC} $*"; }
ok()   { echo -e "${GREEN}[ok]${NC} $*"; }
fail() { echo -e "${RED}[error]${NC} $*"; exit 1; }

PRED_URL="${1:-}"
PRED_KEY="${2:-}"
MAIN_URL="${3:-}"

if [ -z "$PRED_URL" ]; then
  read -rp "Predictions service URL (e.g. https://predictions.railway.app): " PRED_URL
fi
if [ -z "$PRED_KEY" ]; then
  read -rsp "PREDICTION_SERVICE_KEY: " PRED_KEY
  echo ""
fi

[ -z "$PRED_URL" ] && fail "Predictions service URL is required"
[ -z "$PRED_KEY" ] && fail "Prediction key is required"
PRED_URL="${PRED_URL%/}"

log "Step 1/5: Health check..."
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$PRED_URL/healthz" || echo "000")
[ "$HTTP_CODE" = "200" ] || fail "Health check failed (HTTP $HTTP_CODE)"
HEALTH=$(curl -s "$PRED_URL/healthz")
SCHEDULER_RUNNING=$(echo "$HEALTH" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.scheduler_running ? '1' : '0')}
    catch{console.log('0')}
  })
")
[ "$SCHEDULER_RUNNING" = "1" ] || fail "Scheduler is not running in predictions service"
ok "Health is OK and scheduler is running"

log "Step 2/5: Triggering retrain..."
RETRAIN=$(curl -s -X POST "$PRED_URL/trigger/retrain" \
  -H "x-prediction-key: $PRED_KEY" \
  -H "Content-Type: application/json" \
  -w "\n%{http_code}")
RETRAIN_CODE=$(echo "$RETRAIN" | tail -1)
[ "$RETRAIN_CODE" = "200" ] || fail "Retrain failed (HTTP $RETRAIN_CODE): $(echo "$RETRAIN" | head -1)"
ok "Retrain trigger succeeded"

log "Step 3/5: Verifying trained model..."
STATUS=$(curl -s "$PRED_URL/status")
MODEL_VER=$(echo "$STATUS" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.model?.version||'none')}
    catch{console.log('none')}
  })
")
[ "$MODEL_VER" != "none" ] || fail "No trained model found after retrain"
ok "Model version: $MODEL_VER"

log "Step 4/5: Triggering prediction batch..."
PREDICT=$(curl -s -X POST "$PRED_URL/trigger/predict" \
  -H "x-prediction-key: $PRED_KEY" \
  -H "Content-Type: application/json" \
  -w "\n%{http_code}")
PREDICT_CODE=$(echo "$PREDICT" | tail -1)
[ "$PREDICT_CODE" = "200" ] || fail "Predict failed (HTTP $PREDICT_CODE): $(echo "$PREDICT" | head -1)"
ok "Prediction trigger succeeded"

if [ -z "$MAIN_URL" ]; then
  MAIN_URL=$(echo "$STATUS" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const j=JSON.parse(d);console.log(j.main_app_url||'')}
      catch{console.log('')}
    })
  ")
fi
[ -n "$MAIN_URL" ] || fail "Main app URL not provided and unavailable from /status"
MAIN_URL="${MAIN_URL%/}"

log "Step 5/5: Verifying main app predictions endpoint..."
MAIN_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$MAIN_URL/api/predictions?upcoming=1&limit=1" || echo "000")
[ "$MAIN_CODE" = "200" ] || fail "Main app predictions endpoint failed (HTTP $MAIN_CODE)"
MAIN_BODY=$(curl -s "$MAIN_URL/api/predictions?upcoming=1&limit=1")
BODY_VALID=$(echo "$MAIN_BODY" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{
      const j=JSON.parse(d);
      console.log(Array.isArray(j) ? '1' : '0');
    }catch{console.log('0')}
  })
")
[ "$BODY_VALID" = "1" ] || fail "Main app predictions endpoint did not return a JSON array"
ok "Main app predictions endpoint is healthy"

echo ""
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Bootstrap complete${NC}"
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Predictions service: ${CYAN}$PRED_URL${NC}"
echo -e "  Main app URL:        ${CYAN}$MAIN_URL${NC}"
echo -e "  Model:               ${CYAN}$MODEL_VER${NC}"
echo ""
