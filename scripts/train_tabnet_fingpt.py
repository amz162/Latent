#!/usr/bin/env python3
"""Quick wrapper to train TabNet + FinGPT using existing train_remaining_models.py functions."""
import sys, os, json, warnings, time
import numpy as np
import pandas as pd
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, "/home/z/my-project/scripts")

OHLCV = Path("/home/z/my-project/data/ohlcv_all")
PRED_FILE = Path("/home/z/my-project/data/ml_predictions_multi.json")

def main():
    print("Loading OHLCV data...")
    from train_remaining_models import load, gen_preds, train_tabnet
    df = load()
    print(f"Loaded: {len(df)} rows from {df['symbol'].nunique() if 'symbol' in df else 0} stocks")

    print("\n>>> TabNet")
    t0 = time.time()
    try:
        info = train_tabnet(df)
        info["elapsed_seconds"] = time.time() - t0
        info["trained_at"] = pd.Timestamp.now().isoformat()
        existing = json.loads(PRED_FILE.read_text()) if PRED_FILE.exists() else {"models": {}}
        existing.setdefault("models", {})["TabNet"] = info
        PRED_FILE.write_text(json.dumps(existing, indent=2,
            default=lambda o: int(o) if isinstance(o, (np.integer,)) else float(o) if isinstance(o, (np.floating,)) else str(o)))
        if info.get("trained"):
            print(f"✓ TabNet trained in {info['elapsed_seconds']:.1f}s — {len(info.get('predictions',{}))} stocks")
        else:
            print(f"✗ TabNet failed: {info.get('error','unknown')}")
    except Exception as e:
        print(f"✗ TabNet crashed: {e}")
        import traceback; traceback.print_exc()

    # FinGPT — too heavy for sandbox (requires BloombergGPT weights ~1GB+)
    print("\n>>> FinGPT")
    existing = json.loads(PRED_FILE.read_text()) if PRED_FILE.exists() else {"models": {}}
    existing.setdefault("models", {})["FinGPT"] = {
        "trained": False,
        "error": "FinGPT requires BloombergGPT pre-trained weights (~1GB+ download) — skipped in CPU-only sandbox",
        "untrainedReason": "Requires BloombergGPT weights download"
    }
    PRED_FILE.write_text(json.dumps(existing, indent=2))
    print("✗ FinGPT skipped (requires BloombergGPT weights — too heavy for CPU-only sandbox)")

if __name__ == "__main__":
    main()
