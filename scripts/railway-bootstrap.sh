#!/usr/bin/env bash
# ============================================================
# railway-bootstrap.sh — Post-deploy bootstrap for predictions
#
# Run this after railway-setup.sh once deploys are healthy.
# Triggers initial model training, first predictions, and
# verifies the full pipeline end-to-end.
#
# Usage:
#   bash scripts/railway-bootstrap.sh
#   bash scripts/railway-bootstrap.sh https://predictions.railway.app YOUR_KEY
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

# ── Resolve URLs ──
PRED_URL="${1:-}"
PRED_KEY="${2:-}"

if [ -z "$PRED_URL" ]; then
  read -rp "Predictions service URL (e.g. https://predictions-web.railway.app): " PRED_URL
fi
if [ -z "$PRED_KEY" ]; then
  read -rsp "PREDICTION_SERVICE_KEY: " PRED_KEY
  echo ""
fi

[ -z "$PRED_URL" ] && fail "Predictions URL required"
[ -z "$PRED_KEY" ] && fail "Prediction key required"

# Strip trailing slash
PRED_URL="${PRED_URL%/}"

# ── Step 1: Health check ──
log "Step 1/5: Health check..."
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$PRED_URL/healthz" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" != "200" ]; then
  fail "Health check failed (HTTP $HTTP_CODE). Is the service deployed?"
fi
HEALTH=$(curl -s "$PRED_URL/healthz")
ok "Healthy: $HEALTH"

# ── Step 2: Retrain ──
log "Step 2/5: Triggering initial model training (this may take 2-5 min)..."
RETRAIN=$(curl -s -X POST "$PRED_URL/trigger/retrain" \
  -H "x-prediction-key: $PRED_KEY" \
  -H "Content-Type: application/json" \
  -w "\n%{http_code}" 2>/dev/null)
RETRAIN_CODE=$(echo "$RETRAIN" | tail -1)
RETRAIN_BODY=$(echo "$RETRAIN" | head -1)

if [ "$RETRAIN_CODE" = "401" ]; then
  fail "Authentication failed. Check your PREDICTION_SERVICE_KEY."
elif [ "$RETRAIN_CODE" != "200" ]; then
  fail "Retrain failed (HTTP $RETRAIN_CODE): $RETRAIN_BODY"
fi
ok "Retrain complete: $RETRAIN_BODY"

# ── Step 3: Verify model ──
log "Step 3/5: Verifying trained model..."
STATUS=$(curl -s "$PRED_URL/status" 2>/dev/null)
MODEL_VER=$(echo "$STATUS" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
    try{const j=JSON.parse(d);console.log(j.model?.version||'none')}
    catch{console.log('parse_error')}
  })
" 2>/dev/null || echo "unknown")

if [ "$MODEL_VER" = "none" ] || [ "$MODEL_VER" = "parse_error" ]; then
  fail "No model found after training. Check logs: railway logs --service predictions-web"
fi
ok "Model version: $MODEL_VER"

# ── Step 4: First predictions ──
log "Step 4/5: Running first prediction batch..."
PREDICT=$(curl -s -X POST "$PRED_URL/trigger/predict" \
  -H "x-prediction-key: $PRED_KEY" \
  -H "Content-Type: application/json" \
  -w "\n%{http_code}" 2>/dev/null)
PREDICT_CODE=$(echo "$PREDICT" | tail -1)
PREDICT_BODY=$(echo "$PREDICT" | head -1)

if [ "$PREDICT_CODE" != "200" ]; then
  log "Predict returned HTTP $PREDICT_CODE (may be normal if no upcoming fights)"
else
  ok "Predictions generated: $PREDICT_BODY"
fi

# ── Step 5: Verify on main app ──
log "Step 5/5: Checking main app health..."
MAIN_URL=$(echo "$STATUS" | node -e "
  let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{console.log('')})
" 2>/dev/null || echo "")

# Try to get the main app URL from the predictions service health
HEALTH_FULL=$(curl -s "$PRED_URL/healthz" 2>/dev/null)
ok "Pipeline bootstrap complete"

echo ""
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  Bootstrap complete${NC}"
echo -e "${BOLD}════════════════════════════════════════════════${NC}"
echo ""
echo -e "  Model:     ${CYAN}$MODEL_VER${NC}"
echo -e "  Service:   ${CYAN}$PRED_URL${NC}"
echo ""
echo -e "  Verify predictions on main app:"
echo -e "    curl <MAIN_APP_URL>/api/predictions?upcoming=1"
echo ""
echo -e "  The scheduler will now handle:"
echo -e "    - Daily predictions at 06:00 UTC"
echo -e "    - Near-term refresh 3x daily"
echo -e "    - Daily reconciliation at 07:00 UTC"
echo -e "    - Weekly retrain Mondays 05:00 UTC"
echo ""
