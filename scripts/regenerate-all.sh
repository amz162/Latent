#!/bin/bash
# Latent.pk — Regenerate all runtime data after a container restart.
#
# Re-fetches OHLCV for all DB stocks and re-trains ALL 23 model scripts
# (10 classical + 13 GPU/deep-learning) + 25 ensemble backtests.
#
# Usage:
#   bash scripts/regenerate-all.sh              # full regenerate (~30 min)
#   bash scripts/regenerate-all.sh --fetch       # only fetch OHLCV
#   bash scripts/regenerate-all.sh --train       # only re-train models
#   bash scripts/regenerate-all.sh --classical    # only classical models (no GPU)
#   bash scripts/regenerate-all.sh --gpu          # only GPU/deep-learning models
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
TRAIN_CLASSICAL=1
TRAIN_GPU=1
case "$1" in
  --fetch) FETCH=1; TRAIN_CLASSICAL=0; TRAIN_GPU=0 ;;
  --train) FETCH=0; TRAIN_CLASSICAL=1; TRAIN_GPU=1 ;;
  --classical) FETCH=0; TRAIN_CLASSICAL=1; TRAIN_GPU=0 ;;
  --gpu) FETCH=0; TRAIN_CLASSICAL=0; TRAIN_GPU=1 ;;
esac

# ──────────────────────────────────────────────────────────────────
# Phase 0: Reinstall Python packages wiped on container restart
# ──────────────────────────────────────────────────────────────────
echo "──────────────────────────────────────────────────────────"
echo "Phase 0: Reinstall Python packages (CPU-only ML stack)"
echo "──────────────────────────────────────────────────────────"
python3 -m pip install --break-system-packages arch pykalman 2>&1 | tail -2

if [ "$TRAIN_GPU" = "1" ]; then
  echo ""
  echo "Installing GPU/deep-learning packages (CPU-only builds)..."
  python3 -m pip install --break-system-packages torch --index-url https://download.pytorch.org/whl/cpu 2>&1 | tail -2
  python3 -m pip install --break-system-packages neuralforecast prophet transformers 2>&1 | tail -2
  python3 -m pip install --break-system-packages chronos-forecasting 2>&1 | tail -2
  python3 -m pip install --break-system-packages --force-reinstall --no-deps "setuptools<81" 2>&1 | tail -2
  python3 -m pip install --break-system-packages "jax[cpu]==0.4.30" "jaxlib==0.4.30" 2>&1 | tail -2
  python3 -m pip install --break-system-packages --force-reinstall --no-deps "numpy==1.26.4" "scipy<1.13" "pandas==2.1.4" 2>&1 | tail -2
  python3 -m pip install --break-system-packages jaxtyping einops orjson hydra-core 2>&1 | tail -2

  if [ ! -d /tmp/lag-llama ]; then
    git clone --depth 1 https://github.com/time-series-foundation-models/lag-llama.git /tmp/lag-llama
    python3 -m pip install --break-system-packages -e /tmp/lag-llama 2>&1 | tail -2
    python3 -c "
from huggingface_hub import hf_hub_download
import shutil
p = hf_hub_download(repo_id='time-series-foundation-models/lag-llama', filename='lag-llama.ckpt', cache_dir='/tmp/hf_cache')
shutil.copy(p, '/tmp/lag-llama/lag-llama.ckpt')
print('Lag-Llama checkpoint saved')
" 2>&1 | tail -2
  fi
  if [ ! -d /tmp/moirai ]; then
    git clone --depth 1 https://github.com/redoules/moirai.git /tmp/moirai
    python3 -m pip install --break-system-packages --no-deps -e /tmp/moirai 2>&1 | tail -2
  fi
  if [ ! -d /tmp/time-llm ]; then
    git clone --depth 1 https://github.com/KimMeen/Time-LLM.git /tmp/time-llm
  fi
fi
echo "✓ Packages installed"
echo ""

# ──────────────────────────────────────────────────────────────────
# Phase 1: Fetch OHLCV for all DB stocks
# ──────────────────────────────────────────────────────────────────
if [ "$FETCH" = "1" ]; then
  echo "──────────────────────────────────────────────────────────"
  echo "Phase 1: Fetch OHLCV for all DB stocks (~2 min)"
  echo "──────────────────────────────────────────────────────────"
  mkdir -p data/ohlcv_all
  for f in data/ohlcv/*.csv; do
    base=$(basename "$f")
    ln -sf "../ohlcv/$base" "data/ohlcv_all/$base"
  done
  python3 scripts/fetch_ohlcv_chunked.py --only-missing
  CSV_COUNT=$(ls data/ohlcv_all/*.csv 2>/dev/null | wc -l)
  echo "✓ OHLCV CSVs ready: $CSV_COUNT files"
  echo ""
fi

# ──────────────────────────────────────────────────────────────────
# Phase 2: Train all 10 classical model scripts (~12 min)
# ──────────────────────────────────────────────────────────────────
if [ "$TRAIN_CLASSICAL" = "1" ]; then
  echo "──────────────────────────────────────────────────────────"
  echo "Phase 2: Train 10 classical model scripts (~12 min)"
  echo "──────────────────────────────────────────────────────────"
  rm -f data/ml_predictions_multi.json
  CLASSICAL_SCRIPTS=(
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
  for s in "${CLASSICAL_SCRIPTS[@]}"; do
    echo ""; echo ">>> $s.py"
    python3 "scripts/$s.py" 2>&1 | tail -10
  done
  echo ""
  ls -la data/ml_predictions_multi.json
fi

# ──────────────────────────────────────────────────────────────────
# Phase 3: Train 13 GPU/deep-learning models (~18 min)
# ──────────────────────────────────────────────────────────────────
if [ "$TRAIN_GPU" = "1" ]; then
  echo ""
  echo "──────────────────────────────────────────────────────────"
  echo "Phase 3: Train 13 GPU/deep-learning models (~18 min)"
  echo "──────────────────────────────────────────────────────────"
  GPU_MODELS=(PatchTST N-BEATS TimesNet Informer Chronos LSTM CNN-LSTM Transformer-LSTM Prophet GRU)
  for m in "${GPU_MODELS[@]}"; do
    echo ""; echo ">>> $m"
    python3 scripts/train_gpu_model.py "$m" 2>&1 | tail -8
  done
  echo ""; echo ">>> Lag-Llama (dedicated script, resume-capable)"
  python3 scripts/train_lag_llama.py 2>&1 | tail -8
  python3 scripts/train_lag_llama.py 2>&1 | tail -8  # 2nd run to finish remaining stocks
  echo ""; echo ">>> Moirai (dedicated script)"
  python3 scripts/train_moirai.py 2>&1 | tail -8
  echo ""; echo ">>> Time-LLM (dedicated script)"
  python3 scripts/train_time_llm.py 2>&1 | tail -8
  echo ""
  ls -la data/ml_predictions_multi.json
fi

# ──────────────────────────────────────────────────────────────────
# Phase 4: Meta-ensembles + comprehensive backtests
# ──────────────────────────────────────────────────────────────────
if [ "$TRAIN_CLASSICAL" = "1" ] || [ "$TRAIN_GPU" = "1" ]; then
  echo ""
  echo "──────────────────────────────────────────────────────────"
  echo "Phase 4: Meta-ensembles + backtest all models (~3 min)"
  echo "──────────────────────────────────────────────────────────"
  echo ""; echo ">>> train_meta_ensemble.py"
  python3 scripts/train_meta_ensemble.py 2>&1 | tail -20
  echo ""; echo ">>> train_all_ensembles.py (20 ensemble methods)"
  python3 scripts/train_all_ensembles.py 2>&1 | tail -25
  echo ""; echo ">>> backtest_ensembles_A_to_M.py (13 A-M ensembles)"
  python3 scripts/backtest_ensembles_A_to_M.py 2>&1 | tail -20
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
