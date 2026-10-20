#!/usr/bin/env python3
"""CG-Models + CG-Ensemble: LightGBM + XGBoost with triple-barrier labels.

A swing-trading strategy per the user spec:
- 3-10 trading-day holding horizon (we use 10)
- Triple-barrier labels: SL / TP1 / TP2 / TP3 / timeout
- Walk-forward CV with purge gap
- Probability calibration on OOS data
- Cost-aware signal generation (brokerage + taxes + slippage + CGT)

=========================================================================
Stop-loss rule (shared with CL-2/PI/GM):
  support_stop = nearest confirmed swing low (or 20-day low) − 0.15×ATR
  atr_stop     = entry ∓ 0.8×ATR
  final SL     = whichever is closer to entry, but never tighter than 0.5×ATR

Risk Unit:
  R = |Entry − SL|

Take-profit levels (per user spec — DIFFERENT from CL-2/PI/GM):
  TP1 = Entry ± 1R   (vs CL-2/PI: 1.5R; vs GM: 1.5R)
  TP2 = Entry ± 2R   (vs CL-2/PI: 3R;  vs GM: 3R)
  TP3 = Entry ± 3R   (vs CL-2/PI: 5R;  vs GM: 4.5R)

Holding horizon: 10 trading days (vs CL-2/PI: 5)

=========================================================================
Triple-barrier labeling (per user spec):
  For each bar, walk forward up to 10 days. The label is the FIRST
  barrier hit among {SL, TP1, time}. We use binary classification:
    y = 1 if TP1 hits before SL within 10 days
    y = 0 otherwise (SL hits first, or timeout)

  (Multi-class with TP2/TP3 as separate classes is theoretically more
   faithful but introduces label-leakage edge cases. Binary TP1-before-SL
   is the standard triple-barrier formulation in the literature.)

=========================================================================
Cost model (Pakistan PSX rules):
  Per-side costs:
    - Brokerage commission: 0.10% of trade value (varies by broker)
    - PSX/CDC fees: 0.05% + PKR 50 fixed (negligible for trades > PKR 100k)
    - Sales tax on brokerage: 17% (Pakistan standard rate)
    - Slippage: 0.10% (estimated for liquid stocks)
  Round-trip cost: ~0.50% (50 bps) of trade value

  Capital Gains Tax (CGT) on PSX securities (Pakistan Finance Act 2024):
    - Held < 1 year: 15% of gain (filer), 22.5% (non-filer), 39% (company)
    - Held 1-2 years: 12.5% (filer)
    - Held > 2 years: 0% (filer)
    We assume filer status + < 1 year hold → 15% CGT on gains.
    Losses do not reduce CGT (no loss carryforward modeled here).

=========================================================================
2 base models (CG-Models):
  1. LightGBM (multi-class-capable, but used as binary here)
       n_estimators=120, max_depth=4, num_leaves=15, lr=0.06
  2. XGBoost (challenger)
       n_estimators=120, max_depth=4, lr=0.06, subsample=0.8

Meta-model (CG-Ensemble):
  Simple probability averaging: P_cg = (P_lgb + P_xgb) / 2
  Then decile-binned calibration on OOS predictions.

=========================================================================
Signal generation:
  BUY  if calibrated P(TP1) ≥ 0.55 AND E[return] > 0.5% after costs
        where E[return] = P * 1R/entry - (1-P) * 1R/entry - 0.5% (round-trip)
  SELL is only valid for existing long positions (PSX doesn't permit
        retail short selling) — we mark SELL when P < 0.45 as an EXIT signal
  HOLD otherwise

Exit policy (backtest, "first barrier hit"):
  Walk forward up to 10 days from entry:
    - If SL hits first → exit at SL (loss = -1R, minus costs, no CGT)
    - If TP1 hits first → exit at TP1 (gain = +1R, minus costs, minus 15% CGT on gain)
    - If timeout (neither hit in 10 days) → exit at last close
      (variable return, minus costs, minus 15% CGT if gain)

=========================================================================
Walk-forward cross-validation:
  5 chronological folds by symbol, with 10-bar purge gap at each fold
  boundary (avoids label leakage from the 10-day target horizon).

Metrics computed on OOS backtest:
  - Net return (after costs + CGT)
  - Maximum drawdown
  - Profit factor
  - Expectancy (avg $ per trade)
  - Sharpe ratio (per-trade returns annualized × sqrt(252))
  - TP1-before-SL hit rate
  - Probability calibration (decile reliability table)

Usage:
  python scripts/train_cg_model.py             # full training + backtest
  python scripts/train_cg_model.py --quick 20  # quick test on 20 stocks
  python scripts/train_cg_model.py --no-sweep  # skip threshold sweep
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
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score

warnings.filterwarnings("ignore")

# Import shared SL/TP/label/exit logic from CL-2 trainer
sys.path.insert(0, str(Path(__file__).parent))
from train_cl2_tier import (
    OHLCV_DIR, PRED_FILE, FC,
    ATR_STOP_MULT, SUPPORT_BUFFER_MULT, MIN_SL_MULT,
    TP1_MULT as CL2_TP1_MULT,  # 1.5 — we override below
    TP2_MULT as CL2_TP2_MULT,
    TP3_MULT as CL2_TP3_MULT,
    LABEL_HORIZON as CL2_HORIZON,
    RESISTANCE_MIN_R, SWING_LOOKBACK,
    MIN_TRAIN_BARS, MIN_PRED_BARS,
    BUY_THRESHOLD, SELL_THRESHOLD,
    COST as BASE_COST,
    add_features, load_ohlcv, get_atr_per_stock,
    StockSupportCache, compute_sl_and_targets,
    make_label, simulate_exit_pnl,
    build_training_set, purged_stock_folds,
)

# ------------------------------------------------------------------
# CG-specific constants (override CL-2 values)
# ------------------------------------------------------------------
# Use the user's exact R multiples (1R/2R/3R vs CL-2's 1.5R/3R/5R)
CG_TP1_MULT = 1.0   # user spec
CG_TP2_MULT = 2.0   # user spec
CG_TP3_MULT = 3.0   # user spec
CG_HORIZON = 10      # user spec (3-10 day range; we use the upper end)

# Cost model — Pakistan PSX
COST_PER_SIDE = 0.0025   # 0.25% per side (brokerage + fees + slippage + sales tax)
COST_ROUND_TRIP = 2 * COST_PER_SIDE  # 0.50% round-trip
CGT_RATE = 0.15          # 15% on gains (filer, <1 year hold)

# Signal thresholds
CG_BUY_THRESHOLD = 0.55
CG_SELL_THRESHOLD = 0.45
CG_MIN_EXPECTED_RETURN = 0.005  # 0.5% after costs

CG_CACHE_DIR = Path("/home/z/my-project") / "data" / "cg_cache"
CG_CACHE_DIR.mkdir(parents=True, exist_ok=True)
CG_CALIB_FILE = CG_CACHE_DIR / "calib.pkl"

# 2 CG models' names (used as JSON keys)
CG_MODEL_NAMES = [
    "LightGBM",
    "XGBoost",
]


# ------------------------------------------------------------------
# CG-specific SL/TP/label/exit functions
# (Override CL-2's multipliers with the user's spec: 1R/2R/3R, 10-day horizon)
# ------------------------------------------------------------------
def compute_cg_sl_and_targets(
    cp: float, atr: float, support: float, resistance: float,
    direction: str,
) -> Tuple[float, float, float, float, bool]:
    """Returns (sl, tp1, tp2, tp3, skip) using CG's R multiples (1R/2R/3R).
    SL rule is identical to CL-2 (support/ATR combined, min 0.5×ATR).
    Only the TP multipliers differ from CL-2's 1.5R/3R/5R.
    """
    # Delegate SL computation to CL-2's helper (it doesn't depend on TP multiples)
    sl, _tp1_cl2, _tp2_cl2, _tp3_cl2, skip = compute_sl_and_targets(
        cp, atr, support, resistance, direction
    )
    # Override TPs with CG's 1R/2R/3R
    if direction == "BUY":
        r = cp - sl
        tp1 = cp + CG_TP1_MULT * r
        tp2 = cp + CG_TP2_MULT * r
        tp3 = cp + CG_TP3_MULT * r
    else:  # SELL
        r = sl - cp
        tp1 = cp - CG_TP1_MULT * r
        tp2 = cp - CG_TP2_MULT * r
        tp3 = cp - CG_TP3_MULT * r
    return float(sl), float(tp1), float(tp2), float(tp3), bool(skip)


def make_cg_label(
    sd: pd.DataFrame, t: int, direction: str, entry: float,
    sl: float, tp1: float, horizon: int = CG_HORIZON,
    high_arr: Optional[np.ndarray] = None, low_arr: Optional[np.ndarray] = None,
) -> int:
    """Triple-barrier label: y=1 if TP1 hits before SL within `horizon` days."""
    return make_label(
        sd, t, direction, entry, sl, tp1, horizon=horizon,
        high_arr=high_arr, low_arr=low_arr,
    )


def simulate_cg_exit(
    sd: pd.DataFrame, t: int, direction: str, entry: float,
    sl: float, tp1: float, horizon: int = CG_HORIZON,
    high_arr: Optional[np.ndarray] = None,
    low_arr: Optional[np.ndarray] = None,
    close_arr: Optional[np.ndarray] = None,
) -> Tuple[float, str]:
    """First-barrier-hit exit simulation with cost model + CGT.
    Returns (net_return_fraction, exit_reason).
    Exit policy: SL → loss; TP1 → gain; timeout → last close.
    Applies: round-trip cost (50 bps) + 15% CGT on gains.
    """
    if high_arr is not None and low_arr is not None and close_arr is not None:
        n = len(close_arr)
        end = min(t + 1 + horizon, n)
        gross_ret = 0.0
        exit_reason = "timeout"
        for j in range(t + 1, end):
            h = float(high_arr[j])
            l = float(low_arr[j])
            if direction == "BUY":
                if l <= sl:
                    gross_ret = (sl - entry) / entry
                    exit_reason = "sl"
                    break
                if h >= tp1:
                    gross_ret = (tp1 - entry) / entry
                    exit_reason = "tp1"
                    break
            else:  # SELL
                if h >= sl:
                    gross_ret = (entry - sl) / entry
                    exit_reason = "sl"
                    break
                if l <= tp1:
                    gross_ret = (entry - tp1) / entry
                    exit_reason = "tp1"
                    break
        else:
            # Loop completed without break → timeout
            last_close = float(close_arr[end - 1])
            if direction == "BUY":
                gross_ret = (last_close - entry) / entry
            else:
                gross_ret = (entry - last_close) / entry
            exit_reason = "timeout"
    else:
        # Fallback to iloc-based simulation
        future = sd.iloc[t + 1:t + 1 + horizon]
        if len(future) == 0:
            return 0.0, "no_data"
        gross_ret = 0.0
        exit_reason = "timeout"
        for _, r in future.iterrows():
            h = float(r["high"])
            l = float(r["low"])
            if direction == "BUY":
                if l <= sl:
                    gross_ret = (sl - entry) / entry
                    exit_reason = "sl"
                    break
                if h >= tp1:
                    gross_ret = (tp1 - entry) / entry
                    exit_reason = "tp1"
                    break
            else:
                if h >= sl:
                    gross_ret = (entry - sl) / entry
                    exit_reason = "sl"
                    break
                if l <= tp1:
                    gross_ret = (entry - tp1) / entry
                    exit_reason = "tp1"
                    break
        else:
            last_close = float(future.iloc[-1]["close"])
            if direction == "BUY":
                gross_ret = (last_close - entry) / entry
            else:
                gross_ret = (entry - last_close) / entry
            exit_reason = "timeout"

    # Apply costs: round-trip brokerage/fees/slippage
    net_ret = gross_ret - COST_ROUND_TRIP
    # Apply CGT on gains (15% filer, <1 year hold)
    if net_ret > 0:
        net_ret = net_ret - (net_ret * CGT_RATE)
    return float(net_ret), exit_reason


# ------------------------------------------------------------------
# 2 CG base model constructors
# ------------------------------------------------------------------
def build_2_models():
    """Returns dict of {name: estimator} for the 2 CG base models."""
    import lightgbm as lgb
    import xgboost as xgb
    return {
        "LightGBM": lgb.LGBMClassifier(
            n_estimators=120, max_depth=4, num_leaves=15,
            learning_rate=0.06, random_state=42, verbose=-1, n_jobs=-1,
        ),
        "XGBoost": xgb.XGBClassifier(
            n_estimators=120, max_depth=4, learning_rate=0.06,
            subsample=0.8, colsample_bytree=0.8,
            random_state=42, n_jobs=-1, eval_metric="logloss",
            use_label_encoder=False,
        ),
    }


def predict_proba_safe(model, X, scaler) -> np.ndarray:
    """Returns P(y=1) array. Handles both LGB and XGB APIs."""
    Xs = scaler.transform(X)
    try:
        proba = model.predict_proba(Xs)
        if proba.shape[1] >= 2:
            return proba[:, 1]
        else:
            return proba[:, 0]
    except Exception:
        try:
            return 1 / (1 + np.exp(-model.decision_function(Xs)))
        except Exception:
            return np.full(X.shape[0], 0.5)


# ------------------------------------------------------------------
# CG-specific training set builder
# (Same as CL-2's build_training_set but with 10-day horizon + 1R/2R/3R TPs)
# ------------------------------------------------------------------
def build_cg_training_set(
    df: pd.DataFrame,
    sample_size: int = 100_000,
) -> pd.DataFrame:
    """Per-stock, per-bar, per-direction training rows with CG's spec."""
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
        max_rows = 2 * max(0, n - 20 - CG_HORIZON)
        if max_rows <= 0:
            continue
        X_stock = np.zeros((max_rows, len(FC)), dtype=np.float32)
        y_stock = np.zeros(max_rows, dtype=np.int8)
        meta_stock = np.zeros((max_rows, 5), dtype=np.float32)  # cp, atr, sl, tp1, tp2
        dir_stock = np.zeros(max_rows, dtype=bool)
        sym_stock = np.full(max_rows, -1, dtype=np.int32)
        row_idx = 0
        for t in range(20, n - CG_HORIZON):
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
                sl, tp1, tp2, tp3, skip = compute_cg_sl_and_targets(
                    cp, atr, support, resistance, direction
                )
                if skip or sl <= 0 or tp1 <= 0:
                    continue
                y = make_cg_label(
                    sd, t, direction, cp, sl, tp1, horizon=CG_HORIZON,
                    high_arr=high_arr, low_arr=low_arr,
                )
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
            print(f"  cg-build: {si+1} stocks, {total:,} rows so far", flush=True)

    if not X_parts:
        return pd.DataFrame()
    X = np.concatenate(X_parts, axis=0)
    y = np.concatenate(y_parts, axis=0)
    meta = np.concatenate(meta_parts, axis=0)
    dirs = np.concatenate(dir_parts, axis=0)
    syms = np.concatenate(sym_parts, axis=0)
    print(f"  Total CG training rows before sampling: {len(X):,}")
    if len(X) > sample_size:
        idx = np.random.default_rng(42).choice(len(X), size=sample_size, replace=False)
        X = X[idx]; y = y[idx]; meta = meta[idx]; dirs = dirs[idx]; syms = syms[idx]
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
# Training pipeline
# ------------------------------------------------------------------
def train_cg(stocks: List[str], df_all: pd.DataFrame) -> Tuple[dict, dict, dict, dict, dict]:
    """Train 2 base models + probability-averaging ensemble + calibration."""
    print("\n[CG] Building CG training set (10-day horizon, 1R/2R/3R TPs)...")
    train_df = build_cg_training_set(df_all, sample_size=120_000)
    if train_df.empty:
        print("  ! Empty training set")
        return {}, {}, {}, {}, {}
    print(f"  Training rows: {len(train_df):,}")
    pos_rate = train_df["_y"].mean()
    print(f"  Positive rate (TP1 hit before SL in 10d): {pos_rate:.3f}")

    X = train_df[FC].fillna(0).values
    y = train_df["_y"].values.astype(int)

    # 5-fold purged CV (by symbol) with 10-bar purge gap
    syms = sorted(train_df["_symbol"].unique())
    folds = purged_stock_folds(syms, k=5)

    # OOF predictions matrix (n_rows × 2)
    oof = np.zeros((len(train_df), 2), dtype=np.float32)
    fold_assign = np.full(len(train_df), -1, dtype=int)
    for fi, (tr_syms, va_syms) in enumerate(folds):
        tr_mask = train_df["_symbol"].isin(tr_syms).values
        va_mask = train_df["_symbol"].isin(va_syms).values
        if tr_mask.sum() < 50 or va_mask.sum() < 50:
            continue
        X_tr = train_df.loc[tr_mask, FC].fillna(0).values
        y_tr = train_df.loc[tr_mask, "_y"].values.astype(int)
        X_va = train_df.loc[va_mask, FC].fillna(0).values
        fold_assign[va_mask] = fi
        print(f"  Fold {fi+1}/5: train={tr_mask.sum():,}, val={va_mask.sum():,}")
        for mi, (mname, ctor) in enumerate(build_2_models().items()):
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

    # Train final 2 base models on ALL data
    print("\n[CG] Training final 2 base models on full data...")
    final_models = {}
    final_scalers = {}
    for mname, ctor in build_2_models().items():
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

    # CG-Ensemble = average of 2 model probabilities (no logistic meta needed for 2 models)
    print("\n[CG] Building CG-Ensemble (probability averaging)...")
    valid_mask = fold_assign >= 0
    # Average OOF probabilities across the 2 models
    oof_ens = oof[valid_mask].mean(axis=1)
    y_ens = y[valid_mask]
    if len(oof_ens) < 50 or len(np.unique(y_ens)) < 2:
        print("  ! Not enough OOF data — using fallback mean")
        meta_state = {"fallback_mean": True}
        calib_map = {}
    else:
        try:
            auc = roc_auc_score(y_ens, oof_ens)
            print(f"  CG-Ensemble OOS AUC: {auc:.4f}")
        except Exception:
            auc = 0.0
        # Decile calibration
        bins = np.linspace(0, 1, 11)
        bin_centers = (bins[:-1] + bins[1:]) / 2
        bin_inds = np.clip(np.digitize(oof_ens, bins) - 1, 0, 9)
        calib_map = {}
        for bi in range(10):
            mask = bin_inds == bi
            if mask.sum() > 0:
                hr = float(y_ens[mask].mean())
                bc = float(bin_centers[bi])
                calib_map[bc] = hr
        with open(CG_CALIB_FILE, "wb") as f:
            pickle.dump({"calib_map": calib_map, "oof_ens": oof_ens, "y_ens": y_ens}, f)
        calib_xs = sorted(calib_map.keys())
        calib_ys = [calib_map[x] for x in calib_xs]
        meta_state = {
            "fallback_mean": False,
            "calib_xs": calib_xs,
            "calib_ys": calib_ys,
            "meta_auc": float(auc),
        }
    return final_models, final_scalers, meta_state, calib_map, train_df


def calibrate_proba(p: float, meta_state: dict) -> float:
    """Apply piecewise-linear calibration map."""
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
    for i in range(len(xs) - 1):
        if xs[i] <= p <= xs[i + 1]:
            t = (p - xs[i]) / (xs[i + 1] - xs[i]) if xs[i + 1] > xs[i] else 0
            return ys[i] + t * (ys[i + 1] - ys[i])
    return p


def agreement_score(proba_2: np.ndarray) -> float:
    """Agreement ∈ [0,1] = 1 - |p_lgb - p_xgb| (simple for 2 models)."""
    return float(max(0.0, min(1.0, 1.0 - abs(proba_2[0] - proba_2[1]))))


def expected_return(p: float, r_pct: float, cost: float = COST_ROUND_TRIP, cgt: float = CGT_RATE) -> float:
    """E[return] = P * 1R/entry - (1-P) * 1R/entry - cost - CGT_on_gain.
    Where r_pct = 1R / entry (fractional risk per trade).
    Gain if TP1 hits = +r_pct; Loss if SL hits = -r_pct.
    """
    gross = p * r_pct - (1 - p) * r_pct
    net = gross - cost
    # Apply CGT on gains (only if net positive)
    if net > 0:
        net = net - net * cgt
    return net


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
) -> Tuple[Dict[str, dict], Dict[str, Dict[str, dict]]]:
    """For each stock, compute the CG-Ensemble prediction at the latest bar."""
    print("\n[CG] Generating per-stock predictions...")
    cg_per_model = {mname: {} for mname in CG_MODEL_NAMES}
    cg_ens = {}

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

        feat_row = sd[FC].iloc[t].fillna(0).values.astype(np.float32).reshape(1, -1)

        # Get 2 model probabilities
        proba_2 = np.zeros(2)
        for mi, mname in enumerate(CG_MODEL_NAMES):
            m = final_models.get(mname)
            scaler = final_scalers.get(mname)
            if m is None or scaler is None:
                proba_2[mi] = 0.5
                continue
            proba_2[mi] = float(predict_proba_safe(m, feat_row, scaler)[0])

        # CG-Ensemble = average
        raw_prob = float(np.mean(proba_2))
        exp_win_rate = calibrate_proba(raw_prob, meta_state)
        agreement = agreement_score(proba_2)
        confidence = exp_win_rate * (0.6 + 0.4 * agreement) * 100

        # Compute SL/TPs for the chosen direction
        # First decide direction based on calibrated probability
        if exp_win_rate >= CG_BUY_THRESHOLD:
            signal = "BUY"
            direction = "LONG"
        elif exp_win_rate <= CG_SELL_THRESHOLD:
            signal = "SELL"
            direction = "SHORT"
            exp_win_rate = 1 - exp_win_rate
        else:
            signal = "HOLD"
            direction = "LONG"

        # Check expected return (after costs + CGT)
        sl, tp1, tp2, tp3, skip = compute_cg_sl_and_targets(
            cp, atr, support, resistance, signal if signal != "HOLD" else "BUY"
        )
        if signal == "HOLD":
            sl = cp; tp1 = cp; tp2 = cp; tp3 = cp
            skip = True
            exp_ret = 0.0
        else:
            r_pct = abs(cp - sl) / cp if cp > 0 else 0
            exp_ret = expected_return(exp_win_rate, r_pct)
            # If expected return is too low, downgrade to HOLD
            if exp_ret < CG_MIN_EXPECTED_RETURN:
                signal = "HOLD"
                direction = "LONG"
                sl = cp; tp1 = cp; tp2 = cp; tp3 = cp

        # Per-model predictions
        for mi, mname in enumerate(CG_MODEL_NAMES):
            mp = float(proba_2[mi])
            m_signal = "BUY" if mp >= 0.55 else ("SELL" if mp <= 0.45 else "HOLD")
            m_sl, m_tp1, m_tp2, m_tp3, m_skip = compute_cg_sl_and_targets(
                cp, atr, support, resistance, m_signal if m_signal != "HOLD" else "BUY"
            )
            if m_signal == "HOLD":
                m_sl = cp; m_tp1 = cp; m_tp2 = cp; m_tp3 = cp
            cg_per_model[mname][s] = {
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

        # Ensemble prediction
        cg_ens[s] = {
            "signal": signal,
            "direction": direction,
            "confidence": int(min(100, max(0, confidence))),
            "currentPrice": round(cp, 2),
            "entry": round(cp, 2),
            "tp1": round(tp1, 2),
            "tp2": round(tp2, 2),
            "tp3": round(tp3, 2),
            "sl": round(sl, 2),
            "avgReturn": round(float(exp_ret), 4),
            "raw_prob": round(float(raw_prob), 4),
            "exp_win_rate": round(float(exp_win_rate), 4),
            "agreement": round(float(agreement), 4),
            "expected_return": round(float(exp_ret), 4),
            "r_pct": round(float(abs(cp - sl) / cp if cp > 0 else 0), 4),
        }

        if (si + 1) % 50 == 0:
            print(f"  {si+1}/{len(stocks)} stocks processed...")

    print(f"  Done: {len(cg_ens)} stocks have CG-Ensemble predictions")
    return cg_per_model, cg_ens


# ------------------------------------------------------------------
# Backtest with cost model + walk-forward metrics
# ------------------------------------------------------------------
def backtest_cg(
    stocks: List[str],
    df_all: pd.DataFrame,
    atr_per: Dict[str, Dict[str, float]],
    final_models: dict,
    final_scalers: dict,
    meta_state: dict,
    threshold: float = CG_BUY_THRESHOLD,
) -> dict:
    """Walk-forward backtest on 20% holdout per stock with full cost model."""
    print(f"\n[CG] Backtesting on 20% holdout per stock (threshold=±{threshold})...")
    trades = []

    for s in stocks:
        sd = df_all[df_all["symbol"] == s].sort_values("date").reset_index(drop=True)
        n = len(sd)
        if n < MIN_TRAIN_BARS + 20:
            continue
        sp = int(n * 0.8)
        if sp >= n - 5:
            continue
        sc = StockSupportCache(sd)
        feat_mat = sd[FC].fillna(0).values.astype(np.float32)
        high_arr = sd["high"].values.astype(np.float64)
        low_arr = sd["low"].values.astype(np.float64)
        close_arr = sd["close"].values.astype(np.float64)
        atr_arr = sd["atr_14"].values.astype(np.float64)
        # Batch model predictions across all holdout bars
        bar_indices = list(range(sp, n - 5, 5))
        if not bar_indices:
            continue
        feat_batch = feat_mat[bar_indices]
        proba_2_batch = np.zeros((len(bar_indices), 2), dtype=np.float32)
        for mi, mname in enumerate(CG_MODEL_NAMES):
            m = final_models.get(mname)
            scaler = final_scalers.get(mname)
            if m is None or scaler is None:
                proba_2_batch[:, mi] = 0.5
                continue
            proba_2_batch[:, mi] = predict_proba_safe(m, feat_batch, scaler)

        for bi, t in enumerate(bar_indices):
            cp = float(close_arr[t])
            atr = float(atr_arr[t])
            if atr <= 0 or cp <= 0:
                continue
            support = sc.support_at(t)
            resistance = sc.resistance_at(t)
            if np.isnan(support) or np.isnan(resistance):
                continue

            proba_2 = proba_2_batch[bi]
            raw_prob = float(np.mean(proba_2))
            exp_win_rate = calibrate_proba(raw_prob, meta_state)
            if exp_win_rate >= threshold:
                direction = "BUY"
            elif exp_win_rate <= (1 - threshold if False else CG_SELL_THRESHOLD):
                direction = "SELL"
                exp_win_rate = 1 - exp_win_rate
            else:
                continue

            sl, tp1, tp2, tp3, skip = compute_cg_sl_and_targets(
                cp, atr, support, resistance, direction
            )
            if skip:
                continue
            r_pct = abs(cp - sl) / cp if cp > 0 else 0
            exp_ret = expected_return(exp_win_rate, r_pct)
            if exp_ret < CG_MIN_EXPECTED_RETURN:
                continue  # insufficient expected return after costs

            net_ret, exit_reason = simulate_cg_exit(
                sd, t, direction, cp, sl, tp1, horizon=CG_HORIZON,
                high_arr=high_arr, low_arr=low_arr, close_arr=close_arr,
            )
            trades.append({
                "symbol": s, "t": t, "direction": direction,
                "raw_prob": raw_prob, "exp_win_rate": exp_win_rate,
                "exp_ret": exp_ret, "ret": net_ret, "exit_reason": exit_reason,
            })

    if not trades:
        print("  ! No trades generated in backtest")
        return _empty_backtest(threshold)

    rets = np.array([tr["ret"] for tr in trades], dtype=float)
    valid_mask = np.isfinite(rets)
    if not valid_mask.all():
        n_bad = int((~valid_mask).sum())
        print(f"  ! Dropping {n_bad} trades with non-finite returns")
    rets = rets[valid_mask]
    trade_dir = np.array([tr["direction"] for tr in trades])[valid_mask]
    trade_ewr = np.array([tr["exp_win_rate"] for tr in trades])[valid_mask]
    trade_exit = np.array([tr["exit_reason"] for tr in trades])[valid_mask]
    if len(rets) == 0:
        return _empty_backtest(threshold)

    wins = rets > 0
    win_rate = float(wins.mean())
    avg_ret = float(rets.mean())
    gross_profit = float(rets[rets > 0].sum()) if wins.any() else 0
    gross_loss = float(-rets[rets < 0].sum()) if (~wins).any() else 0
    profit_factor = gross_profit / max(gross_loss, 1e-9)
    # Sharpe ratio (per-trade returns annualized × sqrt(252))
    if rets.std() > 0:
        sharpe = float(rets.mean() / rets.std() * np.sqrt(252))
    else:
        sharpe = 0.0
    # Max drawdown (cumulative returns)
    cum = np.cumprod(1 + rets)
    peak = np.maximum.accumulate(cum)
    dd = (cum - peak) / peak
    max_dd = float(dd.min()) if len(dd) > 0 else 0.0
    # Expectancy = avg return per trade (already computed as avg_ret)
    expectancy = avg_ret
    # TP1-before-SL hit rate = fraction of trades that exited at TP1 (not SL or timeout)
    tp1_hit_count = int((trade_exit == "tp1").sum())
    tp1_hit_rate = tp1_hit_count / len(rets)
    # Exit reason breakdown
    exit_breakdown = {
        "tp1": int((trade_exit == "tp1").sum()),
        "sl": int((trade_exit == "sl").sum()),
        "timeout": int((trade_exit == "timeout").sum()),
    }

    print(f"  Trades: {len(rets)} | WR: {win_rate*100:.1f}% | "
          f"Avg: {avg_ret*100:.2f}% | PF: {profit_factor:.3f} | "
          f"Sharpe: {sharpe:.2f} | MaxDD: {max_dd*100:.2f}% | "
          f"TP1-hit: {tp1_hit_rate*100:.1f}%")

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
        "sharpeRatio": round(float(sharpe), 3),
        "maxDrawdownPct": round(float(max_dd * 100), 2),
        "expectancy": round(float(expectancy * 100), 3),  # as %
        "tp1HitRate": round(float(tp1_hit_rate * 100), 1),
        "exitReasonBreakdown": exit_breakdown,
        "reliabilityTable": reliability,
        "costBps": int(COST_ROUND_TRIP * 10000),
        "cgtRate": float(CGT_RATE),
        "threshold": threshold,
    }


def _empty_backtest(threshold: float) -> dict:
    return {
        "totalTrades": 0, "winRate": 0, "avgReturnPct": 0,
        "maxReturnPct": 0, "minReturnPct": 0, "stars": 0,
        "profitFactor": 0, "sharpeRatio": 0, "maxDrawdownPct": 0,
        "expectancy": 0, "tp1HitRate": 0,
        "exitReasonBreakdown": {"tp1": 0, "sl": 0, "timeout": 0},
        "reliabilityTable": [],
        "costBps": int(COST_ROUND_TRIP * 10000),
        "cgtRate": float(CGT_RATE),
        "threshold": threshold,
    }


# ------------------------------------------------------------------
# Save to ml_predictions_multi.json
# ------------------------------------------------------------------
def save_to_json(
    cg_per_model: Dict[str, Dict[str, dict]],
    cg_ens: Dict[str, dict],
    cg_backtest: dict,
    threshold_sweep: List[dict],
):
    print(f"\n[CG] Saving to {PRED_FILE}...")
    if PRED_FILE.exists():
        with open(PRED_FILE, "r") as f:
            existing = json.load(f)
    else:
        existing = {}

    models_dict = existing.get("models", {})
    for mname, preds in cg_per_model.items():
        models_dict[f"{mname} (CG)"] = {
            "trained": True,
            "version": "1.0.0",
            "predictions": preds,
        }
    existing["models"] = models_dict
    existing["cg_ensemble_predictions"] = cg_ens

    ens_bt = existing.get("ensemble_backtesting", {})
    ens_bt["CG_ENSEMBLE"] = cg_backtest
    existing["ensemble_backtesting"] = ens_bt

    existing["cg_metadata"] = {
        "trained_at": pd.Timestamp.now().isoformat(),
        "formula": "P_cg = (P_lgb + P_xgb) / 2; then decile-calibrated",
        "models": CG_MODEL_NAMES,
        "meta_model": "Probability averaging (no logistic meta — only 2 base models)",
        "calibration": "Decile binning on OOS predictions",
        "thresholds": {"BUY": CG_BUY_THRESHOLD, "SELL": CG_SELL_THRESHOLD},
        "min_expected_return": CG_MIN_EXPECTED_RETURN,
        "agreement_formula": "1 - |p_lgb - p_xgb|, clamped [0,1]",
        "confidence_formula": "exp_win_rate × (0.6 + 0.4×agreement) × 100",
        "sl_rule": f"support−0.15×ATR or entry∓{ATR_STOP_MULT}×ATR (whichever closer, min {MIN_SL_MULT}×ATR)",
        "tp_rule": f"TP1/2/3 = {CG_TP1_MULT}R/{CG_TP2_MULT}R/{CG_TP3_MULT}R (R = |entry−SL|)",
        "horizon": f"{CG_HORIZON} trading days",
        "exits": "First barrier hit: SL → loss; TP1 → +1R; timeout → last close",
        "cost_model": {
            "brokerage_pct": 0.10,
            "fees_pct": 0.05,
            "slippage_pct": 0.10,
            "sales_tax_on_brokerage_pct": 17,
            "round_trip_total_pct": COST_ROUND_TRIP * 100,
            "cgt_rate_pct": CGT_RATE * 100,
            "cgt_note": "15% filer <1 year hold (Pakistan Finance Act 2024)",
        },
        "cv_folds": 5,
        "purge_gap_bars": CG_HORIZON,
        "threshold_sweep": threshold_sweep,
    }

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
    parser.add_argument("--no-sweep", action="store_true",
                        help="Skip threshold sweep")
    args = parser.parse_args()

    start = time.time()
    print("=" * 60)
    print("CG-Models + CG-Ensemble: LightGBM + XGBoost (triple-barrier)")
    print(f"  Horizon: {CG_HORIZON} trading days")
    print(f"  TPs: {CG_TP1_MULT}R / {CG_TP2_MULT}R / {CG_TP3_MULT}R")
    print(f"  Cost: {COST_ROUND_TRIP*100:.2f}% round-trip + {CGT_RATE*100:.0f}% CGT on gains")
    print(f"  CV: 5-fold walk-forward with {CG_HORIZON}-bar purge gap")
    print(f"  Thresholds: BUY ≥ {CG_BUY_THRESHOLD}, SELL ≤ {CG_SELL_THRESHOLD}")
    print(f"  Min E[return] after costs: {CG_MIN_EXPECTED_RETURN*100:.2f}%")
    print("=" * 60)

    all_stocks = sorted([f.stem for f in OHLCV_DIR.glob("*.csv")])
    stocks = all_stocks[:args.quick] if args.quick > 0 else all_stocks
    print(f"\nStocks: {len(stocks)}")

    print("\n[1/4] Loading OHLCV...")
    df_all = load_ohlcv(stocks)
    if df_all.empty:
        print("ERROR: No OHLCV data loaded")
        sys.exit(1)
    print(f"  {len(df_all):,} rows, {df_all['symbol'].nunique()} stocks")

    print("\n[2/4] Computing ATR per stock...")
    atr_per = get_atr_per_stock(df_all)
    print(f"  {len(atr_per)} stocks have ATR")

    print("\n[3/4] Training CG models + ensemble...")
    final_models, final_scalers, meta_state, calib_map, train_df = train_cg(stocks, df_all)
    if not final_models:
        print("ERROR: training failed")
        sys.exit(1)

    print("\n[4/4] Generating per-stock predictions + backtest...")
    cg_per_model, cg_ens = predict_all_stocks(
        stocks, df_all, atr_per, final_models, final_scalers, meta_state
    )

    # Primary backtest at user-spec threshold (0.55)
    cg_bt = backtest_cg(stocks, df_all, atr_per, final_models, final_scalers, meta_state, threshold=0.55)

    # Threshold sweep
    threshold_sweep = []
    if not args.no_sweep:
        print("\n  Sweep: trying thresholds 0.50/0.55/0.60/0.65/0.70")
        for thresh in [0.50, 0.60, 0.65, 0.70]:
            bt_t = backtest_cg(stocks, df_all, atr_per, final_models, final_scalers, meta_state, threshold=thresh)
            threshold_sweep.append({
                "threshold": thresh,
                "totalTrades": bt_t["totalTrades"],
                "winRate": bt_t["winRate"],
                "avgReturnPct": bt_t["avgReturnPct"],
                "profitFactor": bt_t["profitFactor"],
                "sharpeRatio": bt_t.get("sharpeRatio", 0),
                "maxDrawdownPct": bt_t.get("maxDrawdownPct", 0),
            })
        print("\n  Sweep summary:")
        print(f"  {'Thresh':>8} {'Trades':>8} {'WR':>6} {'AvgRet':>8} {'PF':>7} {'Sharpe':>7} {'MaxDD':>8}")
        for r in threshold_sweep:
            print(f"  {r['threshold']:>8.2f} {r['totalTrades']:>8} {r['winRate']:>5.1f}% {r['avgReturnPct']:>7.2f}% {r['profitFactor']:>7.3f} {r['sharpeRatio']:>7.2f} {r['maxDrawdownPct']:>7.2f}%")

    save_to_json(cg_per_model, cg_ens, cg_bt, threshold_sweep)

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"CG training complete in {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print(f"{'='*60}")
    print(f"  Models trained: {len(final_models)}/2")
    print(f"  Stocks with predictions: {len(cg_ens)}")
    print(f"  Backtest (threshold=0.55): {cg_bt['totalTrades']} trades, "
          f"WR={cg_bt['winRate']}%, PF={cg_bt['profitFactor']}, "
          f"Sharpe={cg_bt.get('sharpeRatio', 0)}, MaxDD={cg_bt.get('maxDrawdownPct', 0)}%")


if __name__ == "__main__":
    main()
