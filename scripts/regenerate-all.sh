#!/bin/bash
# Latent.pk — Regenerate all runtime data after a container restart.
#
# This script re-fetches OHLCV for all DB stocks and re-trains all
# 10 model scripts sequentially. Run it whenever the container restarts
# (the platform's build only packages the original 8 CSVs — anything
# we generate at runtime is wiped on restart).
#
# Usage:
#   bash scripts/regenerate-all.sh           # full regenerate (~14 min)
#   bash scripts/regenerate-all.sh --fetch   # only fetch OHLCV
#   bash scripts/regenerate-all.sh --train   # only re-train models
#
# Prereqs:
#   - DB (db/custom.db) must already exist (it does, from build time)
#   - python3 with: numpy, pandas, sklearn, xgboost, lightgbm, catboost,
#     statsmodels, arch, pykalman (all installable; torch/neuralforecast
#     are optional and skipped)
set -e
cd /home/z/my-project

LOG_FILE="data/regenerate-$(date +%Y%m%d-%H%M%S).log"
mkdir -p data
echo "Log: $LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "================================================================"
echo "Latent.pk — Regenerate all runtime data"
echo "Started: $(date)"
echo "================================================================"
echo ""

FETCH=1
TRAIN=1
if [ "$1" = "--fetch" ]; then FETCH=1; TRAIN=0; fi
if [ "$1" = "--train" ]; then FETCH=0; TRAIN=1; fi

# ──────────────────────────────────────────────────────────────────
# Phase 1: Fetch OHLCV for all DB stocks
# ──────────────────────────────────────────────────────────────────
if [ "$FETCH" = "1" ]; then
  echo "──────────────────────────────────────────────────────────"
  echo "Phase 1: Fetch OHLCV for all DB stocks"
  echo "──────────────────────────────────────────────────────────"
  mkdir -p data/ohlcv_all
  # Symlink the 8 original CSVs we always have
  for f in data/ohlcv/*.csv; do
    base=$(basename "$f")
    ln -sf "../ohlcv/$base" "data/ohlcv_all/$base"
  done
  # Fetch the rest (chunked, low server load, ~2 min)
  python3 scripts/fetch_ohlcv_chunked.py --only-missing
  CSV_COUNT=$(ls data/ohlcv_all/*.csv 2>/dev/null | wc -l)
  echo "✓ OHLCV CSVs ready: $CSV_COUNT files"
  echo ""
fi

# ──────────────────────────────────────────────────────────────────
# Phase 2: Train all 10 model scripts sequentially
# ──────────────────────────────────────────────────────────────────
if [ "$TRAIN" = "1" ]; then
  echo "──────────────────────────────────────────────────────────"
  echo "Phase 2: Train all 10 model scripts sequentially"
  echo "──────────────────────────────────────────────────────────"
  rm -f data/ml_predictions_multi.json  # start fresh

  SCRIPTS=(
    train_all_with_backtesting
    train_cl_tier
    train_cl_ensembles
    train_cl2_tier
    train_pi_tier
    train_gm_model
    train_cg_model
    train_x_model
    train_gian_model
    train_gian_extender
    train_m_ensemble
  )

  for s in "${SCRIPTS[@]}"; do
    echo ""
    echo ">>> $s.py"
    python3 "scripts/$s.py" 2>&1 | tail -15
  done
  echo ""
  ls -la data/ml_predictions_multi.json
fi

# ──────────────────────────────────────────────────────────────────
# Done
# ──────────────────────────────────────────────────────────────────
echo ""
echo "================================================================"
echo "Regeneration complete: $(date)"
echo "================================================================"
echo ""
echo "Endpoint test:"
curl -s --max-time 15 "http://localhost:81/api/ai-model-signals/ENGRO?refresh=1" \
  -w "\nHTTP %{http_code} | %{size_download} bytes | %{time_total}s\n" \
  | python3 -c "
import json, sys
lines = sys.stdin.read().split('\n')
body = '\n'.join(lines[:-1])
meta = lines[-1] if lines else ''
try:
    d = json.loads(body)
    if 'error' in d:
        print(f'  ERROR: {d[\"error\"]}')
    else:
        fc = d.get('finalConsensus', {})
        print(f'  ENGRO: trained={d.get(\"trainedModelCount\")}/{d.get(\"totalModelCount\")} signal={fc.get(\"signal\")} conf={fc.get(\"confidence\")}% | {meta}')
except:
    print(f'  {meta}')
"
