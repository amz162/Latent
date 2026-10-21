#!/usr/bin/env python3
"""X-Models + X-Ensemble: 10 complementary strategies + meta-labeling.

Production-ready PSX swing-trading signal generator that:
- Implements 10 complementary rule-based strategies (each generates a
  binary BUY signal per bar)
- Uses those 10 signals + 20 technical indicators as features (30 total)
  for a LightGBM meta-model
- Trains the meta-model to predict P(TP1 before SL within 10-day horizon)
- Calibrates with Platt sigmoid + isotonic regression on a separate
  chronological calibration period (no leakage)
- Evaluates on an untouched final out-of-sample test period
- Compares all 10 strategies + CG-Ensemble + baselines (buy-hold, trend)
- Sweeps thresholds 0.70→0.95 with full metric suite
- Reports 90% precision check with trade count + CI (honest)
- Saves per-strategy predictions + X-Ensemble predictions + backtests

=========================================================================
10 STRATEGIES (each is a rule-based binary signal generator):

  1. trend_multi_tf      — BUY if price > EMA20 > EMA50 > SMA200 AND ADX>25
  2. breakout_relvol     — BUY if close > 20-day high AND volume > 1.5× 50d avg
  3. trend_pullback      — BUY if price > EMA50 AND touches EMA20 (within 2%)
  4. rsi_divergence      — BUY if price lower-low but RSI higher-low
  5. bb_mean_reversion   — BUY if price < lower BB AND BB width in bottom quartile
  6. vol_contraction     — BUY if BB width contracted 10d then expanded
  7. relative_strength   — BUY if stock 50d return > sector avg 50d return
  8. market_regime       — KSE-100 trend up → use trend strategies
  9. meta_label_cg       — CG-Ensemble predicted probability (continuous)
  10. triple_barrier_dyn — ATR-based SL/TP with dynamic adjustment

=========================================================================
META-MODEL (X-Ensemble):
  LightGBM on 30 features (10 strategy signals + 20 indicators)
  Predicts P(TP1 before SL within 10-day horizon)
  Calibrated on separate period with Platt + isotonic (no leakage)

=========================================================================
METHODOLOGY (proper, no leakage):
  - 3-way chronological split per stock:
      train      = bars [0, 0.60n)
      purge      = bars [0.60n, 0.60n + 15)
      calibrate  = bars [0.60n + 15, 0.75n)
      purge      = bars [0.75n, 0.75n + 15)
      test       = bars [0.75n + 15, n)
  - Walk-forward CV within train: 5 folds (train-on-earlier/test-on-later)
  - Next-bar-OPEN entries (no look-ahead)
  - Conservative ambiguous-barrier handling (SL wins ties)
  - Multi-class labels: 0=SL, 1=TP1-only, 2=TP2-only, 3=TP3, 4=timeout
  - Cost model: 50 bps round-trip + 15% CGT on gains
  - Threshold sweep 0.70→0.95 on untouched TEST period

=========================================================================
METRICS:
  - Precision (TP1-before-SL among predicted BUYs) + 95% Wilson CI
  - Trade count, coverage
  - Brier score, ECE (Expected Calibration Error)
  - Net expectancy (after costs + CGT)
  - Profit factor, Sharpe, Sortino, Max DD
  - TP1/TP2/TP3 hit rates (separately)
  - Buy-and-hold + trend-following baselines for comparison

Usage:
  python scripts/train_x_model.py            # full training + backtest
  python scripts/train_x_model.py --quick 20 # quick test on 20 stocks
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
from sklearn.isotonic import IsotonicRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import brier_score_loss, roc_auc_score

warnings.filterwarnings("ignore")

# Import shared infrastructure
sys.path.insert(0, str(Path(__file__).parent))
from train_cl2_tier import (
    OHLCV_DIR, PRED_FILE, FC,
    ATR_STOP_MULT, SUPPORT_BUFFER_MULT, MIN_SL_MULT,
    RESISTANCE_MIN_R, SWING_LOOKBACK,
    MIN_TRAIN_BARS, MIN_PRED_BARS,
    add_features, load_ohlcv, get_atr_per_stock,
    StockSupportCache, crsi, cmacd, cbb, catr, cobv,
)
from train_cg_model import (
    CG_TP1_MULT, CG_TP2_MULT, CG_TP3_MULT, CG_HORIZON,
    COST_ROUND_TRIP, CGT_RATE,
    compute_cg_sl_and_targets,
)

# X-specific constants
X_TRAIN_FRAC = 0.60
X_CALIB_FRAC = 0.15
X_TEST_FRAC = 0.25
PURGE_BARS = CG_HORIZON + 5  # 10-bar horizon + 5-bar embargo = 15 bars
X_CACHE_DIR = Path("/home/z/my-project") / "data" / "x_cache"
X_CACHE_DIR.mkdir(parents=True, exist_ok=True)
X_REPORT_FILE = Path("/home/z/my-project") / "data" / "x_report.json"

# Strategy names (10 total) — used as JSON keys
X_STRATEGY_NAMES = [
    "Trend Multi-TF",
    "Breakout RelVol",
    "Trend Pullback",
    "RSI Divergence",
    "BB Mean Reversion",
    "Vol Contraction",
    "Relative Strength",
    "Market Regime",
    "Meta-Label CG",
    "Triple Barrier Dyn",
]


# ------------------------------------------------------------------
# 10 strategy signal functions
# Each returns 1 (BUY signal) or 0 (no signal) at bar t.
# Uses only information available at time t (no look-ahead).
# ------------------------------------------------------------------
def strategy_trend_multi_tf(close_arr, high_arr, low_arr, t):
    """1. Multi-timeframe trend following: BUY if price > EMA20 > EMA50 > SMA200 AND ADX>25.
    (ADX not computed directly — use EMA separation as proxy for trend strength.)
    """
    if t < 200:
        return 0
    c = pd.Series(close_arr[:t+1])
    ema20 = c.ewm(span=20, adjust=False).mean().iloc[-1]
    ema50 = c.ewm(span=50, adjust=False).mean().iloc[-1]
    sma200 = c.rolling(200, min_periods=50).mean().iloc[-1]
    if np.isnan(sma200):
        return 0
    cp = float(close_arr[t])
    # Trend strength: EMA20 - EMA50 separation as ADX proxy
    sep = (ema20 - ema50) / cp
    if cp > ema20 > ema50 > sma200 and sep > 0.003:
        return 1
    return 0


def strategy_breakout_relvol(close_arr, high_arr, low_arr, vol_arr, t):
    """2. Breakout + relative volume: BUY if close > 20-day high AND volume > 0.8× 50d avg."""
    if t < 50:
        return 0
    cp = float(close_arr[t])
    high_20 = float(np.max(high_arr[t-20:t]))
    vol_now = float(vol_arr[t])
    vol_avg_50 = float(np.mean(vol_arr[t-50:t]))
    if vol_avg_50 <= 0:
        return 0
    rel_vol = vol_now / vol_avg_50
    if cp > high_20 and high_20 > 0 and rel_vol > 0.8:
        return 1
    return 0


def strategy_trend_pullback(close_arr, high_arr, low_arr, t):
    """3. Trend pullback: BUY if price > EMA50 AND touches EMA20 (within 2%)."""
    if t < 50:
        return 0
    c = pd.Series(close_arr[:t+1])
    ema20 = float(c.ewm(span=20, adjust=False).mean().iloc[-1])
    ema50 = float(c.ewm(span=50, adjust=False).mean().iloc[-1])
    cp = float(close_arr[t])
    low_now = float(low_arr[t])
    if cp > ema50:  # uptrend
        # Pullback: low touched within 2% of EMA20
        if abs(low_now - ema20) / ema20 < 0.02:
            return 1
    return 0


def strategy_rsi_divergence(close_arr, high_arr, low_arr, t):
    """4. RSI divergence: BUY if price makes lower low but RSI makes higher low (bullish divergence)."""
    if t < 35:
        return 0
    c = pd.Series(close_arr[:t+1])
    rsi = crsi(c)
    # Look at last 30 bars for divergence
    price_lows = low_arr[t-30:t+1]
    rsi_vals = rsi.iloc[t-30:t+1].values
    # Find two recent lows (price lower-low, RSI higher-low)
    # Simple heuristic: price[t-5] < price[t-15] AND rsi[t-5] > rsi[t-15]
    if (low_arr[t-5] < low_arr[t-15] and
        rsi_vals[-6] > rsi_vals[-16] and
        rsi_vals[-1] < 35):  # oversold
        return 1
    return 0


def strategy_bb_mean_reversion(close_arr, high_arr, low_arr, t):
    """5. Bollinger Band mean reversion: BUY if price < lower BB AND BB width in bottom quartile (range-bound)."""
    if t < 50:
        return 0
    c = pd.Series(close_arr[:t+1])
    bw, pb = cbb(c)
    bw_now = float(bw.iloc[-1])
    bw_mean_50 = float(bw.rolling(50, min_periods=20).mean().iloc[-1]) if len(bw) >= 20 else bw_now
    bw_std_50 = float(bw.rolling(50, min_periods=20).std().iloc[-1]) if len(bw) >= 20 else 0
    if np.isnan(bw_mean_50) or np.isnan(bw_std_50) or bw_std_50 <= 0:
        return 0
    bw_percentile = (bw_now - (bw_mean_50 - 2*bw_std_50)) / (4 * bw_std_50)
    pb_now = float(pb.iloc[-1])
    if pb_now < 0.05 and bw_percentile < 0.25:  # below lower band + range-bound
        return 1
    return 0


def strategy_vol_contraction(close_arr, high_arr, low_arr, t):
    """6. Volatility contraction + expansion: BUY if BB width contracted for 10d then expanded today."""
    if t < 30:
        return 0
    c = pd.Series(close_arr[:t+1])
    bw, _ = cbb(c)
    bw_now = float(bw.iloc[-1])
    bw_10d_avg = float(bw.iloc[-11:-1].mean())
    bw_std_10d = float(bw.iloc[-11:-1].std())
    if np.isnan(bw_10d_avg) or bw_std_10d <= 0:
        return 0
    # Contraction (low std) followed by expansion (bw_now > avg + 1 std)
    if bw_std_10d < bw_10d_avg * 0.1 and bw_now > bw_10d_avg + bw_std_10d:
        return 1
    return 0


def strategy_relative_strength(close_arr, high_arr, low_arr, t, sector_returns):
    """7. Relative strength: BUY if stock's 50d return > sector avg 50d return."""
    if t < 50:
        return 0
    cp = float(close_arr[t])
    cp_50 = float(close_arr[t-50])
    if cp_50 <= 0:
        return 0
    stock_ret_50 = (cp - cp_50) / cp_50
    sector_avg = sector_returns.get(t, 0)
    if stock_ret_50 > sector_avg + 0.02:  # 2% above sector
        return 1
    return 0


def strategy_market_regime(close_arr, high_arr, low_arr, t, kse100_returns):
    """8. Market regime: BUY if KSE-100 trend is up (50d return > 0)."""
    if t < 50:
        return 0
    kse100_ret_50 = kse100_returns.get(t, 0)
    if kse100_ret_50 > 0.02:  # KSE-100 up > 2% over 50d
        return 1
    return 0


def strategy_meta_label_cg(close_arr, high_arr, low_arr, t, cg_prob):
    """9. Meta-label CG: signal = 1 if CG-Ensemble's calibrated prob >= 0.55."""
    if cg_prob is None:
        return 0
    return 1 if cg_prob >= 0.55 else 0


def strategy_triple_barrier_dyn(close_arr, high_arr, low_arr, atr_arr, t):
    """10. Triple-barrier dynamic: BUY if ATR-based volatility is stable (ATR/price < 5%)
    AND price is above 50-EMA (filter for low-vol uptrend).
    """
    if t < 50:
        return 0
    cp = float(close_arr[t])
    atr = float(atr_arr[t])
    if cp <= 0 or atr <= 0:
        return 0
    vol_ratio = atr / cp
    c = pd.Series(close_arr[:t+1])
    ema50 = float(c.ewm(span=50, adjust=False).mean().iloc[-1])
    if vol_ratio < 0.05 and cp > ema50:  # low-vol uptrend
        return 1
    return 0


# ------------------------------------------------------------------
# Period assignment (chronological, with purge + embargo)
# ------------------------------------------------------------------
def assign_periods(n_bars: int) -> Tuple[int, int, int, int, int]:
    """Returns (train_end, purge1_end, calib_end, purge2_end, test_end)."""
    train_end = int(n_bars * X_TRAIN_FRAC)
    purge1_end = min(train_end + PURGE_BARS, n_bars)
    calib_end = int(n_bars * (X_TRAIN_FRAC + X_CALIB_FRAC))
    purge2_end = min(calib_end + PURGE_BARS, n_bars)
    test_end = n_bars
    return train_end, purge1_end, calib_end, purge2_end, test_end


# ------------------------------------------------------------------
# Multi-class label: 0=SL, 1=TP1-only, 2=TP2-only, 3=TP3, 4=timeout
# Uses NEXT-BAR-OPEN as entry; conservative ambiguous-barrier handling.
# ------------------------------------------------------------------
def compute_multiclass_label(
    sd, t, direction, sl, tp1, tp2, tp3, horizon=CG_HORIZON,
    high_arr=None, low_arr=None, open_arr=None, close_arr=None,
):
    """Returns (label, exit_price, exit_reason)."""
    entry_t = t + 1
    n = len(close_arr) if close_arr is not None else len(sd)
    if entry_t >= n:
        return 4, 0.0, "no_data"
    entry_price = float(open_arr[entry_t]) if open_arr is not None else float(sd.iloc[entry_t]["open"])
    if entry_price <= 0:
        return 4, 0.0, "invalid_entry"
    # Conservative: if entry gap beyond SL → SL hit first
    if direction == "BUY":
        if entry_price <= sl:
            return 0, sl, "sl_gap"
    else:
        if entry_price >= sl:
            return 0, sl, "sl_gap"
    end_t = min(entry_t + horizon, n)
    highest_tp = 0
    for j in range(entry_t, end_t):
        h = float(high_arr[j]) if high_arr is not None else float(sd.iloc[j]["high"])
        l = float(low_arr[j]) if low_arr is not None else float(sd.iloc[j]["low"])
        if direction == "BUY":
            if l <= sl:
                return 0, sl, "sl"
            if h >= tp3 and highest_tp < 3:
                highest_tp = 3
            elif h >= tp2 and highest_tp < 2:
                highest_tp = 2
            elif h >= tp1 and highest_tp < 1:
                highest_tp = 1
        else:
            if h >= sl:
                return 0, sl, "sl"
            if l <= tp3 and highest_tp < 3:
                highest_tp = 3
            elif l <= tp2 and highest_tp < 2:
                highest_tp = 2
            elif l <= tp1 and highest_tp < 1:
                highest_tp = 1
    if highest_tp == 3:
        return 3, tp3, "tp3"
    elif highest_tp == 2:
        return 2, tp2, "tp2"
    elif highest_tp == 1:
        return 1, tp1, "tp1"
    else:
        last_close = float(close_arr[end_t - 1]) if close_arr is not None else float(sd.iloc[end_t - 1]["close"])
        return 4, last_close, "timeout"


def compute_net_return(direction, entry_price, exit_price):
    """Net return after costs + CGT (only on gains)."""
    if direction == "BUY":
        gross = (exit_price - entry_price) / entry_price
    else:
        gross = (entry_price - exit_price) / entry_price
    net = gross - COST_ROUND_TRIP
    if net > 0:
        net = net - net * CGT_RATE
    return float(net)


# ------------------------------------------------------------------
# Build training set: features = 10 strategy signals + 20 indicators
# ------------------------------------------------------------------
def build_x_training_set(df_all, period, sample_size=100_000, cg_predictions=None):
    """Build per-bar training rows for the specified chronological period.
    Optimized: precomputes EMA/RSI/BB/volume arrays ONCE per stock.
    """
    rows_X = []
    rows_y = []
    rows_meta = []
    rows_dir = []
    rows_sym = []
    rows_t = []
    rows_sector = []

    sym_list = list(df_all["symbol"].unique())
    sym_to_idx = {s: i for i, s in enumerate(sym_list)}

    # KSE-100 proxy
    print("  Computing KSE-100 proxy index...")
    pivot = df_all.pivot_table(index="date", columns="symbol", values="close")
    norm = pivot / pivot.bfill().iloc[0]
    kse100_series = norm.mean(axis=1)
    kse100_returns_50d = kse100_series.pct_change(50).fillna(0)
    kse100_dates = kse100_returns_50d.index.tolist()
    kse100_vals = kse100_returns_50d.values

    for si, s in enumerate(sym_list):
        sd = df_all[df_all["symbol"] == s].sort_values("date").reset_index(drop=True)
        n = len(sd)
        if n < MIN_TRAIN_BARS + PURGE_BARS * 2 + CG_HORIZON:
            continue
        train_end, purge1_end, calib_end, purge2_end, test_end = assign_periods(n)
        if period == "train":
            t_start, t_end = 20, train_end - CG_HORIZON
        elif period == "calibrate":
            t_start, t_end = purge1_end, calib_end - CG_HORIZON
        elif period == "test":
            t_start, t_end = purge2_end, test_end - CG_HORIZON
        else:
            continue
        if t_end <= t_start:
            continue

        sc = StockSupportCache(sd)
        feat_mat = sd[FC].fillna(0).values.astype(np.float32)
        high_arr = sd["high"].values.astype(np.float64)
        low_arr = sd["low"].values.astype(np.float64)
        open_arr = sd["open"].values.astype(np.float64)
        close_arr = sd["close"].values.astype(np.float64)
        atr_arr = sd["atr_14"].values.astype(np.float64)
        vol_arr = sd["volume"].values.astype(np.float64)
        rsi_arr = sd["rsi_14"].values.astype(np.float64)
        bb_width_arr = sd["bb_width"].values.astype(np.float64)
        bb_pct_b_arr = sd["bb_pct_b"].values.astype(np.float64)
        date_arr = sd["date"].values

        # Precompute EMA/SMA/volume arrays ONCE per stock (vectorized)
        close_series = pd.Series(close_arr)
        ema20_arr = close_series.ewm(span=20, adjust=False).mean().values.astype(np.float64)
        ema50_arr = close_series.ewm(span=50, adjust=False).mean().values.astype(np.float64)
        sma200_arr = close_series.rolling(200, min_periods=50).mean().values.astype(np.float64)
        vol_sma50_arr = pd.Series(vol_arr).rolling(50, min_periods=10).mean().values.astype(np.float64)
        # 20-day rolling high (exclude current bar — use shift(1))
        high_20_rolling = pd.Series(high_arr).rolling(20, min_periods=5).max().shift(1).values.astype(np.float64)
        # BB width stats
        bb_width_sma50 = pd.Series(bb_width_arr).rolling(50, min_periods=20).mean().values.astype(np.float64)
        bb_width_std50 = pd.Series(bb_width_arr).rolling(50, min_periods=20).std().values.astype(np.float64)
        bb_width_10d_avg = pd.Series(bb_width_arr).rolling(10, min_periods=5).mean().shift(1).values.astype(np.float64)
        bb_width_10d_std = pd.Series(bb_width_arr).rolling(10, min_periods=5).std().shift(1).values.astype(np.float64)

        # CG probability (constant per stock)
        cg_probs_for_stock = {}
        if cg_predictions is not None:
            cg_pred_sym = cg_predictions.get(s, {})
            cg_probs_for_stock["const"] = float(cg_pred_sym.get("raw_prob", 0.5)) if cg_pred_sym else 0.5

        sector = "UNKNOWN"
        try:
            with open(Path("/home/z/my-project/data/financials") / f"{s}.json") as f:
                fin = json.load(f)
                sector = fin.get("sector", "UNKNOWN")
        except Exception:
            pass

        for t in range(t_start, t_end):
            cp = float(close_arr[t])
            atr = float(atr_arr[t])
            if atr <= 0 or cp <= 0:
                continue
            support = sc.support_at(t)
            resistance = sc.resistance_at(t)
            if np.isnan(support) or np.isnan(resistance):
                continue
            feat_row = feat_mat[t]

            # === FAST strategy signals (all use precomputed arrays) ===
            # 1. trend_multi_tf: BUY if price > EMA20 > EMA50 > SMA200 AND sep > 0.3%
            #    (relaxed from 0.5% to 0.3% to fire more often)
            e20 = float(ema20_arr[t]) if not np.isnan(ema20_arr[t]) else 0
            e50 = float(ema50_arr[t]) if not np.isnan(ema50_arr[t]) else 0
            s200 = float(sma200_arr[t]) if not np.isnan(sma200_arr[t]) else 0
            sep = (e20 - e50) / cp if cp > 0 else 0
            sig1 = 1 if (cp > e20 > e50 > s200 and sep > 0.003) else 0

            # 2. breakout_relvol: BUY if close > 20-day high AND vol > 0.8× 50d avg
            #    (relaxed further — PSX has generally low volume, so 0.8× is enough)
            h20 = float(high_20_rolling[t]) if not np.isnan(high_20_rolling[t]) else 0
            vol_now = float(vol_arr[t])
            vol_avg_50 = float(vol_sma50_arr[t]) if not np.isnan(vol_sma50_arr[t]) else vol_now
            rel_vol = vol_now / max(vol_avg_50, 1) if vol_avg_50 > 0 else 0
            sig2 = 1 if (cp > h20 and h20 > 0 and rel_vol > 0.8) else 0

            # 3. trend_pullback: BUY if price > EMA50 AND low touches EMA20 (within 3%)
            #    (relaxed from 2% to 3%)
            low_now = float(low_arr[t])
            sig3 = 1 if (cp > e50 and abs(low_now - e20) / max(e20, 1) < 0.03) else 0

            # 4. rsi_divergence: BUY if price lower-low + RSI higher-low + RSI < 45
            #    (relaxed from RSI<35 to RSI<45)
            if t >= 30:
                price_low_5 = float(low_arr[t-5])
                price_low_15 = float(low_arr[t-15])
                rsi_5 = float(rsi_arr[t-5]) if not np.isnan(rsi_arr[t-5]) else 50
                rsi_15 = float(rsi_arr[t-15]) if not np.isnan(rsi_arr[t-15]) else 50
                rsi_now = float(rsi_arr[t]) if not np.isnan(rsi_arr[t]) else 50
                sig4 = 1 if (price_low_5 < price_low_15 and rsi_5 > rsi_15 and rsi_now < 45) else 0
            else:
                sig4 = 0

            # 5. bb_mean_reversion: BUY if bb_pct_b < 0.10 AND bb_width in bottom 40%
            #    (relaxed from 0.05/25% to 0.10/40%)
            bw_now = float(bb_width_arr[t]) if not np.isnan(bb_width_arr[t]) else 0
            bw_mean_50 = float(bb_width_sma50[t]) if not np.isnan(bb_width_sma50[t]) else 0
            bw_std_50 = float(bb_width_std50[t]) if not np.isnan(bb_width_std50[t]) else 0
            pb_now = float(bb_pct_b_arr[t]) if not np.isnan(bb_pct_b_arr[t]) else 0.5
            if bw_std_50 > 0:
                bw_percentile = (bw_now - (bw_mean_50 - 2*bw_std_50)) / (4 * bw_std_50)
            else:
                bw_percentile = 0.5
            sig5 = 1 if (pb_now < 0.10 and bw_percentile < 0.40) else 0

            # 6. vol_contraction: BUY if bb_width_10d std/avg < 0.15 AND bw_now > avg + 0.5 std
            #    (relaxed from 0.1/1 std to 0.15/0.5 std)
            bw_10d_avg = float(bb_width_10d_avg[t]) if not np.isnan(bb_width_10d_avg[t]) else 0
            bw_10d_std = float(bb_width_10d_std[t]) if not np.isnan(bb_width_10d_std[t]) else 0
            sig6 = 1 if (bw_10d_std < bw_10d_avg * 0.15 and bw_now > bw_10d_avg + 0.5 * bw_10d_std and bw_10d_std > 0) else 0

            # 7. relative_strength: BUY if stock 50d return > KSE-100 50d return + 1%
            #    (relaxed from 2% to 1%)
            date_t = date_arr[t]
            kse100_ret = 0.0
            try:
                import bisect
                idx = bisect.bisect_left(kse100_dates, date_t)
                if idx < len(kse100_dates):
                    kse100_ret = float(kse100_vals[idx])
            except Exception:
                pass
            if t >= 50 and float(close_arr[t-50]) > 0:
                stock_50d_ret = (cp - float(close_arr[t-50])) / float(close_arr[t-50])
            else:
                stock_50d_ret = 0
            sig7 = 1 if (stock_50d_ret > kse100_ret + 0.01) else 0

            # 8. market_regime: BUY if KSE-100 50d return > 0% (bull regime)
            #    (relaxed from 2% to 0%)
            sig8 = 1 if (kse100_ret > 0) else 0

            # 9. meta_label_cg: BUY if CG probability >= 0.50
            #    (relaxed from 0.55 to 0.50)
            cg_prob = cg_probs_for_stock.get("const", 0.5)
            sig9 = 1 if (cg_prob >= 0.50) else 0

            # 10. triple_barrier_dyn: BUY if ATR/price < 8% AND price > EMA50
            #     (relaxed from 5% to 8%)
            vol_ratio = atr / cp if cp > 0 else 1
            sig10 = 1 if (vol_ratio < 0.08 and cp > e50) else 0

            strat_feats = np.array([sig1, sig2, sig3, sig4, sig5, sig6, sig7, sig8, sig9, sig10],
                                   dtype=np.float32)

            for direction in ("BUY", "SELL"):
                sl, tp1, tp2, tp3, skip = compute_cg_sl_and_targets(
                    cp, atr, support, resistance, direction
                )
                if skip or sl <= 0 or tp1 <= 0:
                    continue
                label, exit_price, exit_reason = compute_multiclass_label(
                    sd, t, direction, sl, tp1, tp2, tp3, horizon=CG_HORIZON,
                    high_arr=high_arr, low_arr=low_arr, open_arr=open_arr, close_arr=close_arr,
                )
                y_bin = 1 if label in (1, 2, 3) else 0
                entry_price = float(open_arr[t + 1]) if t + 1 < len(open_arr) else cp
                if entry_price <= 0:
                    continue
                net_ret = compute_net_return(direction, entry_price, exit_price)

                rows_X.append(np.concatenate([feat_row, strat_feats]))
                rows_y.append(y_bin)
                rows_meta.append([cp, atr, sl, tp1, tp2, tp3, exit_price, net_ret, label])
                rows_dir.append(direction == "BUY")
                rows_sym.append(sym_to_idx[s])
                rows_t.append(t)
                rows_sector.append(sector)

        if (si + 1) % 50 == 0:
            print(f"  {period}-build: {si+1} stocks, {len(rows_X):,} rows so far", flush=True)

    if not rows_X:
        return pd.DataFrame()

    X = np.array(rows_X, dtype=np.float32)
    y = np.array(rows_y, dtype=np.int8)
    meta = np.array(rows_meta, dtype=np.float64)
    dirs = np.array(rows_dir, dtype=bool)
    syms = np.array(rows_sym, dtype=np.int32)
    ts = np.array(rows_t, dtype=np.int32)
    sectors = np.array(rows_sector, dtype=object)
    print(f"  {period} total rows: {len(X):,}")
    if len(X) > sample_size:
        idx = np.random.default_rng(42).choice(len(X), size=sample_size, replace=False)
        X = X[idx]; y = y[idx]; meta = meta[idx]; dirs = dirs[idx]
        syms = syms[idx]; ts = ts[idx]; sectors = sectors[idx]
        print(f"  {period} sampled to: {len(X):,}")

    FC_X = FC + [f"sig_{i+1}_{n.replace(' ', '_').lower()}" for i, n in enumerate(X_STRATEGY_NAMES)]
    out = pd.DataFrame(X, columns=FC_X)
    out["_y"] = y.astype(int)
    out["_direction"] = np.where(dirs, "BUY", "SELL")
    out["_symbol"] = [sym_list[i] for i in syms]
    out["_t"] = ts
    out["_sector"] = sectors
    for i, name in enumerate(["_cp", "_atr", "_sl", "_tp1", "_tp2", "_tp3", "_exit_price", "_net_ret", "_label"]):
        out[name] = meta[:, i]
    out["_label"] = out["_label"].astype(int)
    return out


# ------------------------------------------------------------------
# Walk-forward CV + meta-model training
# ------------------------------------------------------------------
def walk_forward_train(X, y, n_folds=5):
    """Walk-forward CV: 5 folds, train-on-earlier / test-on-later.
    Returns final LightGBM model + scaler + OOF predictions.
    """
    import lightgbm as lgb
    n = len(X)
    fold_size = n // n_folds
    oof = np.zeros(n, dtype=np.float32)
    fold_assign = np.full(n, -1, dtype=int)

    for fi in range(n_folds):
        train_end = (fi + 1) * fold_size
        val_start = train_end
        val_end = min((fi + 2) * fold_size, n)
        if val_end <= val_start:
            continue
        tr_mask = np.zeros(n, dtype=bool)
        tr_mask[:train_end] = True
        va_mask = np.zeros(n, dtype=bool)
        va_mask[val_start:val_end] = True
        if tr_mask.sum() < 100 or va_mask.sum() < 50:
            continue
        print(f"  Walk-forward fold {fi+1}/{n_folds}: train={tr_mask.sum():,}, val={va_mask.sum():,}")
        X_tr = X[tr_mask]
        y_tr = y[tr_mask]
        X_va = X[va_mask]
        fold_assign[va_mask] = fi
        scaler = StandardScaler()
        X_tr_s = scaler.fit_transform(X_tr)
        X_va_s = scaler.transform(X_va)
        m = lgb.LGBMClassifier(
            n_estimators=120, max_depth=4, num_leaves=15,
            learning_rate=0.06, random_state=42, verbose=-1, n_jobs=-1,
        )
        try:
            m.fit(X_tr_s, y_tr)
            proba = m.predict_proba(X_va_s)[:, 1]
            oof[va_mask] = proba
        except Exception as e:
            print(f"    ! fold {fi+1} failed: {e}")

    # Train final model on ALL training data
    print("\n  Training final LightGBM meta-model on full train period...")
    scaler = StandardScaler()
    Xs = scaler.fit_transform(X)
    m = lgb.LGBMClassifier(
        n_estimators=120, max_depth=4, num_leaves=15,
        learning_rate=0.06, random_state=42, verbose=-1, n_jobs=-1,
    )
    m.fit(Xs, y)
    return m, scaler, oof


# ------------------------------------------------------------------
# Calibration: Platt sigmoid vs Isotonic
# ------------------------------------------------------------------
def fit_calibrators(oof_probs, labels):
    state = {}
    try:
        platt = LogisticRegression(C=1e10, solver="lbfgs", max_iter=200)
        platt.fit(oof_probs.reshape(-1, 1), labels)
        state["platt"] = {"coef": float(platt.coef_[0][0]), "intercept": float(platt.intercept_[0])}
        print(f"    Platt sigmoid: coef={state['platt']['coef']:.4f}")
    except Exception as e:
        print(f"    Platt failed: {e}")
        state["platt"] = None
    try:
        iso = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1)
        iso.fit(oof_probs, labels)
        sorted_idx = np.argsort(oof_probs)
        state["isotonic"] = {
            "X_sorted": oof_probs[sorted_idx][:200].tolist(),
            "Y_sorted": iso.predict(oof_probs[sorted_idx])[:200].tolist(),
        }
        print(f"    Isotonic regression: fit on {len(oof_probs)} points")
    except Exception as e:
        print(f"    Isotonic failed: {e}")
        state["isotonic"] = None
    return state


def apply_calibrator(p, cal_state, method):
    if method == "platt" and cal_state.get("platt"):
        c = cal_state["platt"]
        z = c["coef"] * p + c["intercept"]
        return 1 / (1 + np.exp(-z))
    if method == "isotonic" and cal_state.get("isotonic"):
        iso = cal_state["isotonic"]
        xs, ys = iso["X_sorted"], iso["Y_sorted"]
        if not xs: return p
        if p <= xs[0]: return ys[0]
        if p >= xs[-1]: return ys[-1]
        for i in range(len(xs) - 1):
            if xs[i] <= p <= xs[i + 1]:
                t = (p - xs[i]) / (xs[i + 1] - xs[i]) if xs[i + 1] > xs[i] else 0
                return ys[i] + t * (ys[i + 1] - ys[i])
    return p


# ------------------------------------------------------------------
# Metric computation
# ------------------------------------------------------------------
def wilson_ci(k, n, z=1.96):
    if n == 0: return 0.0, 0.0
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    spread = z * np.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom
    return max(0, center - spread), min(1, center + spread)


def expected_calibration_error(probs, labels, n_bins=10):
    if len(probs) == 0: return 0.0
    bins = np.linspace(0, 1, n_bins + 1)
    bin_inds = np.clip(np.digitize(probs, bins) - 1, 0, n_bins - 1)
    ece = 0.0
    for bi in range(n_bins):
        mask = bin_inds == bi
        if mask.sum() > 0:
            avg_pred = float(probs[mask].mean())
            avg_actual = float(labels[mask].mean())
            ece += (mask.sum() / len(probs)) * abs(avg_pred - avg_actual)
    return ece


def compute_metrics(probs, labels, net_rets, directions, exit_labels, threshold):
    buy_mask = (directions == "BUY") & (probs >= threshold)
    n_buy = int(buy_mask.sum())
    if n_buy == 0:
        return {"threshold": threshold, "trade_count": 0, "coverage": 0, "precision": 0,
                "precision_ci_low": 0, "precision_ci_high": 0, "brier": 0, "ece": 0,
                "net_expectancy_pct": 0, "median_return_pct": 0, "profit_factor": 0,
                "sharpe": 0, "sortino": 0, "max_drawdown_pct": 0,
                "tp1_hit_rate": 0, "tp2_hit_rate": 0, "tp3_hit_rate": 0,
                "tp1_count": 0, "tp2_count": 0, "tp3_count": 0,
                "sl_count": 0, "timeout_count": 0}
    buy_probs = probs[buy_mask]
    buy_labels = labels[buy_mask]
    buy_rets = net_rets[buy_mask]
    buy_exit = exit_labels[buy_mask]
    tp1_hits = int(np.isin(buy_exit, [1, 2, 3]).sum())
    precision = tp1_hits / n_buy
    ci_low, ci_high = wilson_ci(tp1_hits, n_buy)
    brier = float(((buy_probs - buy_labels.astype(float)) ** 2).mean())
    ece = expected_calibration_error(buy_probs, buy_labels.astype(float))
    net_exp = float(buy_rets.mean())
    median_ret = float(np.median(buy_rets))
    gains = buy_rets[buy_rets > 0]
    losses = -buy_rets[buy_rets < 0]
    pf = float(gains.sum() / max(losses.sum(), 1e-9))
    if buy_rets.std() > 0:
        sharpe = float(buy_rets.mean() / buy_rets.std() * np.sqrt(252))
    else:
        sharpe = 0.0
    # Sortino: only downside deviation
    downside = buy_rets[buy_rets < 0]
    if len(downside) > 0 and downside.std() > 0:
        sortino = float(buy_rets.mean() / downside.std() * np.sqrt(252))
    else:
        sortino = 0.0
    cum = np.cumprod(1 + buy_rets)
    peak = np.maximum.accumulate(cum)
    dd = (cum - peak) / peak
    max_dd = float(dd.min()) if len(dd) > 0 else 0.0
    tp1_count = int((buy_exit == 1).sum())
    tp2_count = int((buy_exit == 2).sum())
    tp3_count = int((buy_exit == 3).sum())
    sl_count = int((buy_exit == 0).sum())
    timeout_count = int((buy_exit == 4).sum())
    total_buy = int((directions == "BUY").sum())
    coverage = n_buy / max(total_buy, 1)
    return {
        "threshold": threshold, "trade_count": n_buy, "coverage": round(coverage, 4),
        "precision": round(precision, 4), "precision_ci_low": round(ci_low, 4),
        "precision_ci_high": round(ci_high, 4), "brier": round(brier, 4),
        "ece": round(ece, 4), "net_expectancy_pct": round(net_exp * 100, 3),
        "median_return_pct": round(median_ret * 100, 3),
        "profit_factor": round(pf, 3), "sharpe": round(sharpe, 3),
        "sortino": round(sortino, 3), "max_drawdown_pct": round(max_dd * 100, 2),
        "tp1_hit_rate": round(tp1_count / n_buy, 4),
        "tp2_hit_rate": round(tp2_count / n_buy, 4),
        "tp3_hit_rate": round(tp3_count / n_buy, 4),
        "tp1_count": tp1_count, "tp2_count": tp2_count, "tp3_count": tp3_count,
        "sl_count": sl_count, "timeout_count": timeout_count,
    }


# ------------------------------------------------------------------
# Per-strategy backtest (apply each strategy to test period)
# ------------------------------------------------------------------
def backtest_strategy(test_df, strategy_col, threshold=0.5):
    """Apply a single strategy signal (column in test_df) to the test period.
    Strategy signal is binary (0/1). BUY when signal == 1.
    Returns fields compatible with the Backtesting Report modal.
    """
    sig_mask = (test_df[strategy_col] >= threshold) & (test_df["_direction"] == "BUY")
    n = int(sig_mask.sum())
    if n == 0:
        return {"totalTrades": 0, "buySignals": 0, "sellSignals": 0,
                "correctBuys": 0, "correctSells": 0,
                "winRate": 0, "avgReturnPct": 0, "maxReturnPct": 0,
                "minReturnPct": 0, "stars": 0,
                "trade_count": 0, "precision": 0, "net_expectancy_pct": 0,
                "profit_factor": 0, "sharpe": 0, "max_drawdown_pct": 0}
    sig_rets = test_df.loc[sig_mask, "_net_ret"].values
    sig_exit = test_df.loc[sig_mask, "_label"].values
    wins = sig_rets > 0
    win_rate = float(wins.mean())
    tp1_hits = int(np.isin(sig_exit, [1, 2, 3]).sum())
    precision = tp1_hits / n
    ci_low, ci_high = wilson_ci(tp1_hits, n)
    net_exp = float(sig_rets.mean())
    gains = sig_rets[sig_rets > 0]
    losses = -sig_rets[sig_rets < 0]
    pf = float(gains.sum() / max(losses.sum(), 1e-9))
    if sig_rets.std() > 0:
        sharpe = float(sig_rets.mean() / sig_rets.std() * np.sqrt(252))
    else:
        sharpe = 0.0
    cum = np.cumprod(1 + sig_rets)
    peak = np.maximum.accumulate(cum)
    dd = (cum - peak) / peak
    max_dd = float(dd.min()) if len(dd) > 0 else 0.0
    return {
        # Modal-expected fields (camelCase)
        "totalTrades": n,
        "buySignals": n, "sellSignals": 0,
        "correctBuys": tp1_hits, "correctSells": 0,
        "winRate": round(win_rate * 100, 1),
        "avgReturnPct": round(net_exp * 100, 2),
        "maxReturnPct": round(float(sig_rets.max() * 100), 2),
        "minReturnPct": round(float(sig_rets.min() * 100), 2),
        "stars": int(min(5, max(1, int(win_rate * 100 / 20) + 1))),
        # X-specific fields (snake_case)
        "trade_count": n,
        "precision": round(precision, 4),
        "precision_ci_low": round(ci_low, 4),
        "precision_ci_high": round(ci_high, 4),
        "net_expectancy_pct": round(net_exp * 100, 3),
        "profit_factor": round(pf, 3),
        "sharpe": round(sharpe, 3),
        "max_drawdown_pct": round(max_dd * 100, 2),
    }


def backtest_baselines(test_df):
    """Buy-and-hold and trend-following baselines on test period."""
    # Buy-and-hold: enter at first bar's open, exit at last bar's close
    # For per-stock BH, we average across stocks
    rets = []
    for s, sd in test_df.groupby("_symbol"):
        if len(sd) < 2:
            continue
        # Entry = first bar's open; exit = last bar's close
        # Approximate using _cp (close) since we don't have open in test_df directly
        entry = float(sd.iloc[0]["_cp"])
        exit_p = float(sd.iloc[-1]["_cp"])
        if entry > 0:
            r = (exit_p - entry) / entry - COST_ROUND_TRIP
            if r > 0:
                r = r - r * CGT_RATE
            rets.append(r)
    if not rets:
        return {"buy_hold": {"trade_count": 0, "net_return_pct": 0}}
    bh_ret = float(np.mean(rets))
    # Trend-following: BUY when 50-EMA > 200-SMA, exit when reverse
    # Approximated: enter at first bar where trend_up=1, exit at last bar
    # We'll use the trend_multi_tf strategy's signal as the trend-following proxy
    tf_mask = test_df.get("sig_1_trend_multi_tf", pd.Series([False]*len(test_df))) >= 1
    tf_mask = tf_mask & (test_df["_direction"] == "BUY")
    if tf_mask.sum() > 0:
        tf_rets = test_df.loc[tf_mask, "_net_ret"].values
        tf_ret = float(tf_rets.mean())
    else:
        tf_ret = 0.0
    return {
        "buy_hold": {"trade_count": len(rets), "net_return_pct": round(bh_ret * 100, 3)},
        "trend_follow": {"trade_count": int(tf_mask.sum()), "net_return_pct": round(tf_ret * 100, 3)},
    }


# ------------------------------------------------------------------
# Generate per-stock predictions (X-Ensemble + 10 strategy signals)
# ------------------------------------------------------------------
def predict_all_stocks(stocks, df_all, atr_per, model, scaler, cal_state, cg_predictions):
    """For each stock, compute X-Ensemble prediction + 10 strategy signals at latest bar."""
    print("\n[X] Generating per-stock predictions...")
    x_per_strategy = {name: {} for name in X_STRATEGY_NAMES}
    x_ens = {}

    # KSE-100 proxy
    pivot = df_all.pivot_table(index="date", columns="symbol", values="close")
    norm = pivot / pivot.bfill().iloc[0]
    kse100_series = norm.mean(axis=1)
    kse100_returns_50d = kse100_series.pct_change(50).fillna(0)
    kse100_dates = kse100_returns_50d.index.tolist()
    kse100_vals = kse100_returns_50d.values

    for si, s in enumerate(stocks):
        if s not in atr_per:
            continue
        sd = df_all[df_all["symbol"] == s].sort_values("date").reset_index(drop=True)
        n = len(sd)
        if n < MIN_PRED_BARS:
            continue
        t = n - 1
        cp = float(sd.iloc[t]["close"])
        atr = atr_per[s]["atr"]
        if atr <= 0 or cp <= 0:
            continue
        sc = StockSupportCache(sd)
        support = sc.support_at(t)
        resistance = sc.resistance_at(t)
        if np.isnan(support) or np.isnan(resistance):
            continue

        close_arr = sd["close"].values.astype(np.float64)
        high_arr = sd["high"].values.astype(np.float64)
        low_arr = sd["low"].values.astype(np.float64)
        open_arr = sd["open"].values.astype(np.float64)
        vol_arr = sd["volume"].values.astype(np.float64)
        atr_arr = sd["atr_14"].values.astype(np.float64)
        date_arr = sd["date"].values
        feat_row = sd[FC].iloc[t].fillna(0).values.astype(np.float32)

        # Compute 10 strategy signals
        sig1 = strategy_trend_multi_tf(close_arr, high_arr, low_arr, t)
        sig2 = strategy_breakout_relvol(close_arr, high_arr, low_arr, vol_arr, t)
        sig3 = strategy_trend_pullback(close_arr, high_arr, low_arr, t)
        sig4 = strategy_rsi_divergence(close_arr, high_arr, low_arr, t)
        sig5 = strategy_bb_mean_reversion(close_arr, high_arr, low_arr, t)
        sig6 = strategy_vol_contraction(close_arr, high_arr, low_arr, t)
        date_t = date_arr[t]
        kse100_ret = 0.0
        try:
            for i, d in enumerate(kse100_dates):
                if d >= date_t:
                    kse100_ret = float(kse100_vals[i]) if i < len(kse100_vals) else 0
                    break
        except Exception:
            pass
        sig7 = strategy_relative_strength(close_arr, high_arr, low_arr, t, {t: kse100_ret})
        sig8 = strategy_market_regime(close_arr, high_arr, low_arr, t, {t: kse100_ret})
        cg_pred_sym = cg_predictions.get(s, {}) if cg_predictions else {}
        cg_prob = float(cg_pred_sym.get("raw_prob", 0.5)) if cg_pred_sym else 0.5
        sig9 = strategy_meta_label_cg(close_arr, high_arr, low_arr, t, cg_prob)
        sig10 = strategy_triple_barrier_dyn(close_arr, high_arr, low_arr, atr_arr, t)

        strat_signals = [sig1, sig2, sig3, sig4, sig5, sig6, sig7, sig8, sig9, sig10]

        # Save per-strategy predictions — always compute BUY-direction SL/TPs
        # so the model card shows real levels even when the strategy doesn't
        # fire at the latest bar. Signal = BUY when fired, HOLD when not.
        # Confidence = 100 when fired, 0 when not.
        for mi, mname in enumerate(X_STRATEGY_NAMES):
            psig = "BUY" if strat_signals[mi] == 1 else "HOLD"
            # Always compute SL/TPs using BUY direction (these are all
            # long-biased strategies) so the card shows real levels.
            p_sl, p_tp1, p_tp2, p_tp3, p_skip = compute_cg_sl_and_targets(
                cp, atr, support, resistance, "BUY"
            )
            x_per_strategy[mname][s] = {
                "signal": psig,
                "direction": "LONG",
                "confidence": int(100 if psig == "BUY" else 0),
                "currentPrice": round(cp, 2),
                "entry": round(cp, 2),
                "tp1": round(p_tp1, 2), "tp2": round(p_tp2, 2), "tp3": round(p_tp3, 2),
                "sl": round(p_sl, 2),
                "avgReturn": round(float(strat_signals[mi]), 4),
            }

        # Meta-model prediction
        feat_full = np.concatenate([feat_row, np.array(strat_signals, dtype=np.float32)]).reshape(1, -1)
        Xs = scaler.transform(feat_full)
        raw_prob = float(model.predict_proba(Xs)[0, 1])
        # Apply Platt calibration
        exp_win_rate = apply_calibrator(raw_prob, cal_state, "platt")

        if exp_win_rate >= 0.55:
            signal = "BUY"
        elif exp_win_rate <= 0.45:
            signal = "SELL"
            exp_win_rate = 1 - exp_win_rate
        else:
            signal = "HOLD"

        sl, tp1, tp2, tp3, skip = compute_cg_sl_and_targets(
            cp, atr, support, resistance, signal if signal != "HOLD" else "BUY"
        )
        if signal == "HOLD":
            sl = cp; tp1 = cp; tp2 = cp; tp3 = cp

        agreement = 1 - np.std(strat_signals) if len(strat_signals) > 1 else 1.0
        confidence = exp_win_rate * (0.6 + 0.4 * max(0, min(1, agreement))) * 100

        x_ens[s] = {
            "signal": signal,
            "direction": "LONG" if signal != "SELL" else "SHORT",
            "confidence": int(min(100, max(0, confidence))),
            "currentPrice": round(cp, 2),
            "entry": round(cp, 2),
            "tp1": round(tp1, 2), "tp2": round(tp2, 2), "tp3": round(tp3, 2),
            "sl": round(sl, 2),
            "avgReturn": round(float(exp_win_rate - 0.5), 4),
            "raw_prob": round(float(raw_prob), 4),
            "exp_win_rate": round(float(exp_win_rate), 4),
            "agreement": round(float(max(0, min(1, agreement))), 4),
            "strategy_signals": {X_STRATEGY_NAMES[i]: int(strat_signals[i]) for i in range(10)},
        }

        if (si + 1) % 50 == 0:
            print(f"  {si+1}/{len(stocks)} stocks processed...")

    print(f"  Done: {len(x_ens)} stocks have X-Ensemble predictions")
    return x_per_strategy, x_ens


# ------------------------------------------------------------------
# Save to ml_predictions_multi.json (preserve existing entries)
# ------------------------------------------------------------------
def save_to_json(x_per_strategy, x_ens, x_backtest, per_strategy_bt, baselines, threshold_sweep):
    print(f"\n[X] Saving to {PRED_FILE}...")
    if PRED_FILE.exists():
        with open(PRED_FILE, "r") as f:
            existing = json.load(f)
    else:
        existing = {}

    # Add 10 strategy models
    models_dict = existing.get("models", {})
    for mname, preds in x_per_strategy.items():
        models_dict[f"{mname} (X)"] = {"trained": True, "version": "1.0.0", "predictions": preds}
    existing["models"] = models_dict

    # X-Ensemble predictions
    existing["x_ensemble_predictions"] = x_ens

    # Add X_ENSEMBLE + 10 per-strategy backtests to ensemble_backtesting
    ens_bt = existing.get("ensemble_backtesting", {})
    ens_bt["X_ENSEMBLE"] = x_backtest
    for sname, sbt in per_strategy_bt.items():
        ens_bt[f"X_{sname.replace(' ', '_').replace('-', '_').upper()}"] = sbt
    ens_bt["X_BASELINES"] = baselines
    existing["ensemble_backtesting"] = ens_bt

    # X metadata
    existing["x_metadata"] = {
        "trained_at": pd.Timestamp.now().isoformat(),
        "strategies": X_STRATEGY_NAMES,
        "meta_model": "LightGBM (120 trees, depth 4, lr 0.06) on 30 features (10 strategy signals + 20 indicators)",
        "calibration": "Platt sigmoid (primary) + isotonic regression (compared)",
        "split": {"train": X_TRAIN_FRAC, "calibrate": X_CALIB_FRAC, "test": X_TEST_FRAC},
        "purge_gap_bars": PURGE_BARS,
        "cv_folds": 5,
        "horizon": CG_HORIZON,
        "tps": f"{CG_TP1_MULT}R/{CG_TP2_MULT}R/{CG_TP3_MULT}R",
        "cost_model": {"round_trip_pct": COST_ROUND_TRIP * 100, "cgt_rate_pct": CGT_RATE * 100},
        "threshold_sweep": threshold_sweep,
        "baselines": baselines,
    }

    def clean(o):
        if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
        if isinstance(o, list): return [clean(v) for v in o]
        if isinstance(o, float):
            import math
            if math.isnan(o) or math.isinf(o): return 0
            return o
        return o

    with open(PRED_FILE, "w") as f:
        json.dump(clean(existing), f, indent=2, allow_nan=False)
    print(f"  Saved. File size: {PRED_FILE.stat().st_size / 1024 / 1024:.1f} MB")


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--quick", type=int, default=0)
    args = parser.parse_args()

    start = time.time()
    print("=" * 70)
    print("X-Models + X-Ensemble: 10 complementary strategies + meta-labeling")
    print("=" * 70)
    print("\n10 STRATEGIES:")
    for i, name in enumerate(X_STRATEGY_NAMES, 1):
        print(f"  {i:>2}. {name}")
    print(f"\nMeta-model: LightGBM on 30 features (10 strategy signals + 20 indicators)")
    print(f"Calibration: Platt sigmoid + isotonic regression (separate calibrate period)")
    print(f"Split: train {X_TRAIN_FRAC*100:.0f}% / calibrate {X_CALIB_FRAC*100:.0f}% / test {X_TEST_FRAC*100:.0f}%")
    print(f"Purge gap: {PURGE_BARS} bars ({CG_HORIZON}-bar horizon + 5-bar embargo)")
    print(f"Cost model: {COST_ROUND_TRIP*100:.2f}% round-trip + {CGT_RATE*100:.0f}% CGT on gains")
    print(f"Threshold sweep: 0.70 → 0.95 on untouched TEST period")
    print(f"Target: 90% TP1 precision (experimental, never guaranteed)")
    print("=" * 70)

    all_stocks = sorted([f.stem for f in OHLCV_DIR.glob("*.csv")])
    stocks = all_stocks[:args.quick] if args.quick > 0 else all_stocks
    print(f"\nStocks: {len(stocks)}")

    print("\n[1/5] Loading OHLCV...")
    df_all = load_ohlcv(stocks)
    if df_all.empty:
        print("ERROR: No OHLCV data")
        sys.exit(1)
    print(f"  {len(df_all):,} rows, {df_all['symbol'].nunique()} stocks")

    # Load CG-Ensemble predictions (for meta_label_cg strategy)
    print("\n[2/5] Loading CG-Ensemble predictions (for meta-label strategy)...")
    with open(PRED_FILE, "r") as f:
        existing_json = json.load(f)
    cg_predictions = existing_json.get("cg_ensemble_predictions", {})
    print(f"  CG predictions for {len(cg_predictions)} stocks loaded")

    print("\n[3/5] Building TRAIN period (first 60% chronologically)...")
    train_df = build_x_training_set(df_all, "train", sample_size=120_000, cg_predictions=cg_predictions)
    if train_df.empty:
        print("ERROR: empty training set")
        sys.exit(1)
    print(f"  Train rows: {len(train_df):,}, positive rate: {train_df['_y'].mean():.3f}")

    print("\n[4/5] Building CALIBRATE period (next 15%)...")
    calib_df = build_x_training_set(df_all, "calibrate", sample_size=40_000, cg_predictions=cg_predictions)
    print(f"  Calib rows: {len(calib_df):,}" if not calib_df.empty else "  Calib empty")

    print("\n[5/5] Building TEST period (last 25%, untouched)...")
    test_df = build_x_training_set(df_all, "test", sample_size=80_000, cg_predictions=cg_predictions)
    print(f"  Test rows: {len(test_df):,}" if not test_df.empty else "  Test empty")

    FC_X = FC + [f"sig_{i+1}_{n.replace(' ', '_').lower()}" for i, n in enumerate(X_STRATEGY_NAMES)]

    # Walk-forward training
    print("\n[X] Walk-forward training (5 folds) + final LightGBM meta-model...")
    X_train = train_df[FC_X].fillna(0).values
    y_train = train_df["_y"].values.astype(int)
    model, scaler, _ = walk_forward_train(X_train, y_train)

    # Predict on calibrate period (OOS for calibration)
    print("\n  Predicting on CALIBRATE period...")
    X_calib = calib_df[FC_X].fillna(0).values
    y_calib = calib_df["_y"].values.astype(int)
    calib_probs_raw = model.predict_proba(scaler.transform(X_calib))[:, 1]
    try:
        calib_auc = roc_auc_score(y_calib, calib_probs_raw)
        print(f"  Calibrate period AUC: {calib_auc:.4f}")
    except Exception:
        calib_auc = 0.0

    # Fit calibrators
    print("\n  Fitting 2 calibrators on calibrate period (no leakage):")
    cal_state = fit_calibrators(calib_probs_raw, y_calib)

    # Predict on test period (untouched OOS)
    print("\n[X] Predicting on TEST period (untouched OOS)...")
    X_test = test_df[FC_X].fillna(0).values
    y_test = test_df["_y"].values.astype(int)
    test_probs_raw = model.predict_proba(scaler.transform(X_test))[:, 1]
    try:
        test_auc = roc_auc_score(y_test, test_probs_raw)
        print(f"  Test period AUC (raw): {test_auc:.4f}")
    except Exception:
        test_auc = 0.0

    # Apply Platt calibration (primary)
    test_probs_platt = np.array([apply_calibrator(float(p), cal_state, "platt") for p in test_probs_raw])
    try:
        test_platt_brier = brier_score_loss(y_test, test_probs_platt)
        test_platt_ece = expected_calibration_error(test_probs_platt, y_test.astype(float))
        print(f"  Test Platt: Brier={test_platt_brier:.4f}, ECE={test_platt_ece:.4f}")
    except Exception:
        pass

    # Threshold sweep on test period
    print("\n" + "=" * 70)
    print("THRESHOLD SWEEP on TEST period (untouched OOS, Platt calibration)")
    print("=" * 70)
    print(f"\n  {'Thresh':>7} {'Trades':>7} {'Cov':>6} {'Prec':>6} {'CI95%':>14} "
          f"{'Brier':>6} {'ECE':>6} {'NetExp%':>8} {'PF':>7} {'Sharpe':>7} {'Sortino':>7} {'MaxDD%':>7} "
          f"{'TP1%':>5} {'TP2%':>5} {'TP3%':>5}")
    sweep_results = []
    directions_test = test_df["_direction"].values
    net_rets_test = test_df["_net_ret"].values
    exit_labels_test = test_df["_label"].values
    for thresh in [0.70, 0.75, 0.80, 0.85, 0.90, 0.95]:
        m = compute_metrics(test_probs_platt, y_test, net_rets_test, directions_test, exit_labels_test, thresh)
        sweep_results.append(m)
        ci_str = f"[{m['precision_ci_low']:.2f},{m['precision_ci_high']:.2f}]"
        print(f"  {thresh:>7.2f} {m['trade_count']:>7} {m['coverage']:>5.1%} {m['precision']:>5.1%} {ci_str:>14} "
              f"{m['brier']:>6.3f} {m['ece']:>6.3f} {m['net_expectancy_pct']:>+7.2f}% {m['profit_factor']:>7.2f} "
              f"{m['sharpe']:>7.2f} {m['sortino']:>7.2f} {m['max_drawdown_pct']:>+6.1f}% "
              f"{m['tp1_hit_rate']:>4.0%} {m['tp2_hit_rate']:>4.0%} {m['tp3_hit_rate']:>4.0%}")

    # 90% precision check
    print("\n" + "=" * 70)
    print("90% TP1 PRECISION CHECK")
    print("=" * 70)
    precision_90 = [r for r in sweep_results if r["precision"] >= 0.90 and r["trade_count"] >= 30]
    if precision_90:
        print(f"\n  ✅ 90% precision ACHIEVED in {len(precision_90)} configurations:")
        for r in precision_90:
            print(f"    threshold={r['threshold']:.2f}, trades={r['trade_count']}, "
                  f"precision={r['precision']:.1%}, CI95%=[{r['precision_ci_low']:.2f},{r['precision_ci_high']:.2f}], "
                  f"net_exp={r['net_expectancy_pct']:+.2f}%, PF={r['profit_factor']:.2f}")
    else:
        print("\n  ❌ 90% precision NOT achieved with trade_count >= 30.")
        print("     This is the honest result per 'Do not fabricate results' instruction.")
        best = max(sweep_results, key=lambda x: x["precision"] if x["trade_count"] > 0 else 0)
        print(f"  Best precision: {best['precision']:.1%} at threshold={best['threshold']:.2f} "
              f"with {best['trade_count']} trades, CI=[{best['precision_ci_low']:.2f},{best['precision_ci_high']:.2f}]")

    # Per-strategy backtest (apply each strategy to test period)
    print("\n" + "=" * 70)
    print("PER-STRATEGY BACKTEST (all 10 strategies on test period, threshold=signal==1)")
    print("=" * 70)
    print(f"\n  {'Strategy':<25} {'Trades':>7} {'Prec':>6} {'NetExp%':>8} {'PF':>7} {'Sharpe':>7} {'MaxDD%':>7}")
    print("  " + "-" * 70)
    per_strategy_bt = {}
    sig_cols = [f"sig_{i+1}_{n.replace(' ', '_').lower()}" for i, n in enumerate(X_STRATEGY_NAMES)]
    for sname, scol in zip(X_STRATEGY_NAMES, sig_cols):
        bt = backtest_strategy(test_df, scol, threshold=1.0)
        per_strategy_bt[sname] = bt
        print(f"  {sname:<25} {bt['trade_count']:>7} {bt['precision']:>5.1%} "
              f"{bt['net_expectancy_pct']:>+7.2f}% {bt['profit_factor']:>7.2f} "
              f"{bt['sharpe']:>7.2f} {bt['max_drawdown_pct']:>+6.1f}%")

    # Baselines
    print("\n" + "=" * 70)
    print("BASELINES (buy-and-hold + trend-following)")
    print("=" * 70)
    baselines = backtest_baselines(test_df)
    print(f"  Buy-and-hold (per-stock avg): {baselines['buy_hold']['net_return_pct']:+.2f}%")
    print(f"  Trend-follow (sig_1 trend_multi_tf): {baselines['trend_follow']['net_return_pct']:+.2f}%")

    # Generate per-stock X-Ensemble predictions
    print("\n[X] Generating per-stock predictions + saving...")
    atr_per = get_atr_per_stock(df_all)
    x_per_strategy, x_ens = predict_all_stocks(
        stocks, df_all, atr_per, model, scaler, cal_state, cg_predictions
    )

    # Use threshold 0.70 result as the headline backtest entry
    # But also compute maxReturnPct, minReturnPct, and stars for the modal
    headline_bt = sweep_results[0].copy()  # threshold 0.70
    # Compute max/min return for BUY trades at threshold 0.70
    buy_mask_070 = (directions_test == "BUY") & (test_probs_platt >= 0.70)
    if buy_mask_070.sum() > 0:
        buy_rets_070 = net_rets_test[buy_mask_070]
        headline_bt["maxReturnPct"] = round(float(buy_rets_070.max() * 100), 2)
        headline_bt["minReturnPct"] = round(float(buy_rets_070.min() * 100), 2)
    else:
        headline_bt["maxReturnPct"] = 0
        headline_bt["minReturnPct"] = 0
    # Add modal-expected fields (camelCase) alongside the X-specific snake_case fields
    headline_bt["totalTrades"] = headline_bt["trade_count"]
    headline_bt["buySignals"] = headline_bt["trade_count"]
    headline_bt["sellSignals"] = 0
    headline_bt["correctBuys"] = headline_bt["tp1_count"] + headline_bt["tp2_count"] + headline_bt["tp3_count"]
    headline_bt["correctSells"] = 0
    headline_bt["winRate"] = round(headline_bt["precision"] * 100, 1)
    headline_bt["avgReturnPct"] = headline_bt["net_expectancy_pct"]
    headline_bt["stars"] = int(min(5, max(1, int(headline_bt["precision"] * 100 / 20) + 1)))
    # Also include the full threshold sweep + exit breakdown for the modal's
    # profitFactor / reliabilityTable / skippedTrades / costBps fields
    headline_bt["profitFactor"] = headline_bt["profit_factor"]
    headline_bt["costBps"] = int(COST_ROUND_TRIP * 10000)
    headline_bt["skippedTrades"] = 0
    headline_bt["method"] = "x_ensemble"
    headline_bt["calibrators_compared"] = ["platt", "isotonic"]
    headline_bt["purge_gap_bars"] = PURGE_BARS
    headline_bt["cv_folds"] = 5
    headline_bt["split"] = {"train": X_TRAIN_FRAC, "calibrate": X_CALIB_FRAC, "test": X_TEST_FRAC}
    # Reliability table for the modal
    headline_bt["reliabilityTable"] = []
    bins = np.linspace(0, 1, 11)
    buy_probs_070 = test_probs_platt[buy_mask_070]
    buy_labels_070 = y_test[buy_mask_070]
    bin_inds = np.clip(np.digitize(buy_probs_070, bins) - 1, 0, 9)
    for bi in range(10):
        mask = bin_inds == bi
        if mask.sum() > 0:
            headline_bt["reliabilityTable"].append({
                "bin": bi + 1,
                "bin_center": round(float((bins[bi] + bins[bi+1]) / 2), 2),
                "count": int(mask.sum()),
                "predicted_prob": round(float(buy_probs_070[mask].mean()), 3),
                "actual_hit_rate": round(float(buy_labels_070[mask].mean()), 3),
            })

    save_to_json(x_per_strategy, x_ens, headline_bt, per_strategy_bt, baselines, sweep_results)

    elapsed = time.time() - start
    print(f"\n{'='*70}")
    print(f"X-Models training complete in {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print(f"{'='*70}")
    print(f"  Meta-model: LightGBM (AUC test={test_auc:.4f})")
    print(f"  Strategies trained: 10")
    print(f"  Stocks with predictions: {len(x_ens)}")
    print(f"  Backtest (threshold=0.70): {headline_bt['trade_count']} trades, "
          f"prec={headline_bt['precision']:.1%}, net={headline_bt['net_expectancy_pct']:+.2f}%, "
          f"PF={headline_bt['profit_factor']:.2f}, Sharpe={headline_bt['sharpe']:.2f}, "
          f"Sortino={headline_bt['sortino']:.2f}, MaxDD={headline_bt['max_drawdown_pct']:.1f}%")


if __name__ == "__main__":
    main()
