#!/usr/bin/env python3
"""Latent.pk — Train Lag-Llama (zero-shot) on 769 PSX stocks.

Uses pre-trained checkpoint from HuggingFace (time-series-foundation-models/lag-llama).
Resume-capable: skips stocks already in predictions file. Incremental save every 50 stocks.
"""
import sys, os, json, warnings, time
import numpy as np
import pandas as pd
from pathlib import Path

warnings.filterwarnings("ignore")
sys.path.insert(0, "/tmp/lag-llama")

OHLCV = Path("/home/z/my-project/data/ohlcv_all")
PRED_FILE = Path("/home/z/my-project/data/ml_predictions_multi.json")
STOCKS = sorted([p.stem for p in OHLCV.glob("*.csv")])
MAX_ROWS_PER_STOCK = 180

def load():
    frames = []
    for s in STOCKS:
        p = OHLCV / f"{s}.csv"
        if not p.exists(): continue
        try:
            df = pd.read_csv(p, usecols=range(6))
            df = df[df["volume"] > 0].reset_index(drop=True)
            if len(df) < 50: continue
            if len(df) > MAX_ROWS_PER_STOCK:
                df = df.tail(MAX_ROWS_PER_STOCK).reset_index(drop=True)
            df["symbol"] = s
            frames.append(df)
        except Exception: continue
    return frames

def build_gluonts_dataset(frames):
    from gluonts.dataset.common import ListDataset
    data = []
    for df in frames:
        if len(df) < 90: continue
        s = df["symbol"].iloc[0]
        start_ts = pd.to_datetime(df["date"].iloc[0], unit="ms")
        data.append({"target": df["close"].values.astype(np.float32), "start": start_ts, "item_id": s, "feat_static_cat": [0]})
    return ListDataset(data, freq="D")

def main():
    print(f"\n{'='*60}\nLag-Llama zero-shot prediction\nStocks: {len(STOCKS)}\n{'='*60}\n")
    t0 = time.time()
    import torch
    _orig_load = torch.load
    def _patched_load(*args, **kwargs):
        kwargs["weights_only"] = False
        return _orig_load(*args, **kwargs)
    torch.load = _patched_load
    from lag_llama.gluon.estimator import LagLlamaEstimator

    CKPT = "/tmp/lag-llama/lag-llama.ckpt"
    if not os.path.exists(CKPT):
        print(f"Checkpoint not found at {CKPT}"); return

    print("Creating LagLlamaEstimator (loading checkpoint)...")
    estimator = LagLlamaEstimator(
        ckpt_path=CKPT, prediction_length=21, context_length=30,
        input_size=1, n_layer=8, n_embd_per_head=18, n_head=8,
        time_feat=True, max_context_length=30,
        rope_scaling={"type": "linear", "factor": 2.0},
        num_parallel_samples=5,
    )
    transformation = estimator.create_transformation()
    module = estimator.create_lightning_module()
    predictor = estimator.create_predictor(transformation, module)

    print("\nLoading OHLCV data...")
    frames = load()
    print(f"  Loaded {len(frames)} stock frames")

    existing_preds = {}
    if PRED_FILE.exists():
        try:
            ex = json.loads(PRED_FILE.read_text())
            existing_preds = ex.get("models", {}).get("Lag-Llama", {}).get("predictions", {})
            print(f"  Resuming — already have {len(existing_preds)} predictions")
        except Exception: pass
    preds = dict(existing_preds)
    frames_to_predict = [fr for fr in frames if fr["symbol"].iloc[0] not in existing_preds]
    print(f"  After filter: {len(frames_to_predict)} stocks still need prediction")
    if not frames_to_predict:
        print("\n✓ All stocks already have predictions"); return
    dataset = build_gluonts_dataset(frames_to_predict)
    print(f"  GluonTS dataset: {len(dataset)} entries (filtered)")

    def save_incremental():
        existing = json.loads(PRED_FILE.read_text()) if PRED_FILE.exists() else {"models": {}}
        existing.setdefault("models", {})["Lag-Llama"] = {
            "trained": True, "version": "lag-llama-zero-shot", "metrics": {},
            "predictions": preds, "trained_at": pd.Timestamp.now().isoformat(),
        }
        PRED_FILE.write_text(json.dumps(existing, indent=2,
            default=lambda o: int(o) if isinstance(o, (np.integer,)) else float(o) if isinstance(o, (np.floating,)) else str(o)))

    print(f"\nGenerating predictions (zero-shot)...")
    forecasts = predictor.predict(dataset)
    n_failed = 0
    for i, f in enumerate(forecasts):
        s = f.item_id
        try:
            samples = f.samples.numpy() if hasattr(f.samples, "numpy") else np.array(f.samples)
            fc_vals = samples.mean(axis=0).tolist()
            if not fc_vals or len(fc_vals) < 5:
                n_failed += 1; continue
            df = None
            for fr in frames:
                if fr["symbol"].iloc[0] == s:
                    df = fr; break
            if df is None:
                n_failed += 1; continue
            cp = float(df["close"].iloc[-1])
            r5 = (fc_vals[4] - cp) / cp
            r10 = (fc_vals[9] - cp) / cp
            r21 = (fc_vals[-1] - cp) / cp
            sl = round(float(np.min(df["low"].tail(14).values)), 2)
            avg = (r5 + r10 + r21) / 3
            sig = "BUY" if avg > 0.01 else "SELL" if avg < -0.01 else "HOLD"
            d = "LONG" if sig != "SELL" else "SHORT"
            preds[s] = {
                "currentPrice": round(cp, 2), "entry": round(cp, 2),
                "ret_5d": round(r5, 4), "ret_10d": round(r10, 4), "ret_21d": round(r21, 4),
                "signal": sig, "direction": d, "confidence": min(100, int(abs(avg)*1000)),
                "tp1": round(cp*(1+r5), 2), "tp2": round(cp*(1+r10), 2), "tp3": round(cp*(1+r21), 2),
                "sl": sl, "avgReturn": round(float(avg), 4),
            }
        except Exception as e:
            if i < 5: print(f"    {s}: {e}")
            n_failed += 1; continue
        if (i+1) % 50 == 0:
            print(f"    Processed {i+1}/{len(frames_to_predict)} ({len(preds)} ok)")
            save_incremental()

    save_incremental()
    elapsed = time.time() - t0
    print(f"\n✓ Lag-Llama done in {elapsed:.1f}s — {len(preds)} stocks total, {n_failed} failed this run")

if __name__ == "__main__":
    main()
