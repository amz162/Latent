#!/usr/bin/env python3
"""Latent.pk — Train Moirai (Salesforce) zero-shot on 769 PSX stocks.

Uses pre-trained Salesforce/moirai-1.1-R-small weights from HuggingFace.
"""
import sys, os, json, warnings, time
import numpy as np
import pandas as pd
import torch
from pathlib import Path
from einops import rearrange

warnings.filterwarnings("ignore")

OHLCV = Path("/home/z/my-project/data/ohlcv_all")
PRED_FILE = Path("/home/z/my-project/data/ml_predictions_multi.json")
STOCKS = sorted([p.stem for p in OHLCV.glob("*.csv")])
MAX_ROWS_PER_STOCK = 180
CONTEXT_LENGTH = 64
PREDICTION_LENGTH = 21

def load():
    frames = []
    for s in STOCKS:
        p = OHLCV / f"{s}.csv"
        if not p.exists(): continue
        try:
            df = pd.read_csv(p, usecols=range(6))
            df = df[df["volume"] > 0].reset_index(drop=True)
            if len(df) < CONTEXT_LENGTH + 5: continue
            if len(df) > MAX_ROWS_PER_STOCK:
                df = df.tail(MAX_ROWS_PER_STOCK).reset_index(drop=True)
            df["symbol"] = s
            frames.append(df)
        except Exception: continue
    return frames

def main():
    print(f"\n{'='*60}\nMoirai (Salesforce) zero-shot prediction\nStocks: {len(STOCKS)}\n{'='*60}\n")
    t0 = time.time()
    from uni2ts.model.moirai import MoiraiForecast, MoiraiModule

    print("Loading Salesforce/moirai-1.1-R-small weights...")
    try:
        module = MoiraiModule.from_pretrained("Salesforce/moirai-1.1-R-small")
        print("  Weights loaded")
    except Exception as e:
        print(f"  FAILED to load weights: {e}"); return

    model = MoiraiForecast(
        module=module, prediction_length=PREDICTION_LENGTH, context_length=CONTEXT_LENGTH,
        patch_size=16, num_samples=20, target_dim=1,
        feat_dynamic_real_dim=0, past_feat_dynamic_real_dim=0,
    )
    model.eval()

    print("\nLoading OHLCV data...")
    frames = load()
    print(f"  Loaded {len(frames)} stock frames")

    existing_preds = {}
    if PRED_FILE.exists():
        try:
            ex = json.loads(PRED_FILE.read_text())
            existing_preds = ex.get("models", {}).get("Moirai (Salesforce)", {}).get("predictions", {})
            print(f"  Resuming — already have {len(existing_preds)} predictions")
        except Exception: pass
    preds = dict(existing_preds)
    frames_to_predict = [fr for fr in frames if fr["symbol"].iloc[0] not in existing_preds]
    print(f"  After filter: {len(frames_to_predict)} stocks still need prediction")
    if not frames_to_predict:
        print("\n✓ All stocks already have predictions"); return

    def save_incremental():
        existing = json.loads(PRED_FILE.read_text()) if PRED_FILE.exists() else {"models": {}}
        existing.setdefault("models", {})["Moirai (Salesforce)"] = {
            "trained": True, "version": "moirai-1.1-R-small-zero-shot", "metrics": {},
            "predictions": preds, "trained_at": pd.Timestamp.now().isoformat(),
        }
        PRED_FILE.write_text(json.dumps(existing, indent=2,
            default=lambda o: int(o) if isinstance(o, (np.integer,)) else float(o) if isinstance(o, (np.floating,)) else str(o)))

    print(f"\nGenerating predictions (zero-shot)...")
    n_failed = 0
    with torch.no_grad():
        for i, fr in enumerate(frames_to_predict):
            s = fr["symbol"].iloc[0]
            try:
                ctx_data = fr["close"].tail(CONTEXT_LENGTH).values.astype(np.float32)
                if len(ctx_data) < CONTEXT_LENGTH:
                    n_failed += 1; continue
                past_target = rearrange(torch.as_tensor(ctx_data), "t -> 1 t 1")
                past_observed_target = torch.ones_like(past_target, dtype=torch.bool)
                past_is_pad = torch.zeros(past_target.shape[:2], dtype=torch.bool)
                forecast = model(past_target=past_target, past_observed_target=past_observed_target, past_is_pad=past_is_pad)
                fc = forecast.detach().cpu().numpy()
                if fc.ndim == 4: fc = fc[0, :, :, 0]
                elif fc.ndim == 3: fc = fc[0]
                fc_vals = fc.mean(axis=0).tolist() if fc.ndim == 2 else fc.tolist()
                if not fc_vals or len(fc_vals) < 5:
                    n_failed += 1; continue
                cp = float(fr["close"].iloc[-1])
                r5 = (fc_vals[4] - cp) / cp
                r10 = (fc_vals[9] - cp) / cp
                r21 = (fc_vals[-1] - cp) / cp
                sl = round(float(np.min(fr["low"].tail(14).values)), 2)
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
    print(f"\n✓ Moirai done in {elapsed:.1f}s — {len(preds)} stocks total, {n_failed} failed this run")

if __name__ == "__main__":
    main()
