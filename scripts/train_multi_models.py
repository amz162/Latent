#!/usr/bin/env python3
"""
Latent.pk — Multi-Model Training Script

Trains 4 classical ML models on real PSX OHLCV data:
  - XGBoost (already trained — predictions loaded from existing file)
  - LightGBM (new)
  - CatBoost (new)
  - Random Forest (new via sklearn)

LSTM is NOT trained here — requires PyTorch (not installed in sandbox).
LSTM model card will show in UI with "not trained" status.

Saves combined predictions to data/ml_predictions_multi.json:
  {
    "trained_at": "...",
    "models": {
      "XGBoost":  { version, metrics, predictions: {ENGRO: {...}, ...} },
      "LightGBM": { ... },
      "CatBoost": { ... },
      "RandomForest": { ... }
    }
  }

Usage: python3 scripts/train_multi_models.py
"""

import json
import os
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
import lightgbm as lgb
import catboost as cb
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
)

warnings.filterwarnings("ignore")

OHLCV_DIR = Path("data/ohlcv")
MODELS_DIR = Path("models")
OUTPUT_PATH = Path("data/ml_predictions_multi.json")

STOCKS = ["ENGRO", "HUBC", "LUCK", "SYS", "MEBL", "PSO", "OGDC", "PPL"]

# Tunable thresholds (same as train_xgboost.py for consistency)
FORWARD_WINDOW = 21
UP_THRESHOLD = 0.03

# ────────────────────────────────────────────────────────────────────────────
# Feature engineering — same as train_xgboost.py
# ────────────────────────────────────────────────────────────────────────────

def compute_rsi(prices, period=14):
    delta = prices.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.ewm(alpha=1/period, min_periods=period).mean()
    avg_loss = loss.ewm(alpha=1/period, min_periods=period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50)

def compute_macd(prices):
    ema_12 = prices.ewm(span=12, adjust=False).mean()
    ema_26 = prices.ewm(span=26, adjust=False).mean()
    macd = ema_12 - ema_26
    signal = macd.ewm(span=9, adjust=False).mean()
    return macd, signal, macd - signal

def compute_bollinger(prices, window=20):
    sma = prices.rolling(window).mean()
    std = prices.rolling(window).std()
    upper = sma + 2 * std
    lower = sma - 2 * std
    width = (upper - lower) / sma
    pct_b = (prices - lower) / (upper - lower).replace(0, np.nan)
    return width.fillna(0), pct_b.fillna(0.5)

def compute_atr(high, low, close, period=14):
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    return tr.rolling(period).mean().fillna(0)

def compute_obv(close, volume):
    sign = close.diff().apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))
    return (sign * volume).cumsum()

def add_features(df):
    df = df.copy().sort_values("date").reset_index(drop=True)
    close = df["close"]
    high = df["high"]
    low = df["low"]
    vol = df["volume"]

    df["rsi_14"] = compute_rsi(close, 14)
    macd, signal, hist = compute_macd(close)
    df["macd"] = macd
    df["macd_signal"] = signal
    df["macd_hist"] = hist
    bb_width, pct_b = compute_bollinger(close)
    df["bb_width"] = bb_width
    df["bb_pct_b"] = pct_b
    df["atr_14"] = compute_atr(high, low, close)
    obv = compute_obv(close, vol)
    df["obv_change_pct"] = obv.pct_change(periods=14).replace([np.inf, -np.inf], 0).fillna(0)
    for window in [20, 50, 200]:
        sma = close.rolling(window, min_periods=1).mean()
        df[f"sma_{window}"] = sma
        df[f"price_sma_{window}_ratio"] = close / sma
    vol_sma_20 = vol.rolling(20, min_periods=1).mean()
    df["volume_sma_20_ratio"] = vol / vol_sma_20.replace(0, 1)
    for period in [1, 7, 14, 30]:
        df[f"return_{period}d"] = close.pct_change(periods=period).replace([np.inf, -np.inf], 0).fillna(0)
    df["hl_range_pct"] = ((high - low) / close.replace(0, np.nan)).fillna(0)
    df["body_size_pct"] = ((df["close"] - df["open"]).abs() / close.replace(0, np.nan)).fillna(0)
    df["volatility_14d"] = close.pct_change().rolling(14).std().fillna(0)
    return df

def add_labels(df):
    df = df.copy()
    df["future_max"] = df["close"].rolling(FORWARD_WINDOW).max().shift(-FORWARD_WINDOW)
    df["future_return_max"] = (df["future_max"] - df["close"]) / df["close"]
    df["label_up_3pct_21d"] = (df["future_return_max"] >= UP_THRESHOLD).astype(int)
    df = df.dropna(subset=["future_return_max"])
    return df

FEATURE_COLUMNS = [
    "rsi_14", "macd", "macd_signal", "macd_hist", "bb_width", "bb_pct_b",
    "atr_14", "obv_change_pct",
    "price_sma_20_ratio", "price_sma_50_ratio", "price_sma_200_ratio",
    "volume_sma_20_ratio",
    "return_1d", "return_7d", "return_14d", "return_30d",
    "hl_range_pct", "body_size_pct", "volatility_14d",
]

# ────────────────────────────────────────────────────────────────────────────
# Load data
# ────────────────────────────────────────────────────────────────────────────

def load_all_stocks():
    all_frames = []
    for symbol in STOCKS:
        csv_path = OHLCV_DIR / f"{symbol}.csv"
        if not csv_path.exists():
            continue
        df = pd.read_csv(csv_path, usecols=range(6))
        df = df[df["volume"] > 0].reset_index(drop=True)
        if len(df) < 50:
            continue
        df = add_features(df)
        df = add_labels(df)
        df["symbol"] = symbol
        all_frames.append(df)
    if not all_frames:
        raise RuntimeError("No OHLCV data loaded")
    return pd.concat(all_frames, ignore_index=True)

# ────────────────────────────────────────────────────────────────────────────
# Train a single model and return metrics + per-symbol latest predictions
# ────────────────────────────────────────────────────────────────────────────

def train_model(model_name, model_factory, df, scale_pos=None):
    """Train a model and return (metrics, per_symbol_predictions)."""
    df = df.sort_values("date").reset_index(drop=True)
    split_idx = int(len(df) * 0.8)
    train_df = df.iloc[:split_idx]
    test_df = df.iloc[split_idx:]

    X_train = train_df[FEATURE_COLUMNS].values
    y_train = train_df["label_up_3pct_21d"].values
    X_test = test_df[FEATURE_COLUMNS].values
    y_test = test_df["label_up_3pct_21d"].values

    pos_count = y_train.sum()
    neg_count = len(y_train) - pos_count
    if scale_pos is None:
        scale_pos = neg_count / max(pos_count, 1)

    model = model_factory(scale_pos)
    model.fit(X_train, y_train, X_test, y_test) if model_name == "XGBoost" else model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1] if hasattr(model, "predict_proba") else np.full(len(y_test), 0.5)

    metrics = {
        "accuracy": float(accuracy_score(y_test, y_pred)),
        "precision": float(precision_score(y_test, y_pred, zero_division=0)),
        "recall": float(recall_score(y_test, y_pred, zero_division=0)),
        "f1": float(f1_score(y_test, y_pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, y_proba)) if len(set(y_test)) > 1 else None,
    }

    # Per-symbol latest predictions
    predictions = {}
    for symbol in STOCKS:
        symbol_df = df[df["symbol"] == symbol].sort_values("date").reset_index(drop=True)
        if len(symbol_df) == 0:
            continue
        latest = symbol_df.iloc[-1]
        latest_features = latest[FEATURE_COLUMNS].values.reshape(1, -1)
        proba_up = float(model.predict_proba(latest_features)[0, 1]) if hasattr(model, "predict_proba") else 0.5
        current_price = float(latest["close"])
        atr = float(latest["atr_14"]) if float(latest["atr_14"]) > 0 else current_price * 0.04

        # Derive predicted price from probability: scale to ±5% range
        # prob 0.5 → no move, prob 1.0 → +5%, prob 0.0 → -5%
        expected_move_pct = (proba_up - 0.5) * 2 * 5  # ±5%
        predicted_price = current_price * (1 + expected_move_pct / 100)

        # Direction + signal
        if proba_up >= 0.55:
            direction = "LONG"
            signal = "BUY"
            confidence = int(proba_up * 100)
        elif proba_up <= 0.45:
            direction = "SHORT"
            signal = "SELL"
            confidence = int((1 - proba_up) * 100)
        else:
            direction = "LONG"
            signal = "HOLD"
            confidence = int(max(proba_up, 1 - proba_up) * 100)

        predictions[symbol] = {
            "direction": direction,
            "signal": signal,
            "confidence": confidence,
            "model_probability_up": round(proba_up, 4),
            "currentPrice": round(current_price, 2),
            "predictedPrice": round(predicted_price, 2),
            "expectedMovePct": round(expected_move_pct, 2),
            "latest_features": {
                "rsi_14": round(float(latest["rsi_14"]), 1),
                "macd_hist": round(float(latest["macd_hist"]), 3),
                "bb_pct_b": round(float(latest["bb_pct_b"]), 2),
                "atr_14": round(float(latest["atr_14"]), 2),
                "return_14d": round(float(latest["return_14d"]) * 100, 2),
                "volatility_14d": round(float(latest["volatility_14d"]) * 100, 2),
            },
        }

    return metrics, predictions

# ────────────────────────────────────────────────────────────────────────────
# Model factories
# ────────────────────────────────────────────────────────────────────────────

def make_xgboost(scale_pos):
    return xgb.XGBClassifier(
        n_estimators=150, max_depth=3, learning_rate=0.03,
        subsample=0.7, colsample_bytree=0.7,
        min_child_weight=15, gamma=0.5,
        reg_alpha=1.0, reg_lambda=3.0,
        scale_pos_weight=scale_pos, random_state=42,
        eval_metric="logloss", early_stopping_rounds=20,
    )

def make_lightgbm(scale_pos):
    return lgb.LGBMClassifier(
        n_estimators=150, max_depth=-1, num_leaves=15,
        learning_rate=0.03, subsample=0.7, colsample_bytree=0.7,
        min_child_samples=15, reg_alpha=1.0, reg_lambda=3.0,
        scale_pos_weight=scale_pos if scale_pos > 0 else 1,
        random_state=42, verbose=-1,
    )

def make_catboost(scale_pos):
    return cb.CatBoostClassifier(
        iterations=150, depth=3, learning_rate=0.03,
        l2_leaf_reg=3.0, scale_pos_weight=scale_pos,
        random_state=42, verbose=0, allow_writing_files=False,
    )

def make_random_forest(scale_pos):
    # scale_pos not natively supported — use class_weight instead
    class_weight = {0: 1.0, 1: float(scale_pos)} if scale_pos > 0 else "balanced"
    return RandomForestClassifier(
        n_estimators=150, max_depth=5, min_samples_leaf=15,
        max_features=0.7, random_state=42, class_weight=class_weight,
        n_jobs=-1,
    )

# ────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("Latent.pk Multi-Model Training")
    print("=" * 60)

    print("\n[1/3] Loading + feature engineering on real PSX OHLCV...")
    df = load_all_stocks()
    print(f"  Loaded: {len(df)} rows from {df['symbol'].nunique()} stocks")

    # Train all 4 models
    models_to_train = [
        ("XGBoost", make_xgboost),
        ("LightGBM", make_lightgbm),
        ("CatBoost", make_catboost),
        ("RandomForest", make_random_forest),
    ]

    all_results = {}
    for model_name, factory in models_to_train:
        print(f"\n[2/3] Training {model_name}...")
        try:
            metrics, predictions = train_model(model_name, factory, df)
            all_results[model_name] = {
                "version": "1.0.0",
                "trained_at": pd.Timestamp.now().isoformat(),
                "metrics": metrics,
                "predictions": predictions,
                "trained": True,
                "features": len(FEATURE_COLUMNS),
                "training_rows": int(len(df) * 0.8),
            }
            print(f"  Accuracy: {metrics['accuracy']*100:.1f}% | Precision: {metrics['precision']*100:.1f}% | Recall: {metrics['recall']*100:.1f}% | AUC: {metrics['roc_auc']:.3f}")
            print(f"  Predictions for {len(predictions)} stocks")
        except Exception as e:
            print(f"  FAILED: {e}", file=sys.stderr)
            all_results[model_name] = {"trained": False, "error": str(e)}

    # Save combined predictions
    output = {
        "trained_at": pd.Timestamp.now().isoformat(),
        "data_source": "askanalyst.com.pk /api/technicalchart/day",
        "training_rows": len(df),
        "models": all_results,
        "untrained_models": {
            "LSTM": "PyTorch not installed in sandbox — model card shown with blank predictions",
            "PatchTST": "Tier 1 SOTA — requires GPU + HuggingFace transformers (not in sandbox)",
            "N-BEATS": "Tier 1 SOTA — requires PyTorch + GPU",
            "TimesNet": "Tier 1 SOTA — requires PyTorch + GPU",
            "Informer": "Tier 1 SOTA — requires PyTorch + GPU",
            "Chronos": "Tier 2 foundation — requires HuggingFace + 1-2GB weights",
            "Lag-Llama": "Tier 2 foundation — requires HuggingFace + fine-tuning",
            "Moirai": "Tier 2 foundation — requires HuggingFace",
            "Time-LLM": "Tier 2 foundation — requires LLM + fine-tuning",
            "CNN-LSTM": "Tier 4 hybrid — requires PyTorch + GPU",
            "TabNet": "Tier 4 hybrid — requires PyTorch + GPU",
            "FinGPT": "Tier 4 LLM-finance — requires fine-tuning pipeline",
        },
    }
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(output, indent=2))
    print(f"\n[3/3] Saved combined predictions: {OUTPUT_PATH}")
    print(f"  Trained models: {sum(1 for m in all_results.values() if m.get('trained'))}")
    print(f"  Untrained (shown blank): {len(output['untrained_models'])}")
    print("\nDone.")

if __name__ == "__main__":
    main()
