#!/usr/bin/env python3
"""Latent.pk — Train Time-LLM (simplified, GPT-2 backbone) on 769 PSX stocks.

Simplified reimplementation of Time-LLM (KimMeen/Time-LLM):
1. Loads GPT-2 (124M, frozen)
2. Patch-embeds the time series into LLM's hidden dimension
3. Cross-attends time series patches to LLM's token representations
4. Trains a small adapter head for 5 epochs on a 50-stock subset
5. Generates 21-day predictions for all stocks
"""
import sys, os, json, warnings, time, gc
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
from pathlib import Path

warnings.filterwarnings("ignore")

OHLCV = Path("/home/z/my-project/data/ohlcv_all")
PRED_FILE = Path("/home/z/my-project/data/ml_predictions_multi.json")
STOCKS = sorted([p.stem for p in OHLCV.glob("*.csv")])
MAX_ROWS_PER_STOCK = 180
CONTEXT_LENGTH = 60
PREDICTION_LENGTH = 21
FC = ["rsi_14","macd","macd_signal","macd_hist","bb_width","bb_pct_b","atr_14","obv_change_pct",
      "price_sma_20_ratio","price_sma_50_ratio","price_sma_200_ratio","volume_sma_20_ratio",
      "return_1d","return_7d","return_14d","return_30d","hl_range_pct","body_size_pct","volatility_14d"]

def compute_rsi(p, n=14):
    d = p.diff(); g = d.where(d > 0, 0); l = -d.where(d < 0, 0)
    ag = g.ewm(alpha=1/n, min_periods=n).mean(); al = l.ewm(alpha=1/n, min_periods=n).mean()
    return (100 - 100/(1+ag/al.replace(0, np.nan))).fillna(50)
def compute_macd(p):
    e12 = p.ewm(span=12, adjust=False).mean(); e26 = p.ewm(span=26, adjust=False).mean()
    m = e12 - e26; s = m.ewm(span=9, adjust=False).mean()
    return m, s, m - s
def compute_bb(p, w=20):
    sma = p.rolling(w).mean(); sd = p.rolling(w).std()
    return ((sma+2*sd-(sma-2*sd))/sma).fillna(0), ((p-(sma-2*sd))/(4*sd).replace(0, np.nan)).fillna(0.5)
def compute_atr(h, l, c, n=14):
    tr = pd.concat([(h-l), (h-c.shift()).abs(), (l-c.shift()).abs()], axis=1).max(axis=1)
    return tr.rolling(n).mean().fillna(0)
def compute_obv(c, v):
    s = c.diff().apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))
    return (s * v).cumsum()
def add_features(df):
    df = df.copy().sort_values("date").reset_index(drop=True)
    c = df["close"]; h = df["high"]; l = df["low"]; v = df["volume"]
    df["rsi_14"] = compute_rsi(c); m, s, hh = compute_macd(c)
    df["macd"] = m; df["macd_signal"] = s; df["macd_hist"] = hh
    bw, pb = compute_bb(c); df["bb_width"] = bw; df["bb_pct_b"] = pb
    df["atr_14"] = compute_atr(h, l, c)
    obv = compute_obv(c, v); df["obv_change_pct"] = obv.pct_change(periods=14).replace([np.inf, -np.inf], 0).fillna(0)
    for w in [20, 50, 200]:
        df[f"price_sma_{w}_ratio"] = c / c.rolling(w, min_periods=1).mean()
    df["volume_sma_20_ratio"] = v / v.rolling(20, min_periods=1).mean().replace(0, 1)
    for p in [1, 7, 14, 30]:
        df[f"return_{p}d"] = c.pct_change(periods=p).replace([np.inf, -np.inf], 0).fillna(0)
    df["hl_range_pct"] = ((h-l) / c.replace(0, np.nan)).fillna(0)
    df["body_size_pct"] = ((df["close"]-df["open"]).abs() / c.replace(0, np.nan)).fillna(0)
    df["volatility_14d"] = c.pct_change().rolling(14).std().fillna(0)
    for hz in [5, 10, 21]:
        df[f"target_{hz}d"] = ((df["close"].shift(-hz) - df["close"]) / df["close"]).fillna(0)
    return df

def load():
    frames = []
    for s in STOCKS:
        p = OHLCV / f"{s}.csv"
        if not p.exists(): continue
        try:
            df = pd.read_csv(p, usecols=range(6))
            df = df[df["volume"] > 0].reset_index(drop=True)
            if len(df) < 90: continue
            if len(df) > MAX_ROWS_PER_STOCK:
                df = df.tail(MAX_ROWS_PER_STOCK).reset_index(drop=True)
            df = add_features(df); df["symbol"] = s
            frames.append(df)
        except Exception: continue
    return frames

class TimeLLMLite(nn.Module):
    def __init__(self, gpt2, patch_len=10, stride=5, n_features=19, d_llm=768, n_targets=3):
        super().__init__()
        self.gpt2 = gpt2
        self.patch_len = patch_len; self.stride = stride
        self.n_features = n_features; self.d_llm = d_llm; self.n_targets = n_targets
        self.patch_proj = nn.Linear(patch_len * n_features, d_llm)
        self.cross_attn = nn.MultiheadAttention(d_llm, num_heads=4, batch_first=True)
        self.norm = nn.LayerNorm(d_llm)
        self.head = nn.Linear(d_llm, n_targets)
        self.dropout = nn.Dropout(0.1)

    def forward(self, x_features):
        B, T, F = x_features.shape
        patches = []
        for i in range(0, T - self.patch_len + 1, self.stride):
            patches.append(x_features[:, i:i+self.patch_len, :].reshape(B, -1))
        if not patches:
            patches.append(x_features[:, -self.patch_len:, :].reshape(B, -1))
        patches = torch.stack(patches, dim=1)
        patch_emb = self.patch_proj(patches)
        with torch.no_grad():
            outputs = self.gpt2(input_embeds=patch_emb)
            llm_out = outputs.last_hidden_state
        attn_out, _ = self.cross_attn(patch_emb, llm_out, llm_out)
        x = self.norm(patch_emb + attn_out)
        x = self.dropout(x)
        x = x.mean(dim=1)
        return self.head(x)

def main():
    print(f"\n{'='*60}\nTime-LLM (simplified, GPT-2 backbone)\nStocks: {len(STOCKS)}\n{'='*60}\n")
    t0 = time.time()
    from transformers import GPT2Model, GPT2Config

    print("Loading GPT-2 (124M, frozen)...")
    try:
        gpt2_config = GPT2Config(n_embd=768, n_layer=6, n_head=6, vocab_size=50257, n_positions=1024)
        gpt2 = GPT2Model.from_pretrained("gpt2", config=gpt2_config)
        for p in gpt2.parameters(): p.requires_grad = False
        print("  GPT-2 loaded (frozen)")
    except Exception as e:
        print(f"  FAILED to load GPT-2: {e}"); return

    model = TimeLLMLite(gpt2, patch_len=10, stride=5, n_features=19, d_llm=768)
    total_params = sum(p.numel() for p in model.parameters())
    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"  Model: {total_params:,} total params, {trainable_params:,} trainable")

    print("\nLoading OHLCV data...")
    frames = load()
    print(f"  Loaded {len(frames)} stock frames")

    n_train = min(50, len(frames))
    print(f"\nBuilding training set ({n_train} stocks)...")
    X_train, y_train = [], []
    for fr in frames[:n_train]:
        f = fr[FC].values
        for i in range(0, max(1, len(f) - CONTEXT_LENGTH - 21), 30):
            window = f[i:i+CONTEXT_LENGTH]
            if len(window) < CONTEXT_LENGTH: continue
            tgt = [fr.iloc[i+CONTEXT_LENGTH-1]["target_5d"],
                   fr.iloc[i+CONTEXT_LENGTH-1]["target_10d"],
                   fr.iloc[i+CONTEXT_LENGTH-1]["target_21d"]]
            X_train.append(window); y_train.append(tgt)
    X_train = np.array(X_train, dtype=np.float32)
    y_train = np.array(y_train, dtype=np.float32)
    X_train = np.clip(X_train, -10, 10)
    y_train = np.clip(y_train, -0.5, 0.5)
    print(f"  Training: {X_train.shape} → targets {y_train.shape}")

    print("\nTraining (5 epochs, frozen GPT-2 + adapter)...")
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=1e-3)
    crit = nn.MSELoss()
    BATCH_SIZE = 16
    model.train()
    for ep in range(5):
        perm = np.random.permutation(len(X_train))
        total_loss = 0
        for i in range(0, len(X_train), BATCH_SIZE):
            batch_idx = perm[i:i+BATCH_SIZE]
            bx = torch.from_numpy(X_train[batch_idx])
            by = torch.from_numpy(y_train[batch_idx])
            pred = model(bx)
            loss = crit(pred, by)
            opt.zero_grad(); loss.backward(); opt.step()
            total_loss += loss.item()
        print(f"  Epoch {ep+1}/5: loss={total_loss/max(1,len(X_train)/BATCH_SIZE):.6f}")

    existing_preds = {}
    if PRED_FILE.exists():
        try:
            ex = json.loads(PRED_FILE.read_text())
            existing_preds = ex.get("models", {}).get("Time-LLM", {}).get("predictions", {})
            print(f"\n  Resuming — already have {len(existing_preds)} predictions")
        except Exception: pass
    preds = dict(existing_preds)
    frames_to_predict = [fr for fr in frames if fr["symbol"].iloc[0] not in existing_preds]
    print(f"  After filter: {len(frames_to_predict)} stocks still need prediction")

    def save_incremental():
        existing = json.loads(PRED_FILE.read_text()) if PRED_FILE.exists() else {"models": {}}
        existing.setdefault("models", {})["Time-LLM"] = {
            "trained": True, "version": "time-llm-lite-gpt2-frozen", "metrics": {},
            "predictions": preds, "trained_at": pd.Timestamp.now().isoformat(),
        }
        PRED_FILE.write_text(json.dumps(existing, indent=2,
            default=lambda o: int(o) if isinstance(o, (np.integer,)) else float(o) if isinstance(o, (np.floating,)) else str(o)))

    print(f"\nGenerating predictions for {len(frames_to_predict)} stocks...")
    n_failed = 0
    model.eval()
    with torch.no_grad():
        for i, fr in enumerate(frames_to_predict):
            s = fr["symbol"].iloc[0]
            try:
                f = fr[FC].values.astype(np.float32)
                f = np.clip(f, -10, 10)
                if len(f) < CONTEXT_LENGTH:
                    n_failed += 1; continue
                window = f[-CONTEXT_LENGTH:].reshape(1, CONTEXT_LENGTH, len(FC))
                x = torch.from_numpy(window)
                pred = model(x).squeeze(0).numpy()
                r5, r10, r21 = float(pred[0]), float(pred[1]), float(pred[2])
                cp = float(fr["close"].iloc[-1])
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
            if (i+1) % 100 == 0:
                print(f"    Processed {i+1}/{len(frames_to_predict)} ({len(preds)} ok)")
                save_incremental()

    save_incremental()
    elapsed = time.time() - t0
    print(f"\n✓ Time-LLM done in {elapsed:.1f}s — {len(preds)} stocks total, {n_failed} failed this run")

if __name__ == "__main__":
    main()
