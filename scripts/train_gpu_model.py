#!/usr/bin/env python3
"""Latent.pk — Train a single GPU/deep-learning model on 769 PSX stocks.

Usage: python3 scripts/train_gpu_model.py <model_name>

Model names (case-sensitive):
  PatchTST, N-BEATS, TimesNet, Informer   → neuralforecast
  Chronos                                  → transformers + amazon/chronos-t5-tiny
  Lag-Llama, Moirai, Time-LLM             → custom repos (use dedicated scripts)
  LSTM, CNN-LSTM, Transformer-LSTM        → torch
  Prophet                                  → prophet
  GRU                                      → torch

After training, the model's predictions are MERGED into
data/ml_predictions_multi.json (other models are preserved).
"""
import sys, os, json, warnings, time
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error

warnings.filterwarnings("ignore")

OHLCV = Path("data/ohlcv_all")
PRED_FILE = Path("data/ml_predictions_multi.json")
STOCKS = sorted([p.stem for p in OHLCV.glob("*.csv")])
MAX_ROWS_PER_STOCK = 180
SEQ = 30
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
    return df
def add_labels(df):
    df = df.copy()
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
            if len(df) < 50: continue
            if len(df) > MAX_ROWS_PER_STOCK:
                df = df.tail(MAX_ROWS_PER_STOCK).reset_index(drop=True)
            df = add_features(df); df = add_labels(df); df["symbol"] = s
            frames.append(df)
        except Exception: continue
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
def gen_preds(df, predict_fn):
    preds = {}
    for s in STOCKS:
        sdf = df[df["symbol"] == s].sort_values("date").reset_index(drop=True)
        if len(sdf) == 0: continue
        try:
            r5, r10, r21 = predict_fn(sdf)
            cp = float(sdf.iloc[-1]["close"])
            sl = round(float(np.min(sdf["low"].tail(14).values)), 2)
            avg = (r5 + r10 + r21) / 3
            sig = "BUY" if avg > 0.01 else "SELL" if avg < -0.01 else "HOLD"
            d = "LONG" if sig != "SELL" else "SHORT"
            preds[s] = {
                "currentPrice": round(cp, 2), "entry": round(cp, 2),
                f"ret_5d": round(float(r5), 4), f"ret_10d": round(float(r10), 4), f"ret_21d": round(float(r21), 4),
                "signal": sig, "direction": d, "confidence": min(100, int(abs(avg)*1000)),
                "tp1": round(cp*(1+r5), 2), "tp2": round(cp*(1+r10), 2), "tp3": round(cp*(1+r21), 2),
                "sl": sl, "avgReturn": round(float(avg), 4),
            }
        except Exception as e:
            print(f"    {s}: pred failed {e}")
    return preds
def save_model(model_name, model_info):
    existing = json.loads(PRED_FILE.read_text()) if PRED_FILE.exists() else {"models": {}, "backtesting": {}}
    existing.setdefault("models", {})[model_name] = model_info
    PRED_FILE.write_text(json.dumps(existing, indent=2,
        default=lambda o: int(o) if isinstance(o, (np.integer,)) else float(o) if isinstance(o, (np.floating,)) else str(o)))
    print(f"  Saved {model_name} to {PRED_FILE}")

# ─── LSTM (torch) ──────────────────────────────────────────────────────────
def train_lstm(df):
    import torch, torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset
    print("  Training LSTM (PyTorch CPU)...")
    seqs, tars = [], []
    for s in STOCKS:
        sdf = df[df["symbol"] == s].sort_values("date").reset_index(drop=True)
        if len(sdf) < SEQ + 21: continue
        f = sdf[FC].values; sc = StandardScaler(); fs = sc.fit_transform(f)
        for i in range(len(sdf) - SEQ - 21):
            seqs.append(fs[i:i+SEQ])
            tars.append([sdf.iloc[i+SEQ]["target_5d"], sdf.iloc[i+SEQ]["target_10d"], sdf.iloc[i+SEQ]["target_21d"]])
    if len(seqs) < 50: return {"trained": False, "error": "Not enough sequences"}
    X = np.array(seqs, dtype=np.float32); y = np.array(tars, dtype=np.float32)
    sp = int(len(X) * 0.8); Xtr, Xte, ytr, yte = X[:sp], X[sp:], y[:sp], y[sp:]
    dl = DataLoader(TensorDataset(torch.from_numpy(Xtr), torch.from_numpy(ytr)), batch_size=32, shuffle=True)
    class M(nn.Module):
        def __init__(s):
            super().__init__(); s.lstm = nn.LSTM(len(FC), 64, 2, batch_first=True, dropout=0.1); s.fc = nn.Linear(64, 3)
        def forward(s, x):
            o, _ = s.lstm(x); return s.fc(o[:, -1, :])
    model = M(); crit = nn.MSELoss(); opt = torch.optim.Adam(model.parameters(), lr=0.001)
    model.train()
    for ep in range(2):
        for bx, by in dl:
            opt.zero_grad(); loss = crit(model(bx), by); loss.backward(); opt.step()
        if ep % 5 == 0: print(f"    Epoch {ep}: loss={loss.item():.6f}")
    model.eval()
    with torch.no_grad(): ypt = model(torch.from_numpy(Xte)).numpy()
    metrics = {"5d": {"mse": float(mean_squared_error(yte[:, 0], ypt[:, 0]))},
               "10d": {"mse": float(mean_squared_error(yte[:, 1], ypt[:, 1]))},
               "21d": {"mse": float(mean_squared_error(yte[:, 2], ypt[:, 2]))}}
    def predict_fn(sdf):
        f = sdf[FC].values; sc = StandardScaler(); fs = sc.fit_transform(f)
        sq = fs[-SEQ:].reshape(1, SEQ, len(FC))
        with torch.no_grad(): p = model(torch.from_numpy(sq.astype(np.float32)))[0].numpy()
        return float(p[0]), float(p[1]), float(p[2])
    preds = gen_preds(df, predict_fn)
    return {"trained": True, "version": "2.0.0", "metrics": metrics, "predictions": preds}

def train_cnn_lstm(df):
    import torch, torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset
    print("  Training CNN-LSTM (PyTorch CPU)...")
    seqs, tars = [], []
    for s in STOCKS:
        sdf = df[df["symbol"] == s].sort_values("date").reset_index(drop=True)
        if len(sdf) < SEQ + 21: continue
        f = sdf[FC].values; sc = StandardScaler(); fs = sc.fit_transform(f)
        for i in range(len(sdf) - SEQ - 21):
            seqs.append(fs[i:i+SEQ]); tars.append([sdf.iloc[i+SEQ]["target_5d"], sdf.iloc[i+SEQ]["target_10d"], sdf.iloc[i+SEQ]["target_21d"]])
    if len(seqs) < 50: return {"trained": False, "error": "Not enough sequences"}
    X = np.array(seqs, dtype=np.float32); y = np.array(tars, dtype=np.float32)
    sp = int(len(X) * 0.8); Xtr, Xte, ytr, yte = X[:sp], X[sp:], y[:sp], y[sp:]
    dl = DataLoader(TensorDataset(torch.from_numpy(Xtr), torch.from_numpy(ytr)), batch_size=32, shuffle=True)
    class CNNLSTM(nn.Module):
        def __init__(s):
            super().__init__()
            s.cnn = nn.Sequential(nn.Conv1d(len(FC), 32, 3, padding=1), nn.ReLU(), nn.MaxPool1d(2))
            s.lstm = nn.LSTM(32, 64, 2, batch_first=True, dropout=0.1); s.fc = nn.Linear(64, 3)
        def forward(s, x):
            x = x.transpose(1, 2); x = s.cnn(x); x = x.transpose(1, 2)
            o, _ = s.lstm(x); return s.fc(o[:, -1, :])
    model = CNNLSTM(); crit = nn.MSELoss(); opt = torch.optim.Adam(model.parameters(), lr=0.001)
    model.train()
    for ep in range(2):
        for bx, by in dl:
            opt.zero_grad(); loss = crit(model(bx), by); loss.backward(); opt.step()
    model.eval()
    with torch.no_grad(): ypt = model(torch.from_numpy(Xte)).numpy()
    metrics = {"5d": {"mse": float(mean_squared_error(yte[:, 0], ypt[:, 0]))},
               "10d": {"mse": float(mean_squared_error(yte[:, 1], ypt[:, 1]))},
               "21d": {"mse": float(mean_squared_error(yte[:, 2], ypt[:, 2]))}}
    def predict_fn(sdf):
        f = sdf[FC].values; sc = StandardScaler(); fs = sc.fit_transform(f)
        sq = fs[-SEQ:].reshape(1, SEQ, len(FC))
        with torch.no_grad(): p = model(torch.from_numpy(sq.astype(np.float32)))[0].numpy()
        return float(p[0]), float(p[1]), float(p[2])
    preds = gen_preds(df, predict_fn)
    return {"trained": True, "version": "2.0.0", "metrics": metrics, "predictions": preds}

def train_transformer_lstm(df):
    import torch, torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset
    print("  Training Transformer-LSTM (PyTorch CPU)...")
    seqs, tars = [], []
    for s in STOCKS:
        sdf = df[df["symbol"] == s].sort_values("date").reset_index(drop=True)
        if len(sdf) < SEQ + 21: continue
        f = sdf[FC].values; sc = StandardScaler(); fs = sc.fit_transform(f)
        for i in range(len(sdf) - SEQ - 21):
            seqs.append(fs[i:i+SEQ]); tars.append([sdf.iloc[i+SEQ]["target_5d"], sdf.iloc[i+SEQ]["target_10d"], sdf.iloc[i+SEQ]["target_21d"]])
    if len(seqs) < 50: return {"trained": False, "error": "Not enough sequences"}
    X = np.array(seqs, dtype=np.float32); y = np.array(tars, dtype=np.float32)
    sp = int(len(X) * 0.8); Xtr, Xte, ytr, yte = X[:sp], X[sp:], y[:sp], y[sp:]
    dl = DataLoader(TensorDataset(torch.from_numpy(Xtr), torch.from_numpy(ytr)), batch_size=32, shuffle=True)
    class TransLSTM(nn.Module):
        def __init__(s):
            super().__init__()
            s.pos = nn.Parameter(torch.randn(1, SEQ, len(FC)) * 0.02)
            enc_layer = nn.TransformerEncoderLayer(d_model=len(FC), nhead=1, dim_feedforward=64, batch_first=True, dropout=0.1)
            s.encoder = nn.TransformerEncoder(enc_layer, num_layers=1)
            s.lstm = nn.LSTM(len(FC), 64, 2, batch_first=True, dropout=0.1); s.fc = nn.Linear(64, 3)
        def forward(s, x):
            x = x + s.pos; x = s.encoder(x)
            o, _ = s.lstm(x); return s.fc(o[:, -1, :])
    model = TransLSTM(); crit = nn.MSELoss(); opt = torch.optim.Adam(model.parameters(), lr=0.001)
    model.train()
    for ep in range(2):
        for bx, by in dl:
            opt.zero_grad(); loss = crit(model(bx), by); loss.backward(); opt.step()
    model.eval()
    with torch.no_grad(): ypt = model(torch.from_numpy(Xte)).numpy()
    metrics = {"5d": {"mse": float(mean_squared_error(yte[:, 0], ypt[:, 0]))},
               "10d": {"mse": float(mean_squared_error(yte[:, 1], ypt[:, 1]))},
               "21d": {"mse": float(mean_squared_error(yte[:, 2], ypt[:, 2]))}}
    def predict_fn(sdf):
        f = sdf[FC].values; sc = StandardScaler(); fs = sc.fit_transform(f)
        sq = fs[-SEQ:].reshape(1, SEQ, len(FC))
        with torch.no_grad(): p = model(torch.from_numpy(sq.astype(np.float32)))[0].numpy()
        return float(p[0]), float(p[1]), float(p[2])
    preds = gen_preds(df, predict_fn)
    return {"trained": True, "version": "2.0.0", "metrics": metrics, "predictions": preds}

def train_gru(df):
    import torch, torch.nn as nn
    from torch.utils.data import DataLoader, TensorDataset
    print("  Training GRU (PyTorch CPU)...")
    seqs, tars = [], []
    for s in STOCKS:
        sdf = df[df["symbol"] == s].sort_values("date").reset_index(drop=True)
        if len(sdf) < SEQ + 21: continue
        f = sdf[FC].values; sc = StandardScaler(); fs = sc.fit_transform(f)
        for i in range(len(sdf) - SEQ - 21):
            seqs.append(fs[i:i+SEQ]); tars.append([sdf.iloc[i+SEQ]["target_5d"], sdf.iloc[i+SEQ]["target_10d"], sdf.iloc[i+SEQ]["target_21d"]])
    if len(seqs) < 50: return {"trained": False, "error": "Not enough sequences"}
    X = np.array(seqs, dtype=np.float32); y = np.array(tars, dtype=np.float32)
    sp = int(len(X) * 0.8); Xtr, Xte, ytr, yte = X[:sp], X[sp:], y[:sp], y[sp:]
    dl = DataLoader(TensorDataset(torch.from_numpy(Xtr), torch.from_numpy(ytr)), batch_size=32, shuffle=True)
    class GRUM(nn.Module):
        def __init__(s):
            super().__init__(); s.gru = nn.GRU(len(FC), 64, 2, batch_first=True, dropout=0.1); s.fc = nn.Linear(64, 3)
        def forward(s, x):
            o, _ = s.gru(x); return s.fc(o[:, -1, :])
    model = GRUM(); crit = nn.MSELoss(); opt = torch.optim.Adam(model.parameters(), lr=0.001)
    model.train()
    for ep in range(2):
        for bx, by in dl:
            opt.zero_grad(); loss = crit(model(bx), by); loss.backward(); opt.step()
    model.eval()
    with torch.no_grad(): ypt = model(torch.from_numpy(Xte)).numpy()
    metrics = {"5d": {"mse": float(mean_squared_error(yte[:, 0], ypt[:, 0]))},
               "10d": {"mse": float(mean_squared_error(yte[:, 1], ypt[:, 1]))},
               "21d": {"mse": float(mean_squared_error(yte[:, 2], ypt[:, 2]))}}
    def predict_fn(sdf):
        f = sdf[FC].values; sc = StandardScaler(); fs = sc.fit_transform(f)
        sq = fs[-SEQ:].reshape(1, SEQ, len(FC))
        with torch.no_grad(): p = model(torch.from_numpy(sq.astype(np.float32)))[0].numpy()
        return float(p[0]), float(p[1]), float(p[2])
    preds = gen_preds(df, predict_fn)
    return {"trained": True, "version": "2.0.0", "metrics": metrics, "predictions": preds}

def train_prophet(df):
    from prophet import Prophet
    print("  Training Prophet (per-stock time-series)...")
    preds = {}
    metrics = {"5d": {"mse": 0.0}, "10d": {"mse": 0.0}, "21d": {"mse": 0.0}}
    n_trained = 0
    for i, s in enumerate(STOCKS):
        sdf = df[df["symbol"] == s].sort_values("date").reset_index(drop=True)
        if len(sdf) < 50: continue
        try:
            pdf = pd.DataFrame({
                "ds": pd.to_datetime(sdf["date"], unit="ms"),
                "y": sdf["close"].values,
            })
            m = Prophet(daily_seasonality=False, weekly_seasonality=True, yearly_seasonality=True, n_changepoints=5)
            m.fit(pdf)
            future = m.make_future_dataframe(periods=21, freq="D")
            forecast = m.predict(future)
            r5 = float(forecast.iloc[-21]["yhat"] - sdf.iloc[-1]["close"]) / sdf.iloc[-1]["close"]
            r10 = float(forecast.iloc[-16]["yhat"] - sdf.iloc[-1]["close"]) / sdf.iloc[-1]["close"]
            r21 = float(forecast.iloc[-1]["yhat"] - sdf.iloc[-1]["close"]) / sdf.iloc[-1]["close"]
            cp = float(sdf.iloc[-1]["close"])
            sl = round(float(np.min(sdf["low"].tail(14).values)), 2)
            avg = (r5 + r10 + r21) / 3
            sig = "BUY" if avg > 0.01 else "SELL" if avg < -0.01 else "HOLD"
            d = "LONG" if sig != "SELL" else "SHORT"
            preds[s] = {"currentPrice": round(cp, 2), "entry": round(cp, 2),
                        f"ret_5d": round(r5, 4), f"ret_10d": round(r10, 4), f"ret_21d": round(r21, 4),
                        "signal": sig, "direction": d, "confidence": min(100, int(abs(avg)*1000)),
                        "tp1": round(cp*(1+r5), 2), "tp2": round(cp*(1+r10), 2), "tp3": round(cp*(1+r21), 2),
                        "sl": sl, "avgReturn": round(float(avg), 4)}
            n_trained += 1
        except Exception: continue
        if (i+1) % 100 == 0: print(f"    Processed {i+1}/{len(STOCKS)}, {n_trained} trained")
    print(f"    Done — {n_trained} stocks")
    return {"trained": True, "version": "1.5.0", "metrics": metrics, "predictions": preds}

def train_neuralforecast_model(df, model_name):
    from neuralforecast import NeuralForecast
    print(f"  Training {model_name} via neuralforecast...")
    all_series = []
    for s in STOCKS:
        sdf = df[df["symbol"] == s].sort_values("date").reset_index(drop=True)
        if len(sdf) < 90: continue
        pdf = pd.DataFrame({
            "unique_id": s, "ds": pd.to_datetime(sdf["date"], unit="ms"),
            "y": sdf["close"].values,
        })
        all_series.append(pdf)
    if not all_series: return {"trained": False, "error": "No valid series"}
    nf_df = pd.concat(all_series, ignore_index=True)
    print(f"    Loaded {len(all_series)} series, {len(nf_df)} total rows")
    if model_name == "PatchTST":
        from neuralforecast.models import PatchTST as M
        m = M(h=21, input_size=60, patch_len=8, stride=8, max_steps=20, n_heads=2, encoder_layers=1, learning_rate=0.001, batch_size=32)
    elif model_name == "NBEATS":
        from neuralforecast.models import NBEATS as M
        m = M(h=21, input_size=60, max_steps=20, learning_rate=0.001, batch_size=32, mlp_units=[[64, 64], [64, 64]])
    elif model_name == "TimesNet":
        from neuralforecast.models import TimesNet as M
        m = M(h=21, input_size=60, max_steps=20, learning_rate=0.001, batch_size=32, hidden_size=64)
    elif model_name == "Informer":
        from neuralforecast.models import Informer as M
        m = M(h=21, input_size=60, max_steps=20, learning_rate=0.001, batch_size=32, hidden_size=64, conv_hidden_size=32, n_head=2)
    else: return {"trained": False, "error": f"Unknown neuralforecast model: {model_name}"}
    nf = NeuralForecast(models=[m], freq="D")
    try: nf.fit(df=nf_df)
    except Exception as e: return {"trained": False, "error": f"fit failed: {e}"}
    preds = {}
    for s in STOCKS:
        sdf = df[df["symbol"] == s].sort_values("date").reset_index(drop=True)
        if len(sdf) < 90: continue
        try:
            pdf = pd.DataFrame({
                "unique_id": s, "ds": pd.to_datetime(sdf["date"], unit="ms"),
                "y": sdf["close"].values,
            }).tail(60)
            fc = nf.predict(df=pdf)
            arr = fc[model_name].values if model_name in fc.columns else fc.iloc[:, -1].values
            cp = float(sdf.iloc[-1]["close"])
            r5 = float(arr[4] - cp) / cp if len(arr) > 4 else 0
            r10 = float(arr[9] - cp) / cp if len(arr) > 9 else 0
            r21 = float(arr[-1] - cp) / cp if len(arr) > 0 else 0
            sl = round(float(np.min(sdf["low"].tail(14).values)), 2)
            avg = (r5 + r10 + r21) / 3
            sig = "BUY" if avg > 0.01 else "SELL" if avg < -0.01 else "HOLD"
            d = "LONG" if sig != "SELL" else "SHORT"
            preds[s] = {"currentPrice": round(cp, 2), "entry": round(cp, 2),
                        f"ret_5d": round(r5, 4), f"ret_10d": round(r10, 4), f"ret_21d": round(r21, 4),
                        "signal": sig, "direction": d, "confidence": min(100, int(abs(avg)*1000)),
                        "tp1": round(cp*(1+r5), 2), "tp2": round(cp*(1+r10), 2), "tp3": round(cp*(1+r21), 2),
                        "sl": sl, "avgReturn": round(float(avg), 4)}
        except Exception: continue
    print(f"    Done — {len(preds)} stocks")
    return {"trained": True, "version": "3.3.0", "metrics": {}, "predictions": preds}

def train_chronos(df):
    import torch
    from chronos import ChronosPipeline
    print("  Training Chronos (zero-shot, amazon/chronos-t5-tiny)...")
    try:
        pipeline = ChronosPipeline.from_pretrained("amazon/chronos-t5-tiny", device_map="cpu")
    except Exception as e:
        return {"trained": False, "error": f"Model load failed: {e}"}
    preds = {}
    for i, s in enumerate(STOCKS):
        sdf = df[df["symbol"] == s].sort_values("date").reset_index(drop=True)
        if len(sdf) < 60: continue
        try:
            ctx = torch.tensor(sdf["close"].tail(60).values, dtype=torch.float32)
            forecast = pipeline.predict(ctx, prediction_length=21)
            if forecast.dim() == 3: fc_vals = forecast[0].mean(dim=0).tolist()
            elif forecast.dim() == 2: fc_vals = forecast.mean(dim=0).tolist()
            else: fc_vals = forecast.tolist()
            if isinstance(fc_vals[0], list): fc_vals = fc_vals[0]
            if not fc_vals or len(fc_vals) < 5: continue
            cp = float(sdf.iloc[-1]["close"])
            r5 = (fc_vals[4] - cp) / cp
            r10 = (fc_vals[9] - cp) / cp
            r21 = (fc_vals[-1] - cp) / cp
            sl = round(float(np.min(sdf["low"].tail(14).values)), 2)
            avg = (r5 + r10 + r21) / 3
            sig = "BUY" if avg > 0.01 else "SELL" if avg < -0.01 else "HOLD"
            d = "LONG" if sig != "SELL" else "SHORT"
            preds[s] = {"currentPrice": round(cp, 2), "entry": round(cp, 2),
                        f"ret_5d": round(r5, 4), f"ret_10d": round(r10, 4), f"ret_21d": round(r21, 4),
                        "signal": sig, "direction": d, "confidence": min(100, int(abs(avg)*1000)),
                        "tp1": round(cp*(1+r5), 2), "tp2": round(cp*(1+r10), 2), "tp3": round(cp*(1+r21), 2),
                        "sl": sl, "avgReturn": round(float(avg), 4)}
        except Exception as e:
            if i < 5: print(f"    {s}: {e}")
            continue
        if (i+1) % 100 == 0: print(f"    Processed {i+1}/{len(STOCKS)}, {len(preds)} with predictions")
    print(f"    Done — {len(preds)} stocks")
    return {"trained": True, "version": "chronos-t5-tiny-zero-shot", "metrics": {}, "predictions": preds}

def train_lag_llama(df):
    return {"trained": False, "error": "Use scripts/train_lag_llama.py (dedicated script with resume mode)"}
def train_moirai(df):
    return {"trained": False, "error": "Use scripts/train_moirai.py (dedicated script)"}
def train_time_llm(df):
    return {"trained": False, "error": "Use scripts/train_time_llm.py (dedicated script)"}

TRAINERS = {
    "PatchTST": lambda df: train_neuralforecast_model(df, "PatchTST"),
    "N-BEATS": lambda df: train_neuralforecast_model(df, "NBEATS"),
    "TimesNet": lambda df: train_neuralforecast_model(df, "TimesNet"),
    "Informer": lambda df: train_neuralforecast_model(df, "Informer"),
    "Chronos": lambda df: train_chronos(df),
    "Lag-Llama": lambda df: train_lag_llama(df),
    "Moirai": lambda df: train_moirai(df),
    "Time-LLM": lambda df: train_time_llm(df),
    "LSTM": lambda df: train_lstm(df),
    "CNN-LSTM": lambda df: train_cnn_lstm(df),
    "Transformer-LSTM": lambda df: train_transformer_lstm(df),
    "Prophet": lambda df: train_prophet(df),
    "GRU": lambda df: train_gru(df),
}
CANONICAL = {
    "PatchTST": "PatchTST", "N-BEATS": "N-BEATS", "TimesNet": "TimesNet", "Informer": "Informer",
    "Chronos": "Chronos (Amazon)", "Lag-Llama": "Lag-Llama", "Moirai": "Moirai (Salesforce)",
    "Time-LLM": "Time-LLM", "LSTM": "LSTM", "CNN-LSTM": "CNN-LSTM",
    "Transformer-LSTM": "Transformer-LSTM", "Prophet": "Prophet", "GRU": "GRU",
}
def main():
    if len(sys.argv) < 2:
        print("Usage: python3 train_gpu_model.py <model_name>")
        print("Available:", list(TRAINERS.keys()))
        sys.exit(1)
    MODEL = sys.argv[1]
    if MODEL not in TRAINERS:
        print(f"Unknown model: {MODEL}"); print("Available:", list(TRAINERS.keys())); sys.exit(1)
    print(f"\n{'='*60}\nTraining model: {MODEL}\nStocks: {len(STOCKS)}\n{'='*60}\n")
    t0 = time.time()
    df = load()
    print(f"Loaded: {len(df)} rows from {df['symbol'].nunique() if 'symbol' in df else 0} stocks")
    try:
        info = TRAINERS[MODEL](df)
        info["elapsed_seconds"] = time.time() - t0
        info["trained_at"] = pd.Timestamp.now().isoformat()
        save_model(CANONICAL[MODEL], info)
        if info.get("trained"):
            n_preds = len(info.get("predictions", {}))
            print(f"\n✓ {MODEL} trained in {info['elapsed_seconds']:.1f}s — {n_preds} stocks have predictions")
        else:
            print(f"\n✗ {MODEL} failed: {info.get('error', 'unknown')}")
    except Exception as e:
        print(f"\n✗ {MODEL} crashed: {e}")
        import traceback; traceback.print_exc()
        save_model(CANONICAL[MODEL], {"trained": False, "error": str(e)})
if __name__ == "__main__":
    main()
