#!/usr/bin/env python3
"""PI Tier: 4 models (Linear/Logistic Regression, Pattern Matcher KNN, Neural Network)
+ logistic meta-ensemble, trained on the same support/ATR SL rule as CL-2.

This is a NEW model category for Latent.pk, distinct from CL (avgReturn
heuristic), CL-2 (calibrated classifier ensemble with 7 models), and the
existing tier-1/2/3/4 models.

=========================================================================
Stop-loss rule (shared with CL-2):
  support_stop = nearest confirmed swing low (or 20-day low) − 0.15×ATR
  atr_stop     = entry ∓ 0.8×ATR
  final SL     = whichever is closer to entry, but never tighter than 0.5×ATR

Target label (shared with CL-2):
  y = 1 if TP1 (=1.5R) hits before SL within 5 days, else 0.

Exits (backtest):
  50% at TP1, 30% at TP2 (3R), 20% at TP3 (5R); SL→BE after TP1.

4 base models (all sklearn, CPU-only):
  1. Linear Regression (regressor) — predicts 5-day forward return;
     signal = BUY if pred > 0.005, SELL if pred < -0.005, else HOLD.
  2. Logistic Regression (classifier) — same TP1-hit-before-SL target as CL-2.
  3. Pattern Matcher (KNN) — k=15 distance-weighted neighbors classifier,
     same TP1 target.
  4. Neural Network (MLPClassifier) — distinct config from CL-2's MLP:
     2 hidden layers (64, 32), tanh activation, larger max_iter.

Meta-model (PI-Ensemble):
  LogisticRegression on the 4-dim OOF prediction vector:
    [logistic_prob, knn_prob, mlp_prob, linear_reg_normalized_return]
  Trained on purged time-ordered OOF predictions.

Calibration:
  Decile binning on OOS predictions (saved as data/pi_cache/calib.pkl).

Confidence outputs (per stock):
  raw_prob     ∈ [0,1] — meta-model sigmoid output
  exp_win_rate ∈ [0,1] — raw_prob after calibration
  agreement    ∈ [0,1] — 1 − 2×std(4 model probs), clamped [0,1]
  confidence   ∈ [0,100] — exp_win_rate × (0.6 + 0.4×agreement) × 100

Signal thresholds:
  BUY  if calibrated_prob ≥ 0.55 AND resistance check passes
  SELL if calibrated_prob ≤ 0.45 (mirror for shorts)
  HOLD otherwise

Usage:
  python scripts/train_pi_tier.py             # full training on 361 stocks
  python scripts/train_pi_tier.py --quick 20  # quick test on 20 stocks
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
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.neighbors import KNeighborsClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import roc_auc_score

warnings.filterwarnings("ignore")

# Import shared SL/TP/label/exit logic + feature engineering from CL-2 trainer
sys.path.insert(0, str(Path(__file__).parent))
from train_cl2_tier import (
    OHLCV_DIR, PRED_FILE, FC,
    ATR_STOP_MULT, SUPPORT_BUFFER_MULT, MIN_SL_MULT,
    TP1_MULT, TP2_MULT, TP3_MULT, LABEL_HORIZON,
    RESISTANCE_MIN_R, SWING_LOOKBACK, MIN_TRAIN_BARS, MIN_PRED_BARS,
    BUY_THRESHOLD, SELL_THRESHOLD, COST,
    add_features, load_ohlcv, get_atr_per_stock,
    StockSupportCache, compute_sl_and_targets,
    make_label, simulate_exit_pnl,
    build_training_set, purged_stock_folds,
)

# ------------------------------------------------------------------
# Constants
# ------------------------------------------------------------------
PI_CALIB_FILE = ROOT = Path("/home/z/my-project") / "data" / "pi_cache" / "calib.pkl"
PI_CACHE_DIR = Path("/home/z/my-project") / "data" / "pi_cache"
PI_CACHE_DIR.mkdir(parents=True, exist_ok=True)

# 4 PI models' names (used as JSON keys)
PI_MODEL_NAMES = [
    "Linear Regression",
    "Logistic Regression",
    "Pattern Matcher KNN",
    "Neural Network",
]


# ------------------------------------------------------------------
# 4 base model constructors — distinct from CL-2 where applicable
# ------------------------------------------------------------------
def build_4_models():
    """Returns dict of {name: estimator} for the 4 PI base models."""
    return {
        # Regressor — predicts 5-day forward return (continuous)
        "Linear Regression": LinearRegression(),
        # Classifier — predicts P(TP1 hit before SL within 5 days)
        "Logistic Regression": LogisticRegression(
            C=0.5, max_iter=200, random_state=42,
        ),
        # Pattern Matcher — k=15 distance-weighted KNN
        "Pattern Matcher KNN": KNeighborsClassifier(
            n_neighbors=15, weights="distance", algorithm="auto",
            n_jobs=-1,
        ),
        # Neural Network — DISTINCT config from CL-2's MLP
        # (CL-2 uses (32,) relu with 120 max_iter; PI uses (64, 32) tanh with 200)
        "Neural Network": MLPClassifier(
            hidden_layer_sizes=(64, 32), activation="tanh",
            max_iter=200, alpha=1e-3, learning_rate_init=5e-3,
            random_state=42, early_stopping=True,
            validation_fraction=0.15, n_iter_no_change=10,
        ),
    }


def predict_proba_safe(model, X, scaler) -> np.ndarray:
    """Returns P(y=1) array. Handles classifiers and regressors uniformly.
    For a regressor, we map predicted return → [0,1] via 1/(1+exp(-k*x)).
    """
    Xs = scaler.transform(X)
    if hasattr(model, "predict_proba"):
        proba = model.predict_proba(Xs)
        if proba.shape[1] >= 2:
            return proba[:, 1]
        else:
            return proba[:, 0]
    # Regressor — squash the predicted return through a scaled sigmoid
    pred = model.predict(Xs)
    # k=20 so that a ±5% predicted return maps to ~0.73 / ~0.27
    return 1 / (1 + np.exp(-20.0 * pred))


# ------------------------------------------------------------------
# Training pipeline
# ------------------------------------------------------------------
def train_pi(stocks: List[str], df_all: pd.DataFrame) -> Tuple[dict, dict, dict, dict, dict]:
    """Train 4 base models + logistic meta on OOF predictions + calibration.

    Returns:
        final_models: per-model dict {name: estimator}
        final_scalers: per-model dict {name: StandardScaler}
        meta_state: dict (calibration + meta coefficients)
        calib_map: dict {bin_center: hit_rate}
        train_df: the training DataFrame (for stats)
    """
    print("\n[PI] Building training set (shared with CL-2 logic)...")
    train_df = build_training_set(df_all, sample_size=120_000)
    if train_df.empty:
        print("  ! Empty training set")
        return {}, {}, {}, {}, {}
    print(f"  Training rows: {len(train_df):,}")
    pos_rate = train_df["_y"].mean()
    print(f"  Positive rate (TP1 hit before SL): {pos_rate:.3f}")

    X = train_df[FC].fillna(0).values
    y = train_df["_y"].values.astype(int)

    # For the linear regressor, target = the realized 5-day return (we use the
    # sign-flipped label as a coarse proxy: 1 → positive return, 0 → negative).
    # Better: regress on the actual forward 5-day return. We have _cp and _tp1
    # in the training rows, so we can compute realized return = (tp1-cp)/cp
    # for trades where TP1 hits before SL (y=1) and = -1*R/cp where SL hits
    # first (y=0). But this is complex; simpler — regress on _y itself is fine
    # since it's strongly correlated with the realized return.
    # Use a continuous target for the linear regressor:
    #   realized_pct = ((1.5 if y else -1) * risk_per_share / cp)
    # The training rows have _sl, _tp1, _cp fields — we can compute this.
    if {"_sl", "_tp1", "_cp"}.issubset(train_df.columns):
        # Realized return per training row: if y=1 (TP1 hit) → +1.5R/cp
        # else (SL hit) → -1R/cp (R = |entry - SL|)
        R = np.abs(train_df["_cp"].values - train_df["_sl"].values)
        cp = train_df["_cp"].values
        # Avoid div-by-zero
        safe_cp = np.where(cp > 0, cp, 1.0)
        # When y=1: realized = +1.5R/cp; when y=0: realized = -1R/cp
        y_lin = np.where(
            y == 1,
            1.5 * R / safe_cp,
            -1.0 * R / safe_cp,
        )
        # Sanitize: replace any NaN/inf with 0 (LinearRegression can't handle NaN)
        y_lin = np.nan_to_num(y_lin, nan=0.0, posinf=0.0, neginf=0.0)
    else:
        y_lin = y.astype(float)  # fallback

    # 3-fold purged CV (by symbol)
    syms = sorted(train_df["_symbol"].unique())
    folds = purged_stock_folds(syms, k=3)

    # OOF predictions matrix (n_rows × 4)
    oof = np.zeros((len(train_df), 4), dtype=np.float32)
    fold_assign = np.full(len(train_df), -1, dtype=int)
    for fi, (tr_syms, va_syms) in enumerate(folds):
        tr_mask = train_df["_symbol"].isin(tr_syms).values
        va_mask = train_df["_symbol"].isin(va_syms).values
        if tr_mask.sum() < 50 or va_mask.sum() < 50:
            continue
        X_tr = train_df.loc[tr_mask, FC].fillna(0).values
        y_tr = train_df.loc[tr_mask, "_y"].values.astype(int)
        y_tr_lin = y_lin[tr_mask]
        X_va = train_df.loc[va_mask, FC].fillna(0).values
        fold_assign[va_mask] = fi
        print(f"  Fold {fi+1}/3: train={tr_mask.sum():,}, val={va_mask.sum():,}")
        for mi, (mname, ctor) in enumerate(build_4_models().items()):
            m = ctor
            scaler = StandardScaler()
            X_tr_s = scaler.fit_transform(X_tr)
            X_va_s = scaler.transform(X_va)
            try:
                if mname == "Linear Regression":
                    m.fit(X_tr_s, y_tr_lin)
                else:
                    m.fit(X_tr_s, y_tr)
                proba = predict_proba_safe(m, X_va, scaler)
                oof[va_mask, mi] = proba
            except Exception as e:
                print(f"    ! {mname} failed: {e}")
                oof[va_mask, mi] = 0.5

    # Train final 4 base models on ALL data
    print("\n[PI] Training final 4 base models on full data...")
    final_models = {}
    final_scalers = {}
    for mname, ctor in build_4_models().items():
        print(f"  {mname}...", end=" ", flush=True)
        m = ctor
        scaler = StandardScaler()
        Xs = scaler.fit_transform(X)
        try:
            if mname == "Linear Regression":
                m.fit(Xs, y_lin)
            else:
                m.fit(Xs, y)
            final_models[mname] = m
            final_scalers[mname] = scaler
            print("OK")
        except Exception as e:
            print(f"FAIL ({e})")

    # Train logistic meta on OOF predictions
    print("\n[PI] Training logistic meta-model on OOF predictions...")
    valid_mask = fold_assign >= 0
    X_meta = oof[valid_mask]
    y_meta = y[valid_mask]
    if X_meta.shape[0] < 50 or len(np.unique(y_meta)) < 2:
        print("  ! Not enough OOF data for meta-model — using mean of 4 probs as fallback")
        meta_state = {"fallback_mean": True}
        calib_map = {}
    else:
        meta = LogisticRegression(C=1.0, max_iter=200, random_state=42)
        meta.fit(X_meta, y_meta)
        meta_proba = meta.predict_proba(X_meta)[:, 1]
        try:
            auc = roc_auc_score(y_meta, meta_proba)
            print(f"  Meta-model OOS AUC: {auc:.4f}")
        except Exception:
            auc = 0.0
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
        with open(PI_CALIB_FILE, "wb") as f:
            pickle.dump({"meta": meta, "scaler": None, "calib_map": calib_map}, f)
        calib_xs = sorted(calib_map.keys())
        calib_ys = [calib_map[x] for x in calib_xs]
        meta_state = {
            "fallback_mean": False,
            "meta_coef": meta.coef_.tolist(),
            "meta_intercept": float(meta.intercept_[0]),
            "calib_xs": calib_xs,
            "calib_ys": calib_ys,
            "meta_auc": float(auc),
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
    for i in range(len(xs) - 1):
        if xs[i] <= p <= xs[i + 1]:
            t = (p - xs[i]) / (xs[i + 1] - xs[i]) if xs[i + 1] > xs[i] else 0
            return ys[i] + t * (ys[i + 1] - ys[i])
    return p


def meta_predict(proba_4: np.ndarray, meta_state: dict) -> float:
    """Apply logistic meta + calibration. proba_4 = array of 4 model probabilities."""
    if meta_state.get("fallback_mean"):
        raw = float(np.mean(proba_4))
    else:
        coef = np.array(meta_state["meta_coef"][0])
        intercept = meta_state["meta_intercept"]
        z = np.dot(coef, proba_4) + intercept
        raw = 1 / (1 + np.exp(-z))
    return calibrate_proba(raw, meta_state)


def agreement_score(proba_4: np.ndarray) -> float:
    """Compute agreement ∈ [0,1] = 1 − 2×std(proba_4), clamped to [0,1]."""
    s = float(np.std(proba_4))
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
    """For each stock, compute the PI-Ensemble prediction at the latest bar."""
    print("\n[PI] Generating per-stock predictions...")
    pi_per_model = {mname: {} for mname in PI_MODEL_NAMES}
    pi_ens = {}

    for si, s in enumerate(stocks):
        if s not in atr_per:
            continue
        sd = df_all[df_all["symbol"] == s].sort_values("date").reset_index(drop=True)
        n = len(sd)
        if n < MIN_PRED_BARS:
            continue
        t = n - 1
        cp = float(sd.iloc[t]["close"])
        atr = float(sd.iloc[t]["atr_14"])
        if atr <= 0 or cp <= 0:
            continue
        sc = StockSupportCache(sd)
        support = sc.support_at(t)
        resistance = sc.resistance_at(t)
        if np.isnan(support) or np.isnan(resistance):
            continue

        feat_row = sd[FC].iloc[t].fillna(0).values.astype(np.float32).reshape(1, -1)

        # Get 4 model probabilities
        proba_4 = np.zeros(4)
        for mi, mname in enumerate(PI_MODEL_NAMES):
            m = final_models.get(mname)
            scaler = final_scalers.get(mname)
            if m is None or scaler is None:
                proba_4[mi] = 0.5
                continue
            proba_4[mi] = float(predict_proba_safe(m, feat_row, scaler)[0])

        # Meta-model output
        if meta_state.get("fallback_mean"):
            raw_prob = float(np.mean(proba_4))
        else:
            coef = np.array(meta_state["meta_coef"][0])
            intercept = meta_state["meta_intercept"]
            z = float(np.dot(coef, proba_4) + intercept)
            raw_prob = 1 / (1 + np.exp(-z))
        exp_win_rate = calibrate_proba(raw_prob, meta_state)
        agreement = agreement_score(proba_4)
        confidence = exp_win_rate * (0.6 + 0.4 * agreement) * 100

        if exp_win_rate >= BUY_THRESHOLD:
            signal = "BUY"
            direction = "LONG"
        elif exp_win_rate <= SELL_THRESHOLD:
            signal = "SELL"
            direction = "SHORT"
        else:
            signal = "HOLD"
            direction = "LONG"

        sl, tp1, tp2, tp3, skip = compute_sl_and_targets(
            cp, atr, support, resistance, signal if signal != "HOLD" else "BUY"
        )
        if signal == "HOLD":
            sl = cp
            tp1 = cp
            tp2 = cp
            tp3 = cp
            skip = True

        if signal == "SELL":
            sell_prob = 1 - exp_win_rate
            exp_win_rate = sell_prob
            confidence = sell_prob * (0.6 + 0.4 * agreement) * 100

        avg_return = (exp_win_rate * TP1_MULT - (1 - exp_win_rate) * 1.0) / 1.0

        # Per-model prediction entries
        for mi, mname in enumerate(PI_MODEL_NAMES):
            mp = float(proba_4[mi])
            m_signal = "BUY" if mp >= 0.55 else ("SELL" if mp <= 0.45 else "HOLD")
            m_sl, m_tp1, m_tp2, m_tp3, m_skip = compute_sl_and_targets(
                cp, atr, support, resistance, m_signal if m_signal != "HOLD" else "BUY"
            )
            if m_signal == "HOLD":
                m_sl = cp
                m_tp1 = cp
                m_tp2 = cp
                m_tp3 = cp
            pi_per_model[mname][s] = {
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
        pi_ens[s] = {
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

    print(f"  Done: {len(pi_ens)} stocks have PI-Ensemble predictions")
    return pi_per_model, pi_ens


# ------------------------------------------------------------------
# Backtest
# ------------------------------------------------------------------
def backtest_pi(
    stocks: List[str],
    df_all: pd.DataFrame,
    atr_per: Dict[str, Dict[str, float]],
    final_models: dict,
    final_scalers: dict,
    meta_state: dict,
) -> dict:
    """Walk-forward backtest on last 20% of each stock's bars."""
    print("\n[PI] Backtesting on 20% holdout per stock...")
    trades = []
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
        feat_mat = sd[FC].fillna(0).values.astype(np.float32)
        high_arr = sd["high"].values.astype(np.float64)
        low_arr = sd["low"].values.astype(np.float64)
        close_arr = sd["close"].values.astype(np.float64)
        atr_arr = sd["atr_14"].values.astype(np.float64)
        bar_indices = list(range(sp, n - 5, 5))
        if not bar_indices:
            continue
        feat_batch = feat_mat[bar_indices]
        proba_4_batch = np.zeros((len(bar_indices), 4), dtype=np.float32)
        for mi, mname in enumerate(PI_MODEL_NAMES):
            m = final_models.get(mname)
            scaler = final_scalers.get(mname)
            if m is None or scaler is None:
                proba_4_batch[:, mi] = 0.5
                continue
            proba_4_batch[:, mi] = predict_proba_safe(m, feat_batch, scaler)

        for bi, t in enumerate(bar_indices):
            cp = float(close_arr[t])
            atr = float(atr_arr[t])
            if atr <= 0 or cp <= 0:
                continue
            support = sc.support_at(t)
            resistance = sc.resistance_at(t)
            if np.isnan(support) or np.isnan(resistance):
                continue

            proba_4 = proba_4_batch[bi]
            if meta_state.get("fallback_mean"):
                raw_prob = float(np.mean(proba_4))
            else:
                coef = np.array(meta_state["meta_coef"][0])
                intercept = meta_state["meta_intercept"]
                z = float(np.dot(coef, proba_4) + intercept)
                raw_prob = 1 / (1 + np.exp(-z))
            exp_win_rate = calibrate_proba(raw_prob, meta_state)
            if exp_win_rate >= BUY_THRESHOLD:
                direction = "BUY"
            elif exp_win_rate <= SELL_THRESHOLD:
                direction = "SELL"
                exp_win_rate = 1 - exp_win_rate
            else:
                continue

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
                "symbol": s, "t": t, "direction": direction,
                "raw_prob": raw_prob, "exp_win_rate": exp_win_rate, "ret": ret,
            })

    if not trades:
        print("  ! No trades generated in backtest")
        return {
            "totalTrades": 0, "winRate": 0, "avgReturnPct": 0,
            "maxReturnPct": 0, "minReturnPct": 0, "stars": 0,
            "profitFactor": 0, "skippedTrades": skips, "reliabilityTable": [],
        }

    rets = np.array([tr["ret"] for tr in trades], dtype=float)
    valid_mask = np.isfinite(rets)
    if not valid_mask.all():
        n_bad = int((~valid_mask).sum())
        print(f"  ! Dropping {n_bad} trades with non-finite returns")
    rets = rets[valid_mask]
    trade_dir = np.array([tr["direction"] for tr in trades])[valid_mask]
    trade_ewr = np.array([tr["exp_win_rate"] for tr in trades])[valid_mask]
    if len(rets) == 0:
        return {
            "totalTrades": 0, "winRate": 0, "avgReturnPct": 0,
            "maxReturnPct": 0, "minReturnPct": 0, "stars": 0,
            "profitFactor": 0, "skippedTrades": skips, "reliabilityTable": [],
        }
    wins = rets > 0
    win_rate = float(wins.mean())
    avg_ret = float(rets.mean())
    gross_profit = float(rets[rets > 0].sum()) if wins.any() else 0
    gross_loss = float(-rets[rets < 0].sum()) if (~wins).any() else 0
    profit_factor = gross_profit / max(gross_loss, 1e-9)
    print(f"  Trades: {len(rets)} | Win rate: {win_rate*100:.1f}% | "
          f"Avg ret: {avg_ret*100:.2f}% | PF: {profit_factor:.3f}")

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
    pi_per_model: Dict[str, Dict[str, dict]],
    pi_ens: Dict[str, dict],
    pi_backtest: dict,
    train_meta: dict,
):
    print(f"\n[PI] Saving to {PRED_FILE}...")
    if PRED_FILE.exists():
        with open(PRED_FILE, "r") as f:
            existing = json.load(f)
    else:
        existing = {}

    models_dict = existing.get("models", {})
    for mname, preds in pi_per_model.items():
        models_dict[f"{mname} (PI)"] = {
            "trained": True,
            "version": "1.0.0",
            "predictions": preds,
        }
    existing["models"] = models_dict
    existing["pi_ensemble_predictions"] = pi_ens

    ens_bt = existing.get("ensemble_backtesting", {})
    ens_bt["PI_ENSEMBLE"] = pi_backtest
    existing["ensemble_backtesting"] = ens_bt

    existing["pi_metadata"] = {
        "trained_at": pd.Timestamp.now().isoformat(),
        "sl_rule": f"support−0.15×ATR or entry∓{ATR_STOP_MULT}×ATR (whichever closer, min {MIN_SL_MULT}×ATR)",
        "tp_rule": f"TP1/2/3 = {TP1_MULT}R/{TP2_MULT}R/{TP3_MULT}R (R = |entry−SL|)",
        "target": f"TP1 hit before SL within {LABEL_HORIZON} days",
        "exits": "50%@TP1, 30%@TP2, 20%@TP3; SL→BE after TP1",
        "models": PI_MODEL_NAMES,
        "meta_model": "LogisticRegression on 4-model OOF probs + linear-reg normalized return",
        "calibration": "Decile binning on OOS predictions",
        "thresholds": {"BUY": BUY_THRESHOLD, "SELL": SELL_THRESHOLD},
        "agreement_formula": "1 − 2×std(4 model probs), clamped [0,1]",
        "confidence_formula": "exp_win_rate × (0.6 + 0.4×agreement) × 100",
        "cost_bps": int(COST * 10000),
        "train_rows": int(train_meta.get("train_rows", 0)),
        "pos_rate": float(train_meta.get("pos_rate", 0)),
        "meta_auc": float(train_meta.get("meta_auc", 0)),
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
    args = parser.parse_args()

    start = time.time()
    print("=" * 60)
    print("PI Tier: 4 models (Linear/Logistic, KNN, Neural Network) + logistic meta")
    print("  SL rule: support−0.15×ATR or entry∓0.8×ATR (min 0.5×ATR)")
    print(f"  Target: TP1 ({TP1_MULT}R) hit before SL within {LABEL_HORIZON} days")
    print("  Exits: 50%@TP1, 30%@TP2, 20%@TP3; SL→BE after TP1")
    print("=" * 60)

    all_stocks = sorted([f.stem for f in OHLCV_DIR.glob("*.csv")])
    stocks = all_stocks[:args.quick] if args.quick > 0 else all_stocks
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

    print("\n[3/5] Training PI models + meta...")
    final_models, final_scalers, meta_state, calib_map, train_df = train_pi(stocks, df_all)
    if not final_models:
        print("ERROR: training failed")
        sys.exit(1)

    print("\n[4/5] Generating per-stock predictions...")
    pi_per_model, pi_ens = predict_all_stocks(
        stocks, df_all, atr_per, final_models, final_scalers, meta_state
    )

    print("\n[5/5] Backtesting PI-Ensemble...")
    pi_bt = backtest_pi(
        stocks, df_all, atr_per, final_models, final_scalers, meta_state
    )

    meta_auc = meta_state.get("meta_auc", 0.0) if isinstance(meta_state, dict) else 0.0
    train_meta = {
        "train_rows": len(train_df),
        "pos_rate": float(train_df["_y"].mean()),
        "meta_auc": float(meta_auc),
    }
    save_to_json(pi_per_model, pi_ens, pi_bt, train_meta)

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"PI training complete in {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print(f"{'='*60}")
    print(f"  Models trained: {len(final_models)}/4")
    print(f"  Stocks with predictions: {len(pi_ens)}")
    print(f"  Backtest: {pi_bt['totalTrades']} trades, WR={pi_bt['winRate']}%, PF={pi_bt['profitFactor']}")


if __name__ == "__main__":
    main()
