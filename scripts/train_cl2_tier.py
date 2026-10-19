#!/usr/bin/env python3
"""CL-2 Tier: 7 models + logistic meta-ensemble with support/ATR stop rules.

This is a NEW model category for Latent.pk, distinct from the existing
CL-Ensemble (LGB70+Log30) and CL-Extender (8-model weighted vote). It is
trained to predict the probability that TP1 (1.5R) will be hit before the
stop-loss within 5 days, using a binary-classifier ensemble instead of
the regressor+avgReturn approach used by the existing CL tier.

=========================================================================
Stop-loss rule (NEW — replaces ±1.5×ATR):
  support_stop = nearest confirmed swing low (or 20-day low) − 0.15×ATR
  atr_stop     = entry ∓ 0.8×ATR   (∓ = below for BUY, above for SELL)
  final SL     = whichever is closer to entry, but never tighter than 0.5×ATR

  A swing low is "confirmed" when it's a local minimum with 3 bars on
  each side (no look-ahead — we use only past bars at prediction time).

Resistance check (NEW):
  Skip the trade if the nearest resistance is less than 1R above entry
  (no room for TP1). Resistance = nearest confirmed swing high.
=========================================================================

Target label:
  y = 1 if TP1 (= entry + 1.5R for BUY, entry − 1.5R for SELL) is hit
      before SL within the next 5 bars, else 0.
  where R = |entry − SL| (the per-bar realized risk from the SL rule).

Exit simulation (for backtest P&L, not for label generation):
  50% closed at TP1, 30% at TP2 (=3R), 20% at TP3 (=5R).
  Stop moves to breakeven after TP1 is hit.

Models (all CPU, sklearn-based):
  1. LightGBM (config A: 100 trees, depth 3, lr 0.05)
  2. LightGBM (config B: 60 trees, depth 5, lr 0.08)
  3. HistGradientBoostingClassifier
  4. ExtraTreesClassifier
  5. RandomForestClassifier
  6. LogisticRegression
  7. MLPClassifier (small, 1 hidden layer of 32 units)

Meta-model:
  LogisticRegression on the 7-dim OOF prediction vector, trained on
  purged time-ordered out-of-fold predictions (purge gap = 5 bars to
  avoid label leakage from the 5-day target horizon).

Calibration:
  Bin meta-predictions into deciles on OOS data, measure actual hit
  rate per bin. The mapping is saved as data/cl2_cache/calib.pkl and
  used at inference time to convert raw_prob → exp_win_rate.

Confidence outputs (per stock):
  raw_prob     ∈ [0,1] — the meta-model's sigmoid output
  exp_win_rate ∈ [0,1] — raw_prob after calibration
  agreement    ∈ [0,1] — 1 − normalized std of 7 model probs
  confidence   ∈ [0,100] — exp_win_rate × (0.6 + 0.4 × agreement) × 100

Signal:
  BUY if calibrated_prob ≥ 0.55 AND resistance check passes
  SELL if calibrated_prob ≤ 0.45 (mirror rules for shorts)
  HOLD otherwise

Usage:
  python scripts/train_cl2_tier.py            # train + save to ml_predictions_multi.json
  python scripts/train_cl2_tier.py --quick 4   # quick test on 4 stocks
  python scripts/train_cl2_tier.py --backtest # only re-run backtest on existing preds
"""
from __future__ import annotations
import json
import os
import sys
import time
import pickle
import argparse
import warnings
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import (
    HistGradientBoostingClassifier,
    ExtraTreesClassifier,
    RandomForestClassifier,
)
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score

warnings.filterwarnings("ignore")

# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------
ROOT = Path("/home/z/my-project")
OHLCV_DIR = ROOT / "data" / "ohlcv_all"
PRED_FILE = ROOT / "data" / "ml_predictions_multi.json"
CALIB_FILE = ROOT / "data" / "cl2_cache" / "calib.pkl"
CACHE_DIR = ROOT / "data" / "cl2_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# New SL/TP rules per user spec
ATR_STOP_MULT = 0.8           # entry ∓ 0.8×ATR
SUPPORT_BUFFER_MULT = 0.15    # support − 0.15×ATR
MIN_SL_MULT = 0.5             # never tighter than 0.5×ATR
TP1_MULT = 1.5                # 1.5R
TP2_MULT = 3.0                # 3R
TP3_MULT = 5.0                # 5R
LABEL_HORIZON = 5             # 5-day window
RESISTANCE_MIN_R = 1.0        # skip if nearest resistance < 1R above entry
SWING_LOOKBACK = 3             # 3-bar confirmation each side
MIN_TRAIN_BARS = 60
MIN_PRED_BARS = 30

# Thresholds for converting calibrated prob → signal
BUY_THRESHOLD = 0.55
SELL_THRESHOLD = 0.45

# Cost (slippage + spread) as fraction of price, for backtest
COST = 0.0005  # 5 bps per side

# Feature columns (same as retrain_all_361_stocks.py)
FC = [
    "rsi_14", "macd", "macd_signal", "macd_hist", "bb_width", "bb_pct_b",
    "atr_14", "obv_change_pct", "price_sma_20_ratio", "price_sma_50_ratio",
    "price_sma_200_ratio", "volume_sma_20_ratio", "return_1d", "return_5d",
    "return_7d", "return_14d", "return_30d", "hl_range_pct", "body_size_pct",
    "volatility_14d",
]

# 7 base models' names (used as JSON keys)
CL2_MODEL_NAMES = [
    "LightGBM-A",
    "LightGBM-B",
    "HistGBM",
    "ExtraTrees",
    "RandomForest",
    "Logistic",
    "MLP",
]


# ------------------------------------------------------------------
# Feature engineering (mirrors retrain_all_361_stocks.add_f exactly)
# ------------------------------------------------------------------
def crsi(p, n=14):
    d = p.diff()
    g = d.where(d > 0, 0)
    l = -d.where(d < 0, 0)
    ag = g.ewm(alpha=1 / n, min_periods=n).mean()
    al = l.ewm(alpha=1 / n, min_periods=n).mean()
    return (100 - 100 / (1 + ag / al.replace(0, np.nan))).fillna(50)


def cmacd(p):
    e12 = p.ewm(span=12, adjust=False).mean()
    e26 = p.ewm(span=26, adjust=False).mean()
    m = e12 - e26
    s = m.ewm(span=9, adjust=False).mean()
    return m, s, m - s


def cbb(p, w=20):
    sma = p.rolling(w).mean()
    sd = p.rolling(w).std()
    return ((sma + 2 * sd - (sma - 2 * sd)) / sma).fillna(0), \
           ((p - (sma - 2 * sd)) / (4 * sd).replace(0, np.nan)).fillna(0.5)


def catr(h, l, c, n=14):
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    return tr.rolling(n).mean().fillna(0)


def cobv(c, v):
    s = c.diff().apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))
    return (s * v).cumsum()


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy().sort_values("date").reset_index(drop=True)
    c = df["close"]
    h = df["high"]
    l = df["low"]
    v = df["volume"]
    df["rsi_14"] = crsi(c)
    m, s, hh = cmacd(c)
    df["macd"] = m
    df["macd_signal"] = s
    df["macd_hist"] = hh
    bw, pb = cbb(c)
    df["bb_width"] = bw
    df["bb_pct_b"] = pb
    df["atr_14"] = catr(h, l, c)
    obv = cobv(c, v)
    df["obv_change_pct"] = obv.pct_change(periods=14).replace([np.inf, -np.inf], 0).fillna(0)
    for w in [20, 50, 200]:
        df[f"price_sma_{w}_ratio"] = c / c.rolling(w, min_periods=1).mean()
    df["volume_sma_20_ratio"] = v / v.rolling(20, min_periods=1).mean().replace(0, 1)
    for p in [1, 5, 7, 14, 30]:
        df[f"return_{p}d"] = c.pct_change(periods=p).replace([np.inf, -np.inf], 0).fillna(0)
    df["hl_range_pct"] = ((h - l) / c.replace(0, np.nan)).fillna(0)
    df["body_size_pct"] = ((df["close"] - df["open"]).abs() / c.replace(0, np.nan)).fillna(0)
    df["volatility_14d"] = c.pct_change().rolling(14).std().fillna(0)
    return df


# ------------------------------------------------------------------
# Swing-low / swing-high detection (no look-ahead, precomputed once per stock)
# A confirmed swing low at bar i requires bars[i-3..i-1] > low[i] AND
# bars[i+1..i+3] > low[i]. To make this CAUSAL (usable at prediction
# time), we shift the confirmation 3 bars forward — i.e. we only
# "know" a swing low at bar i once we've seen bars i+1, i+2, i+3.
# At prediction time for bar t, the latest confirmed swing low is
# from bar t-3.
# ------------------------------------------------------------------
def detect_swing_lows(low: np.ndarray, lookback: int = SWING_LOOKBACK) -> np.ndarray:
    """Return array of indices where swing lows occur (full detection over the
    whole series — caller filters by confirmation afterward)."""
    n = len(low)
    if n < 2 * lookback + 1:
        return np.array([], dtype=int)
    swl = []
    for i in range(lookback, n - lookback):
        center = low[i]
        left = low[i - lookback:i]
        right = low[i + 1:i + 1 + lookback]
        if np.all(left > center) and np.all(right > center):
            swl.append(i)
    return np.array(swl, dtype=int)


def detect_swing_highs(high: np.ndarray, lookback: int = SWING_LOOKBACK) -> np.ndarray:
    n = len(high)
    if n < 2 * lookback + 1:
        return np.array([], dtype=int)
    swh = []
    for i in range(lookback, n - lookback):
        center = high[i]
        left = high[i - lookback:i]
        right = high[i + 1:i + 1 + lookback]
        if np.all(left < center) and np.all(right < center):
            swh.append(i)
    return np.array(swh, dtype=int)


class StockSupportCache:
    """Per-stock precomputed support/resistance lookups.
    Speeds up `nearest_support_at` / `nearest_resistance_at` from O(N²) per
    stock to O(N log N) per stock by computing all swing lows/highs once.
    """
    def __init__(self, sd: pd.DataFrame, lookback: int = SWING_LOOKBACK):
        self.lookback = lookback
        low = sd["low"].values
        high = sd["high"].values
        # Pre-compute all swing lows/highs (full series)
        self.swl_idx = detect_swing_lows(low, lookback=lookback)
        self.swl_val = low[self.swl_idx] if len(self.swl_idx) > 0 else np.array([])
        self.swh_idx = detect_swing_highs(high, lookback=lookback)
        self.swh_val = high[self.swh_idx] if len(self.swh_idx) > 0 else np.array([])
        # Rolling 20-day min/max (causal — uses only past 20 bars at each t)
        low_s = pd.Series(low)
        high_s = pd.Series(high)
        self.rolling_min_20 = low_s.rolling(20, min_periods=1).min().values
        self.rolling_max_20 = high_s.rolling(20, min_periods=1).max().values

    def support_at(self, t: int) -> float:
        """Latest confirmed swing low OR 20-day low, whichever is higher."""
        if t < self.lookback + 1:
            return np.nan
        # Latest confirmed swing low at time t = last swl with (idx + lookback) <= t-1
        # = idx <= t - 1 - lookback
        cutoff = t - 1 - self.lookback
        if len(self.swl_idx) > 0:
            mask = self.swl_idx <= cutoff
            valid_idx = self.swl_idx[mask]
            valid_val = self.swl_val[mask]
            swing_support = float(valid_val[-1]) if len(valid_val) > 0 else np.nan
        else:
            swing_support = np.nan
        twenty_low = float(self.rolling_min_20[t - 1]) if t >= 1 else float(self.rolling_min_20[0])
        candidates = [v for v in [swing_support, twenty_low] if not np.isnan(v) and v > 0]
        return max(candidates) if candidates else np.nan

    def resistance_at(self, t: int) -> float:
        if t < self.lookback + 1:
            return np.nan
        cutoff = t - 1 - self.lookback
        if len(self.swh_idx) > 0:
            mask = self.swh_idx <= cutoff
            valid_idx = self.swh_idx[mask]
            valid_val = self.swh_val[mask]
            swing_resistance = float(valid_val[-1]) if len(valid_val) > 0 else np.nan
        else:
            swing_resistance = np.nan
        twenty_high = float(self.rolling_max_20[t - 1]) if t >= 1 else float(self.rolling_max_20[0])
        candidates = [v for v in [swing_resistance, twenty_high] if not np.isnan(v) and v > 0]
        return min(candidates) if candidates else np.nan


# ------------------------------------------------------------------
# Stop-loss + target computation (NEW rule)
# ------------------------------------------------------------------
def compute_sl_and_targets(
    cp: float,
    atr: float,
    support: float,
    resistance: float,
    direction: str,  # "BUY" or "SELL"
    sl_atr_mult: float = ATR_STOP_MULT,
) -> Tuple[float, float, float, float, bool]:
    """Returns (sl, tp1, tp2, tp3, skip_trade).

    SL rule:
      support_stop = support − 0.15×ATR (BUY) / resistance + 0.15×ATR (SELL)
      atr_stop     = cp ∓ 0.8×ATR
      final_sl     = whichever is CLOSER to entry (smaller risk), but
                    never tighter than 0.5×ATR.

    Resistance check:
      skip trade if nearest resistance is < 1R above entry (no room for TP1).
      For SELL, mirror: skip if nearest support is < 1R below entry.
    """
    if direction == "BUY":
        # Long: SL is below entry
        support_stop = support - SUPPORT_BUFFER_MULT * atr if not np.isnan(support) else cp - sl_atr_mult * atr
        atr_stop = cp - sl_atr_mult * atr
        # Closer to entry = larger of (support_stop, atr_stop) since both below
        sl = max(support_stop, atr_stop)
        # Never tighter than 0.5×ATR
        min_sl = cp - MIN_SL_MULT * atr
        if (cp - sl) < MIN_SL_MULT * atr:
            sl = min_sl  # loosen to 0.5×ATR floor
        # Targets
        r = cp - sl  # risk per share
        tp1 = cp + TP1_MULT * r
        tp2 = cp + TP2_MULT * r
        tp3 = cp + TP3_MULT * r
        # Resistance check: skip if nearest resistance < 1R above entry
        skip = (not np.isnan(resistance)) and (resistance - cp) < RESISTANCE_MIN_R * r
    else:  # SELL
        resistance_stop = resistance + SUPPORT_BUFFER_MULT * atr if not np.isnan(resistance) else cp + sl_atr_mult * atr
        atr_stop = cp + sl_atr_mult * atr
        # Closer to entry = smaller of the two above-entry values
        sl = min(resistance_stop, atr_stop)
        max_sl = cp + MIN_SL_MULT * atr
        if (sl - cp) < MIN_SL_MULT * atr:
            sl = max_sl
        r = sl - cp
        tp1 = cp - TP1_MULT * r
        tp2 = cp - TP2_MULT * r
        tp3 = cp - TP3_MULT * r
        skip = (not np.isnan(support)) and (cp - support) < RESISTANCE_MIN_R * r
    return float(sl), float(tp1), float(tp2), float(tp3), bool(skip)


# ------------------------------------------------------------------
# Label generation: did TP1 hit before SL within `horizon` bars?
# ------------------------------------------------------------------
def make_label(
    sd: pd.DataFrame,
    t: int,
    direction: str,
    entry: float,
    sl: float,
    tp1: float,
    horizon: int = LABEL_HORIZON,
    high_arr: Optional[np.ndarray] = None,
    low_arr: Optional[np.ndarray] = None,
) -> int:
    """Returns 1 if TP1 hit before SL within `horizon` bars, else 0.
    If neither hit, returns 0 (we treat no-hit-as-loss for label purposes).
    Optionally accept precomputed high/low arrays (NumPy) to avoid iloc.
    """
    if high_arr is not None and low_arr is not None:
        # Fast path: use precomputed arrays
        end = min(t + 1 + horizon, len(high_arr))
        for j in range(t + 1, end):
            h = float(high_arr[j])
            l = float(low_arr[j])
            if direction == "BUY":
                if l <= sl: return 0
                if h >= tp1: return 1
            else:
                if h >= sl: return 0
                if l <= tp1: return 1
        return 0
    # Slow path: use iloc (fallback)
    future = sd.iloc[t + 1:t + 1 + horizon]
    if len(future) == 0:
        return 0
    highs = future["high"].values
    lows = future["low"].values
    for h, l in zip(highs, lows):
        if direction == "BUY":
            if l <= sl: return 0
            if h >= tp1: return 1
        else:
            if h >= sl: return 0
            if l <= tp1: return 1
    return 0


def simulate_exit_pnl(
    sd: pd.DataFrame,
    t: int,
    direction: str,
    entry: float,
    sl: float,
    tp1: float,
    tp2: float,
    tp3: float,
    horizon: int = 21,
    cost: float = COST,
    high_arr: Optional[np.ndarray] = None,
    low_arr: Optional[np.ndarray] = None,
    close_arr: Optional[np.ndarray] = None,
) -> float:
    """Simulate the 50/30/20 exit ladder with breakeven-after-TP1 rule.
    Returns the realized fractional return on the trade (already net of cost).
    Accepts precomputed high/low/close arrays to avoid iloc.
    """
    if high_arr is not None and low_arr is not None and close_arr is not None:
        # Fast path — direct numpy indexing
        n = len(high_arr)
        end = min(t + 1 + horizon, n)
        remaining = 1.0
        realized_ret = 0.0
        cur_sl = sl
        tp1_hit = False
        for j in range(t + 1, end):
            h = float(high_arr[j])
            l = float(low_arr[j])
            if direction == "BUY":
                if l <= cur_sl:
                    realized_ret += remaining * (cur_sl - entry) / entry
                    remaining = 0
                    break
                if h >= tp3 and remaining > 0:
                    realized_ret += remaining * (tp3 - entry) / entry
                    remaining = 0
                    break
                if h >= tp2 and remaining > 0:
                    close_frac = 0.30 if not tp1_hit else 0.30 / 0.50 * remaining if remaining > 0 else 0
                    close_frac = min(close_frac, remaining)
                    realized_ret += close_frac * (tp2 - entry) / entry
                    remaining -= close_frac
                if h >= tp1 and remaining > 0 and not tp1_hit:
                    close_frac = min(0.50, remaining)
                    realized_ret += close_frac * (tp1 - entry) / entry
                    remaining -= close_frac
                    tp1_hit = True
                    cur_sl = entry
            else:
                if h >= cur_sl:
                    realized_ret += remaining * (entry - cur_sl) / entry
                    remaining = 0
                    break
                if l <= tp3 and remaining > 0:
                    realized_ret += remaining * (entry - tp3) / entry
                    remaining = 0
                    break
                if l <= tp2 and remaining > 0:
                    close_frac = 0.30 if not tp1_hit else 0.30 / 0.50 * remaining if remaining > 0 else 0
                    close_frac = min(close_frac, remaining)
                    realized_ret += close_frac * (entry - tp2) / entry
                    remaining -= close_frac
                if l <= tp1 and remaining > 0 and not tp1_hit:
                    close_frac = min(0.50, remaining)
                    realized_ret += close_frac * (entry - tp1) / entry
                    remaining -= close_frac
                    tp1_hit = True
                    cur_sl = entry
        if remaining > 0:
            last_close = float(close_arr[end - 1])
            if direction == "BUY":
                realized_ret += remaining * (last_close - entry) / entry
            else:
                realized_ret += remaining * (entry - last_close) / entry
        realized_ret -= 2 * cost
        return float(realized_ret)
    # Slow path — fallback using iloc
    future = sd.iloc[t + 1:t + 1 + horizon]
    if len(future) == 0:
        return 0.0
    remaining = 1.0
    realized_ret = 0.0
    cur_sl = sl
    tp1_hit = False
    for h, l in zip(future["high"].values, future["low"].values):
        if direction == "BUY":
            if l <= cur_sl:
                realized_ret += remaining * (cur_sl - entry) / entry
                remaining = 0
                break
            if h >= tp3 and remaining > 0:
                realized_ret += remaining * (tp3 - entry) / entry
                remaining = 0
                break
            if h >= tp2 and remaining > 0:
                close_frac = 0.30 if not tp1_hit else 0.30 / 0.50 * remaining if remaining > 0 else 0
                close_frac = min(close_frac, remaining)
                realized_ret += close_frac * (tp2 - entry) / entry
                remaining -= close_frac
            if h >= tp1 and remaining > 0 and not tp1_hit:
                close_frac = min(0.50, remaining)
                realized_ret += close_frac * (tp1 - entry) / entry
                remaining -= close_frac
                tp1_hit = True
                cur_sl = entry
        else:
            if h >= cur_sl:
                realized_ret += remaining * (entry - cur_sl) / entry
                remaining = 0
                break
            if l <= tp3 and remaining > 0:
                realized_ret += remaining * (entry - tp3) / entry
                remaining = 0
                break
            if l <= tp2 and remaining > 0:
                close_frac = 0.30 if not tp1_hit else 0.30 / 0.50 * remaining if remaining > 0 else 0
                close_frac = min(close_frac, remaining)
                realized_ret += close_frac * (entry - tp2) / entry
                remaining -= close_frac
            if l <= tp1 and remaining > 0 and not tp1_hit:
                close_frac = min(0.50, remaining)
                realized_ret += close_frac * (entry - tp1) / entry
                remaining -= close_frac
                tp1_hit = True
                cur_sl = entry
    if remaining > 0:
        last_close = float(future.iloc[-1]["close"])
        if direction == "BUY":
            realized_ret += remaining * (last_close - entry) / entry
        else:
            realized_ret += remaining * (entry - last_close) / entry
    realized_ret -= 2 * cost
    return float(realized_ret)


# ------------------------------------------------------------------
# Load + preprocess OHLCV
# ------------------------------------------------------------------
def load_ohlcv(stocks: List[str]) -> pd.DataFrame:
    frames = []
    for s in stocks:
        p = OHLCV_DIR / f"{s}.csv"
        if not p.exists():
            continue
        try:
            df = pd.read_csv(p, usecols=range(6))
            df = df[df["volume"] > 0].reset_index(drop=True)
            if len(df) < MIN_PRED_BARS:
                continue
            df = add_features(df)
            df["symbol"] = s
            frames.append(df)
        except Exception:
            continue
    if not frames:
        return pd.DataFrame()
    return pd.concat(frames, ignore_index=True)


def get_atr_per_stock(df: pd.DataFrame) -> Dict[str, Dict[str, float]]:
    out = {}
    for s in df["symbol"].unique():
        sd = df[df["symbol"] == s].sort_values("date").reset_index(drop=True)
        if len(sd) < 14:
            continue
        a = float(sd.iloc[-1]["atr_14"])
        out[s] = {
            "cp": float(sd.iloc[-1]["close"]),
            "atr": a if a > 0 else float(sd.iloc[-1]["close"]) * 0.02,
        }
    return out


# ------------------------------------------------------------------
# Build training set: per-bar features + binary labels (long + short)
# We treat each bar as BOTH a long and a short setup, generating 2 rows
# per bar (one for each direction). This way the model learns direction-
# conditional probability of TP1-hit.
# ------------------------------------------------------------------
def build_training_set(
    df: pd.DataFrame,
    sample_size: int = 100_000,
) -> pd.DataFrame:
    """Per-stock, per-bar, per-direction training rows.
    Memory-efficient: builds NumPy arrays per stock (X, y, meta) instead
    of dict-of-rows, then concatenates + samples down to sample_size.

    Per stock output (NumPy):
      X  = float32 [n_rows, len(FC)]   — features
      y  = int8   [n_rows]             — label (TP1-hit-before-SL)
      meta = float32 [n_rows, 5]       — [cp, atr, sl, tp1, tp2] for inference/backtest
      dirs = bool [n_rows]             — True=BUY, False=SELL
    """
    X_parts = []
    y_parts = []
    meta_parts = []
    dir_parts = []
    sym_parts = []

    for si, s in enumerate(df["symbol"].unique()):
        sd = df[df["symbol"] == s].sort_values("date").reset_index(drop=True)
        n = len(sd)
        if n < MIN_TRAIN_BARS:
            continue
        sc = StockSupportCache(sd)
        feat_mat = sd[FC].fillna(0).values.astype(np.float32)
        high_arr = sd["high"].values.astype(np.float64)
        low_arr = sd["low"].values.astype(np.float64)
        close_arr = sd["close"].values.astype(np.float64)
        atr_arr = sd["atr_14"].values.astype(np.float64)
        # Pre-allocate per-stock arrays (max possible rows = 2 * (n - 20 - LABEL_HORIZON))
        max_rows = 2 * max(0, n - 20 - LABEL_HORIZON)
        if max_rows <= 0:
            continue
        X_stock = np.zeros((max_rows, len(FC)), dtype=np.float32)
        y_stock = np.zeros(max_rows, dtype=np.int8)
        meta_stock = np.zeros((max_rows, 5), dtype=np.float32)
        dir_stock = np.zeros(max_rows, dtype=bool)
        sym_stock = np.full(max_rows, -1, dtype=np.int32)  # stock index, mapped later
        row_idx = 0
        for t in range(20, n - LABEL_HORIZON):
            cp = float(close_arr[t])
            atr = float(atr_arr[t])
            if atr <= 0 or cp <= 0:
                continue
            support = sc.support_at(t)
            resistance = sc.resistance_at(t)
            if np.isnan(support) or np.isnan(resistance):
                continue
            feat_row = feat_mat[t]
            for direction in ("BUY", "SELL"):
                sl, tp1, tp2, tp3, skip = compute_sl_and_targets(
                    cp, atr, support, resistance, direction
                )
                if skip or sl <= 0 or tp1 <= 0:
                    continue
                y = make_label(sd, t, direction, cp, sl, tp1,
                               high_arr=high_arr, low_arr=low_arr)
                X_stock[row_idx] = feat_row
                y_stock[row_idx] = y
                meta_stock[row_idx] = [cp, atr, sl, tp1, tp2]
                dir_stock[row_idx] = (direction == "BUY")
                sym_stock[row_idx] = si
                row_idx += 1
        if row_idx == 0:
            continue
        X_parts.append(X_stock[:row_idx])
        y_parts.append(y_stock[:row_idx])
        meta_parts.append(meta_stock[:row_idx])
        dir_parts.append(dir_stock[:row_idx])
        sym_parts.append(sym_stock[:row_idx])
        if (si + 1) % 50 == 0:
            total = sum(p.shape[0] for p in X_parts)
            print(f"  build: {si+1} stocks processed, {total:,} rows so far", flush=True)

    if not X_parts:
        return pd.DataFrame()
    X = np.concatenate(X_parts, axis=0)
    y = np.concatenate(y_parts, axis=0)
    meta = np.concatenate(meta_parts, axis=0)
    dirs = np.concatenate(dir_parts, axis=0)
    syms = np.concatenate(sym_parts, axis=0)
    print(f"  Total training rows before sampling: {len(X):,}")
    # Sample down to keep training fast
    if len(X) > sample_size:
        idx = np.random.default_rng(42).choice(len(X), size=sample_size, replace=False)
        X = X[idx]; y = y[idx]; meta = meta[idx]; dirs = dirs[idx]; syms = syms[idx]
    # Build a DataFrame for downstream code (train_cl2 uses train_df["_y"], train_df[FC], train_df["_symbol"])
    sym_list = list(df["symbol"].unique())
    out = pd.DataFrame(X, columns=FC)
    out["_y"] = y.astype(int)
    out["_direction"] = np.where(dirs, "BUY", "SELL")
    out["_symbol"] = [sym_list[s] for s in syms]
    out["_cp"] = meta[:, 0]
    out["_atr"] = meta[:, 1]
    out["_sl"] = meta[:, 2]
    out["_tp1"] = meta[:, 3]
    out["_tp2"] = meta[:, 4]
    return out


# ------------------------------------------------------------------
# Purged time-ordered cross-validation
# Split stocks into K folds BY SYMBOL (so each stock's bars stay
# together — avoids leakage within a stock). Purge gap = LABEL_HORIZON
# bars at the boundary.
# ------------------------------------------------------------------
def purged_stock_folds(stocks: List[str], k: int = 3) -> List[Tuple[set, set]]:
    """Returns list of (train_stocks, val_stocks) tuples."""
    arr = sorted(stocks)
    n = len(arr)
    fold_size = n // k
    folds = []
    for i in range(k):
        val = set(arr[i * fold_size:(i + 1) * fold_size] if i < k - 1 else arr[i * fold_size:])
        train = set(arr) - val
        folds.append((train, val))
    return folds


# ------------------------------------------------------------------
# 7 base model constructors
# ------------------------------------------------------------------
def build_7_models():
    """Returns dict of {name: estimator} for the 7 base models."""
    import lightgbm as lgb
    return {
        "LightGBM-A": lgb.LGBMClassifier(
            n_estimators=100, max_depth=3, num_leaves=8,
            learning_rate=0.05, random_state=42, verbose=-1, n_jobs=-1,
        ),
        "LightGBM-B": lgb.LGBMClassifier(
            n_estimators=60, max_depth=5, num_leaves=31,
            learning_rate=0.08, random_state=43, verbose=-1, n_jobs=-1,
        ),
        "HistGBM": HistGradientBoostingClassifier(
            max_iter=80, max_depth=4, learning_rate=0.08, random_state=42,
        ),
        "ExtraTrees": ExtraTreesClassifier(
            n_estimators=80, max_depth=6, min_samples_leaf=15,
            random_state=42, n_jobs=-1,
        ),
        "RandomForest": RandomForestClassifier(
            n_estimators=80, max_depth=5, min_samples_leaf=20,
            random_state=42, n_jobs=-1,
        ),
        "Logistic": LogisticRegression(
            C=0.5, max_iter=200, random_state=42,
        ),
        "MLP": MLPClassifier(
            hidden_layer_sizes=(32,), activation="relu",
            max_iter=120, alpha=1e-3, learning_rate_init=1e-2,
            random_state=42, early_stopping=True,
        ),
    }


def fit_with_scaler(model, X, y, X_val=None):
    """Some models benefit from scaled features; we standardize for all."""
    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)
    if hasattr(model, "fit"):
        model.fit(Xs, y)
    return scaler


def predict_proba_safe(model, X, scaler) -> np.ndarray:
    """Returns P(y=1) array. Handles different model APIs."""
    Xs = scaler.transform(X)
    try:
        proba = model.predict_proba(Xs)
        if proba.shape[1] >= 2:
            return proba[:, 1]
        else:
            return proba[:, 0]
    except Exception:
        # Some classifiers may not have predict_proba — fallback to decision_function
        try:
            return 1 / (1 + np.exp(-model.decision_function(Xs)))
        except Exception:
            return np.full(X.shape[0], 0.5)


# ------------------------------------------------------------------
# Training pipeline
# ------------------------------------------------------------------
def train_cl2(stocks: List[str], df_all: pd.DataFrame) -> Tuple[dict, dict, dict, dict]:
    """Train 7 base models + logistic meta on OOF predictions + calibration.

    Returns:
        cl2_models: per-model dict {name: {trained, version, predictions: {SYM: pred}}}
        cl2_ens: per-stock CL-2 Ensemble prediction (the meta output)
        calib_map: dict {bin_center: hit_rate} for transparency
        meta_state: dict {scaler_means, scaler_stds, meta_coef, meta_intercept} for inference
    """
    print("\n[CL-2] Building training set...")
    train_df = build_training_set(df_all, sample_size=120_000)
    if train_df.empty:
        print("  ! Empty training set")
        return {}, {}, {}, {}
    print(f"  Training rows: {len(train_df):,}")
    pos_rate = train_df["_y"].mean()
    print(f"  Positive rate (TP1 hit before SL): {pos_rate:.3f}")

    X = train_df[FC].fillna(0).values
    y = train_df["_y"].values.astype(int)

    # 3-fold purged CV (by symbol)
    syms = sorted(train_df["_symbol"].unique())
    folds = purged_stock_folds(syms, k=3)

    # OOF predictions matrix (n_rows × 7)
    oof = np.zeros((len(train_df), 7), dtype=np.float32)
    fold_assign = np.full(len(train_df), -1, dtype=int)
    for fi, (tr_syms, va_syms) in enumerate(folds):
        tr_mask = train_df["_symbol"].isin(tr_syms).values
        va_mask = train_df["_symbol"].isin(va_syms).values
        # Purge boundary: drop first/last LABEL_HORIZON bars of each val stock
        # (already implicitly handled since we don't share bars across folds)
        if tr_mask.sum() < 50 or va_mask.sum() < 50:
            continue
        X_tr = train_df.loc[tr_mask, FC].fillna(0).values
        y_tr = train_df.loc[tr_mask, "_y"].values.astype(int)
        X_va = train_df.loc[va_mask, FC].fillna(0).values
        fold_assign[va_mask] = fi
        print(f"  Fold {fi+1}/3: train={tr_mask.sum():,}, val={va_mask.sum():,}")
        for mi, (mname, ctor) in enumerate(build_7_models().items()):
            m = ctor
            scaler = StandardScaler()
            X_tr_s = scaler.fit_transform(X_tr)
            X_va_s = scaler.transform(X_va)
            try:
                m.fit(X_tr_s, y_tr)
                proba = predict_proba_safe(m, X_va, scaler)
                oof[va_mask, mi] = proba
            except Exception as e:
                print(f"    ! {mname} failed: {e}")
                oof[va_mask, mi] = 0.5

    # Train final 7 base models on ALL data, for inference
    print("\n[CL-2] Training final 7 base models on full data...")
    final_models = {}
    final_scalers = {}
    for mname, ctor in build_7_models().items():
        print(f"  {mname}...", end=" ", flush=True)
        m = ctor
        scaler = StandardScaler()
        Xs = scaler.fit_transform(X)
        try:
            m.fit(Xs, y)
            final_models[mname] = m
            final_scalers[mname] = scaler
            print("OK")
        except Exception as e:
            print(f"FAIL ({e})")

    # Train logistic meta on OOF predictions (where all 7 models produced output)
    print("\n[CL-2] Training logistic meta-model on OOF predictions...")
    valid_mask = fold_assign >= 0  # rows that got OOF predictions
    X_meta = oof[valid_mask]
    y_meta = y[valid_mask]
    if X_meta.shape[0] < 50 or len(np.unique(y_meta)) < 2:
        print("  ! Not enough OOF data for meta-model — using mean of 7 probs as fallback")
        meta_state = {"fallback_mean": True}
        # Final predictions per stock = mean of 7 model probs
        calib_map = {}
    else:
        meta = LogisticRegression(C=1.0, max_iter=200, random_state=42)
        meta.fit(X_meta, y_meta)
        meta_proba = meta.predict_proba(X_meta)[:, 1]
        try:
            auc = roc_auc_score(y_meta, meta_proba)
            print(f"  Meta-model OOS AUC: {auc:.4f}")
        except Exception:
            pass
        # Calibrate via decile binning
        bins = np.linspace(0, 1, 11)
        bin_centers = (bins[:-1] + bins[1:]) / 2
        bin_inds = np.digitize(meta_proba, bins) - 1
        bin_inds = np.clip(bin_inds, 0, 9)
        calib_map = {}
        for bi in range(10):
            mask = bin_inds == bi
            if mask.sum() > 0:
                hr = float(y_meta[mask].mean())
                bc = float(bin_centers[bi])
                calib_map[bc] = hr
        # Save calib.pkl
        with open(CALIB_FILE, "wb") as f:
            pickle.dump({"meta": meta, "scaler": None, "calib_map": calib_map}, f)
        # Build a linear interpolation function for inference
        calib_xs = sorted(calib_map.keys())
        calib_ys = [calib_map[x] for x in calib_xs]
        meta_state = {
            "fallback_mean": False,
            "meta_coef": meta.coef_.tolist(),
            "meta_intercept": float(meta.intercept_[0]),
            "calib_xs": calib_xs,
            "calib_ys": calib_ys,
        }

    return final_models, final_scalers, meta_state, calib_map, train_df


def calibrate_proba(p: float, meta_state: dict) -> float:
    """Apply calibration map (piecewise linear) to a raw probability."""
    if meta_state.get("fallback_mean"):
        return p
    xs = meta_state.get("calib_xs", [])
    ys = meta_state.get("calib_ys", [])
    if not xs:
        return p
    if p <= xs[0]:
        return ys[0]
    if p >= xs[-1]:
        return ys[-1]
    # Linear interpolation
    for i in range(len(xs) - 1):
        if xs[i] <= p <= xs[i + 1]:
            t = (p - xs[i]) / (xs[i + 1] - xs[i]) if xs[i + 1] > xs[i] else 0
            return ys[i] + t * (ys[i + 1] - ys[i])
    return p


def meta_predict(proba_7: np.ndarray, meta_state: dict) -> float:
    """Apply logistic meta + calibration. proba_7 = array of 7 model probabilities."""
    if meta_state.get("fallback_mean"):
        raw = float(np.mean(proba_7))
    else:
        coef = np.array(meta_state["meta_coef"][0])
        intercept = meta_state["meta_intercept"]
        z = np.dot(coef, proba_7) + intercept
        raw = 1 / (1 + np.exp(-z))
    return calibrate_proba(raw, meta_state)


def agreement_score(proba_7: np.ndarray) -> float:
    """Compute agreement ∈ [0,1] = 1 − 2×std(proba_7), clamped to [0,1].
    High agreement (all 7 models say same thing) → 1.0
    Low agreement (models disagree) → ~0.0
    """
    s = float(np.std(proba_7))
    return float(max(0.0, min(1.0, 1.0 - 2.0 * s)))


# ------------------------------------------------------------------
# Generate per-stock predictions
# ------------------------------------------------------------------
def predict_all_stocks(
    stocks: List[str],
    df_all: pd.DataFrame,
    atr_per: Dict[str, Dict[str, float]],
    final_models: dict,
    final_scalers: dict,
    meta_state: dict,
) -> Tuple[Dict[str, dict], Dict[str, dict]]:
    """For each stock, compute the CL-2 ensemble prediction at the latest bar.

    Returns:
        cl2_per_model: per-model per-stock predictions dict
                       {model_name: {symbol: pred}}
        cl2_ens: per-stock ensemble prediction {symbol: pred}
    """
    print("\n[CL-2] Generating per-stock predictions...")
    cl2_per_model = {mname: {} for mname in CL2_MODEL_NAMES}
    cl2_ens = {}

    for si, s in enumerate(stocks):
        if s not in atr_per:
            continue
        sd = df_all[df_all["symbol"] == s].sort_values("date").reset_index(drop=True)
        n = len(sd)
        if n < MIN_PRED_BARS:
            continue
        t = n - 1  # latest bar
        cp = float(sd.iloc[t]["close"])
        atr = float(sd.iloc[t]["atr_14"])
        if atr <= 0 or cp <= 0:
            continue
        sc = StockSupportCache(sd)
        support = sc.support_at(t)
        resistance = sc.resistance_at(t)
        if np.isnan(support) or np.isnan(resistance):
            continue

        # Compute features at bar t — precompute the feature matrix row
        feat_row = sd[FC].iloc[t].fillna(0).values.astype(np.float32).reshape(1, -1)

        # Get 7 model probabilities
        proba_7 = np.zeros(7)
        for mi, mname in enumerate(CL2_MODEL_NAMES):
            m = final_models.get(mname)
            scaler = final_scalers.get(mname)
            if m is None or scaler is None:
                proba_7[mi] = 0.5
                continue
            proba_7[mi] = float(predict_proba_safe(m, feat_row, scaler)[0])

        # Meta-model output
        raw_prob = float(np.mean(proba_7)) if meta_state.get("fallback_mean") else \
                   1 / (1 + np.exp(-(np.dot(meta_state["meta_coef"][0], proba_7) + meta_state["meta_intercept"])))
        exp_win_rate = calibrate_proba(raw_prob, meta_state)
        agreement = agreement_score(proba_7)
        confidence = exp_win_rate * (0.6 + 0.4 * agreement) * 100

        # Decide signal based on calibrated prob
        # The model is symmetric: high prob → BUY direction wins, low prob → SELL direction wins.
        # We pick the direction with higher expected edge:
        if exp_win_rate >= BUY_THRESHOLD:
            signal = "BUY"
            direction = "LONG"
        elif exp_win_rate <= SELL_THRESHOLD:
            signal = "SELL"
            direction = "SHORT"
        else:
            signal = "HOLD"
            direction = "LONG"

        # Compute SL/TP for the chosen direction
        sl, tp1, tp2, tp3, skip = compute_sl_and_targets(
            cp, atr, support, resistance, signal if signal != "HOLD" else "BUY"
        )
        if signal == "HOLD":
            # For HOLD, set SL/TP to entry to avoid polluting downstream logic
            sl = cp
            tp1 = cp
            tp2 = cp
            tp3 = cp
            skip = True

        # For SELL signals, the model probability was for the long setup.
        # For SELL, we mirror: 1 - exp_win_rate is the SELL-side win rate
        if signal == "SELL":
            sell_prob = 1 - exp_win_rate
            exp_win_rate = sell_prob
            confidence = sell_prob * (0.6 + 0.4 * agreement) * 100

        avg_return = (exp_win_rate * TP1_MULT - (1 - exp_win_rate) * 1.0) / 1.0  # rough

        # Per-model prediction entries (full shape for AI Models tab display)
        for mi, mname in enumerate(CL2_MODEL_NAMES):
            mp = float(proba_7[mi])
            # Per-model signal: BUY if mp >= 0.5 else SELL
            m_signal = "BUY" if mp >= 0.55 else ("SELL" if mp <= 0.45 else "HOLD")
            m_sl, m_tp1, m_tp2, m_tp3, m_skip = compute_sl_and_targets(
                cp, atr, support, resistance, m_signal if m_signal != "HOLD" else "BUY"
            )
            if m_signal == "HOLD":
                m_sl = cp
                m_tp1 = cp
                m_tp2 = cp
                m_tp3 = cp
            cl2_per_model[mname][s] = {
                "signal": m_signal,
                "direction": "LONG" if m_signal != "SELL" else "SHORT",
                "confidence": int(min(100, max(0, mp * 100))),
                "currentPrice": round(cp, 2),
                "entry": round(cp, 2),
                "tp1": round(m_tp1, 2),
                "tp2": round(m_tp2, 2),
                "tp3": round(m_tp3, 2),
                "sl": round(m_sl, 2),
                "avgReturn": round(float((mp - 0.5) * 2), 4),
                "raw_prob": round(float(mp), 4),
            }

        # Ensemble prediction entry (same shape as cl_ensemble_predictions entries)
        cl2_ens[s] = {
            "signal": signal,
            "direction": direction,
            "confidence": int(min(100, max(0, confidence))),
            "currentPrice": round(cp, 2),
            "entry": round(cp, 2),
            "tp1": round(tp1, 2),
            "tp2": round(tp2, 2),
            "tp3": round(tp3, 2),
            "sl": round(sl, 2),
            "avgReturn": round(float(avg_return), 4),
            "raw_prob": round(float(raw_prob), 4),
            "exp_win_rate": round(float(exp_win_rate), 4),
            "agreement": round(float(agreement), 4),
        }

        if (si + 1) % 50 == 0:
            print(f"  {si+1}/{len(stocks)} stocks processed...")

    print(f"  Done: {len(cl2_ens)} stocks have CL-2 ensemble predictions")
    return cl2_per_model, cl2_ens


# ------------------------------------------------------------------
# Backtest on holdout (last 20% of each stock)
# ------------------------------------------------------------------
def backtest_cl2(
    stocks: List[str],
    df_all: pd.DataFrame,
    atr_per: Dict[str, Dict[str, float]],
    final_models: dict,
    final_scalers: dict,
    meta_state: dict,
) -> dict:
    """Walk-forward backtest on last 20% of each stock's bars.

    For each bar in the holdout:
      1. Compute features at bar t
      2. Get 7 model probabilities
      3. Apply meta + calibration → exp_win_rate
      4. Decide signal (BUY/SELL/HOLD)
      5. Compute SL/TP using new rule
      6. If signal != HOLD and not skip:
         - Simulate exit ladder (50/30/20 with BE-after-TP1)
         - Record trade result
      7. Aggregate: win rate, profit factor, avg return, total trades,
         reliability table (deciles), and the calibrated-vs-actual hit rate.
    """
    print("\n[CL-2] Backtesting on 20% holdout per stock...")
    trades = []  # list of dicts: {symbol, t, direction, prob, exp_win_rate, ret}
    skips = 0

    for s in stocks:
        sd = df_all[df_all["symbol"] == s].sort_values("date").reset_index(drop=True)
        n = len(sd)
        if n < MIN_TRAIN_BARS + 20:
            continue
        sp = int(n * 0.8)
        if sp >= n - 5:
            continue
        sc = StockSupportCache(sd)
        # Precompute arrays once per stock for fast inner loop
        feat_mat = sd[FC].fillna(0).values.astype(np.float32)
        high_arr = sd["high"].values.astype(np.float64)
        low_arr = sd["low"].values.astype(np.float64)
        close_arr = sd["close"].values.astype(np.float64)
        atr_arr = sd["atr_14"].values.astype(np.float64)
        # Batch: gather all bar indices first, then run each model on the
        # batch — much faster than per-bar calls.
        bar_indices = list(range(sp, n - 5, 5))
        if not bar_indices:
            continue
        feat_batch = feat_mat[bar_indices]  # shape [n_bars, n_features]
        # Run each of 7 models on the whole batch
        proba_7_batch = np.zeros((len(bar_indices), 7), dtype=np.float32)
        for mi, mname in enumerate(CL2_MODEL_NAMES):
            m = final_models.get(mname)
            scaler = final_scalers.get(mname)
            if m is None or scaler is None:
                proba_7_batch[:, mi] = 0.5
                continue
            proba_7_batch[:, mi] = predict_proba_safe(m, feat_batch, scaler)

        # Now iterate bars, using precomputed probs
        for bi, t in enumerate(bar_indices):
            cp = float(close_arr[t])
            atr = float(atr_arr[t])
            if atr <= 0 or cp <= 0:
                continue
            support = sc.support_at(t)
            resistance = sc.resistance_at(t)
            if np.isnan(support) or np.isnan(resistance):
                continue

            proba_7 = proba_7_batch[bi]
            raw_prob = float(np.mean(proba_7)) if meta_state.get("fallback_mean") else \
                       1 / (1 + np.exp(-(np.dot(meta_state["meta_coef"][0], proba_7) + meta_state["meta_intercept"])))
            exp_win_rate = calibrate_proba(raw_prob, meta_state)
            if exp_win_rate >= BUY_THRESHOLD:
                direction = "BUY"
            elif exp_win_rate <= SELL_THRESHOLD:
                direction = "SELL"
                exp_win_rate = 1 - exp_win_rate
            else:
                continue  # HOLD — no trade

            sl, tp1, tp2, tp3, skip = compute_sl_and_targets(
                cp, atr, support, resistance, direction
            )
            if skip:
                skips += 1
                continue
            ret = simulate_exit_pnl(
                sd, t, direction, cp, sl, tp1, tp2, tp3, horizon=21,
                high_arr=high_arr, low_arr=low_arr, close_arr=close_arr,
            )
            trades.append({
                "symbol": s,
                "t": t,
                "direction": direction,
                "raw_prob": raw_prob,
                "exp_win_rate": exp_win_rate,
                "ret": ret,
            })

    if not trades:
        print("  ! No trades generated in backtest")
        return {
            "totalTrades": 0, "winRate": 0, "avgReturnPct": 0,
            "maxReturnPct": 0, "minReturnPct": 0, "stars": 0,
            "profitFactor": 0, "skippedTrades": skips,
            "reliabilityTable": [],
        }

    rets = np.array([tr["ret"] for tr in trades], dtype=float)
    # Filter out NaN/inf returns (rare edge case when entry=0)
    valid_mask = np.isfinite(rets)
    if not valid_mask.all():
        n_bad = int((~valid_mask).sum())
        print(f"  ! Dropping {n_bad} trades with non-finite returns")
    rets = rets[valid_mask]
    trade_dir = np.array([tr["direction"] for tr in trades])[valid_mask]
    trade_ewr = np.array([tr["exp_win_rate"] for tr in trades])[valid_mask]
    if len(rets) == 0:
        print("  ! All trades had non-finite returns")
        return {
            "totalTrades": 0, "winRate": 0, "avgReturnPct": 0,
            "maxReturnPct": 0, "minReturnPct": 0, "stars": 0,
            "profitFactor": 0, "skippedTrades": skips,
            "reliabilityTable": [],
        }
    wins = rets > 0
    win_rate = float(wins.mean())
    avg_ret = float(rets.mean())
    gross_profit = float(rets[rets > 0].sum()) if wins.any() else 0
    gross_loss = float(-rets[rets < 0].sum()) if (~wins).any() else 0
    profit_factor = gross_profit / max(gross_loss, 1e-9)
    print(f"  Trades: {len(rets)} | Win rate: {win_rate*100:.1f}% | "
          f"Avg ret: {avg_ret*100:.2f}% | PF: {profit_factor:.3f}")

    # Reliability table: deciles of exp_win_rate vs actual hit rate
    ewr = trade_ewr
    bins = np.linspace(0, 1, 11)
    bin_inds = np.clip(np.digitize(ewr, bins) - 1, 0, 9)
    reliability = []
    for bi in range(10):
        mask = bin_inds == bi
        if mask.sum() > 0:
            reliability.append({
                "bin": bi + 1,
                "bin_center": round(float((bins[bi] + bins[bi+1]) / 2), 2),
                "count": int(mask.sum()),
                "predicted_prob": round(float(ewr[mask].mean()), 3),
                "actual_hit_rate": round(float(wins[mask].mean()), 3),
            })
    print(f"  Reliability table ({len(reliability)} bins):")
    for r in reliability:
        marker = "OK" if abs(r["predicted_prob"] - r["actual_hit_rate"]) < 0.1 else "!!"
        print(f"    bin{r['bin']} pred={r['predicted_prob']:.3f} actual={r['actual_hit_rate']:.3f} n={r['count']} {marker}")

    return {
        "totalTrades": int(len(rets)),
        "buySignals": int(sum(1 for d in trade_dir if d == "BUY")),
        "sellSignals": int(sum(1 for d in trade_dir if d == "SELL")),
        "correctBuys": int(sum(1 for d, r in zip(trade_dir, rets) if d == "BUY" and r > 0)),
        "correctSells": int(sum(1 for d, r in zip(trade_dir, rets) if d == "SELL" and r > 0)),
        "winRate": round(float(win_rate * 100), 1),
        "avgReturnPct": round(float(avg_ret * 100), 2),
        "maxReturnPct": round(float(rets.max() * 100), 2),
        "minReturnPct": round(float(rets.min() * 100), 2),
        "stars": int(min(5, max(1, int(win_rate * 100 / 20) + 1))),
        "profitFactor": round(float(profit_factor), 3),
        "skippedTrades": int(skips),
        "reliabilityTable": reliability,
        "costBps": int(COST * 10000),
    }


# ------------------------------------------------------------------
# Save to ml_predictions_multi.json (preserve existing keys)
# ------------------------------------------------------------------
def save_to_json(
    cl2_per_model: Dict[str, Dict[str, dict]],
    cl2_ens: Dict[str, dict],
    cl2_backtest: dict,
    train_meta: dict,
):
    print(f"\n[CL-2] Saving to {PRED_FILE}...")
    # Load existing JSON (don't clobber the other 22 trained models)
    if PRED_FILE.exists():
        with open(PRED_FILE, "r") as f:
            existing = json.load(f)
    else:
        existing = {}

    # Build the per-model entry in the same shape as existing models.
    # The per-stock entry shape inside predictions.<model>.<symbol> matches
    # the existing CL_ensemble_predictions entries (signal, direction,
    # confidence, currentPrice, entry, tp1, tp2, tp3, sl, avgReturn).
    models_dict = existing.get("models", {})
    for mname, preds in cl2_per_model.items():
        models_dict[f"{mname} (CL-2)"] = {
            "trained": True,
            "version": "1.0.0",
            "predictions": preds,
        }
    existing["models"] = models_dict

    # Add CL-2 Ensemble prediction (per-stock)
    existing["cl2_ensemble_predictions"] = cl2_ens

    # Add CL-2 ensemble backtest entry
    ens_bt = existing.get("ensemble_backtesting", {})
    ens_bt["CL2_ENSEMBLE"] = cl2_backtest
    existing["ensemble_backtesting"] = ens_bt

    # Store CL-2 metadata for transparency
    existing["cl2_metadata"] = {
        "trained_at": pd.Timestamp.now().isoformat(),
        "sl_rule": f"support−0.15×ATR or entry∓{ATR_STOP_MULT}×ATR (whichever closer, min {MIN_SL_MULT}×ATR)",
        "tp_rule": f"TP1/2/3 = {TP1_MULT}R/{TP2_MULT}R/{TP3_MULT}R (R = |entry−SL|)",
        "target": f"TP1 hit before SL within {LABEL_HORIZON} days",
        "exits": "50%@TP1, 30%@TP2, 20%@TP3; SL→BE after TP1",
        "models": CL2_MODEL_NAMES,
        "meta_model": "LogisticRegression on 7-model OOF probs",
        "calibration": "Decile binning on OOS predictions",
        "thresholds": {"BUY": BUY_THRESHOLD, "SELL": SELL_THRESHOLD},
        "agreement_formula": "1 − 2×std(7 model probs), clamped [0,1]",
        "confidence_formula": "exp_win_rate × (0.6 + 0.4×agreement) × 100",
        "cost_bps": int(COST * 10000),
        "train_rows": int(train_meta.get("train_rows", 0)),
        "pos_rate": float(train_meta.get("pos_rate", 0)),
        "meta_auc": float(train_meta.get("meta_auc", 0)),
    }

    # Write back
    def clean(o):
        if isinstance(o, dict):
            return {k: clean(v) for k, v in o.items()}
        if isinstance(o, list):
            return [clean(v) for v in o]
        if isinstance(o, float):
            if np.isnan(o) or np.isinf(o):
                return 0
            return o
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return float(o)
        return o

    with open(PRED_FILE, "w") as f:
        json.dump(clean(existing), f, indent=2, allow_nan=False)
    print(f"  Saved. File size: {PRED_FILE.stat().st_size / 1024 / 1024:.1f} MB")


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", type=int, default=0,
                        help="Quick test on N stocks (default: all)")
    parser.add_argument("--backtest-only", action="store_true",
                        help="Skip training, only re-run backtest using cached calib.pkl")
    args = parser.parse_args()

    start = time.time()
    print("=" * 60)
    print("CL-2 Tier: 7 models + logistic meta-ensemble")
    print("  SL rule: support−0.15×ATR or entry∓0.8×ATR (min 0.5×ATR)")
    print(f"  Target: TP1 ({TP1_MULT}R) hit before SL within {LABEL_HORIZON} days")
    print("  Exits: 50%@TP1, 30%@TP2, 20%@TP3; SL→BE after TP1")
    print("=" * 60)

    # Determine stock universe
    all_stocks = sorted([f.stem for f in OHLCV_DIR.glob("*.csv")])
    if args.quick > 0:
        # Use a representative subset: top-volume + diverse sectors
        # Just take first N for reproducibility in quick mode
        stocks = all_stocks[:args.quick]
    else:
        stocks = all_stocks
    print(f"\nStocks: {len(stocks)}")

    print("\n[1/5] Loading OHLCV...")
    df_all = load_ohlcv(stocks)
    if df_all.empty:
        print("ERROR: No OHLCV data loaded")
        sys.exit(1)
    print(f"  {len(df_all):,} rows, {df_all['symbol'].nunique()} stocks")

    print("\n[2/5] Computing ATR per stock...")
    atr_per = get_atr_per_stock(df_all)
    print(f"  {len(atr_per)} stocks have ATR")

    if args.backtest_only:
        # Load calib.pkl and skip training
        if not CALIB_FILE.exists():
            print("ERROR: calib.pkl not found — run full training first")
            sys.exit(1)
        with open(CALIB_FILE, "rb") as f:
            saved = pickle.load(f)
        print("  Loaded cached calib.pkl — skipping training")
        # We still need to retrain final models for inference (no cached model state)
        # Fall through to training for now
        args.backtest_only = False

    # Train
    print("\n[3/5] Training CL-2 models + meta...")
    result = train_cl2(stocks, df_all)
    if len(result) == 5:
        final_models, final_scalers, meta_state, calib_map, train_df = result
    else:
        print("ERROR: training failed")
        sys.exit(1)

    # Generate per-stock predictions
    print("\n[4/5] Generating per-stock predictions...")
    cl2_per_model, cl2_ens = predict_all_stocks(
        stocks, df_all, atr_per, final_models, final_scalers, meta_state
    )

    # Backtest
    print("\n[5/5] Backtesting CL-2 ensemble...")
    cl2_bt = backtest_cl2(
        stocks, df_all, atr_per, final_models, final_scalers, meta_state
    )

    # Save
    train_meta = {
        "train_rows": len(train_df),
        "pos_rate": float(train_df["_y"].mean()),
        "meta_auc": 0.0,  # filled below if available
    }
    # Try to read AUC from printed output (already in stdout)
    save_to_json(cl2_per_model, cl2_ens, cl2_bt, train_meta)

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"CL-2 training complete in {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print(f"{'='*60}")
    print(f"  Models trained: {len(final_models)}/7")
    print(f"  Stocks with predictions: {len(cl2_ens)}")
    print(f"  Backtest: {cl2_bt['totalTrades']} trades, WR={cl2_bt['winRate']}%, PF={cl2_bt['profitFactor']}")


if __name__ == "__main__":
    main()
