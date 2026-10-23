#!/usr/bin/env python3
"""Latent.pk — Train meta-ensembles + comprehensive backtest of ALL models.

Loads all 52 trained models' predictions, computes 3 voting ensembles + 1 stacking ensemble,
backtests each individual model + each ensemble, saves report.
"""
import sys, os, json, warnings, time, gc
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score

warnings.filterwarnings("ignore")

OHLCV = Path("data/ohlcv_all")
PRED_FILE = Path("data/ml_predictions_multi.json")
REPORT_FILE = Path("data/backtest_report.json")
STOCKS = sorted([p.stem for p in OHLCV.glob("*.csv")])
MAX_ROWS_PER_STOCK = 180
TEST_FRACTION = 0.20
COST_BPS = 50
HOLDING_DAYS = 21

TIER_WEIGHTS = {
    "TIER_1": 0.30, "TIER_2": 0.20, "TIER_3": 0.25, "TIER_4": 0.10,
    "TIER_CL": 0.15, "TIER_CL_2": 0.20, "TIER_PI": 0.20, "TIER_GM": 0.20,
    "TIER_CG": 0.20, "TIER_X": 0.20, "TIER_GIAN": 0.20,
}
MODEL_TIER = {
    "PatchTST": "TIER_1", "N-BEATS": "TIER_1", "TimesNet": "TIER_1", "Informer": "TIER_1",
    "Chronos (Amazon)": "TIER_2", "Lag-Llama": "TIER_2", "Moirai (Salesforce)": "TIER_2", "Time-LLM": "TIER_2",
    "XGBoost": "TIER_3", "LightGBM": "TIER_3", "CatBoost": "TIER_3", "Random Forest": "TIER_3", "LSTM": "TIER_3",
    "CNN-LSTM": "TIER_4", "Transformer-LSTM": "TIER_4",
    "ARIMA": "TIER_CL", "Holt-Winters": "TIER_CL", "GARCH": "TIER_CL", "Ridge Regression": "TIER_CL",
    "Kalman Filter": "TIER_CL", "Prophet": "TIER_CL", "GRU": "TIER_CL",
    "XGBoost (CL)": "TIER_CL", "LightGBM (CL)": "TIER_CL", "Random Forest (CL)": "TIER_CL", "LSTM (CL)": "TIER_CL",
    "LightGBM-A (CL-2)": "TIER_CL_2", "LightGBM-B (CL-2)": "TIER_CL_2", "HistGBM (CL-2)": "TIER_CL_2",
    "ExtraTrees (CL-2)": "TIER_CL_2", "RandomForest (CL-2)": "TIER_CL_2", "Logistic (CL-2)": "TIER_CL_2", "MLP (CL-2)": "TIER_CL_2",
    "Linear Regression (PI)": "TIER_PI", "Logistic Regression (PI)": "TIER_PI",
    "Pattern Matcher KNN (PI)": "TIER_PI", "Neural Network (PI)": "TIER_PI",
    "Technical Engine (GM)": "TIER_GM", "Announcements Engine (GM)": "TIER_GM",
    "Fundamental Engine (GM)": "TIER_GM", "Macro Engine (GM)": "TIER_GM",
    "LightGBM (CG)": "TIER_CG", "XGBoost (CG)": "TIER_CG",
    "Trend Multi-TF (X)": "TIER_X", "Breakout RelVol (X)": "TIER_X", "Trend Pullback (X)": "TIER_X",
    "RSI Divergence (X)": "TIER_X", "BB Mean Reversion (X)": "TIER_X", "Vol Contraction (X)": "TIER_X",
    "Relative Strength (X)": "TIER_X", "Market Regime (X)": "TIER_X", "Meta-Label CG (X)": "TIER_X",
    "Triple Barrier Dyn (X)": "TIER_X",
    "Gian-Ensemble (GIAN)": "TIER_GIAN", "Gian-Extender (GIAN-EXT)": "TIER_GIAN", "M-Ensemble (M)": "TIER_GIAN",
}

def load_stock_data():
    stocks_data = {}
    for s in STOCKS:
        p = OHLCV / f"{s}.csv"
        if not p.exists(): continue
        try:
            df = pd.read_csv(p, usecols=range(6))
            df = df[df["volume"] > 0].reset_index(drop=True)
            if len(df) < 50: continue
            if len(df) > MAX_ROWS_PER_STOCK:
                df = df.tail(MAX_ROWS_PER_STOCK).reset_index(drop=True)
            df = df.sort_values("date").reset_index(drop=True)
            split_idx = int(len(df) * (1 - TEST_FRACTION))
            stocks_data[s] = {"train": df.iloc[:split_idx].reset_index(drop=True), "test": df.iloc[split_idx:].reset_index(drop=True), "all": df}
        except Exception: continue
    return stocks_data

def backtest_model(model_preds, stocks_data, cost_bps=COST_BPS, holding_days=HOLDING_DAYS):
    trades = []; n_buy = n_sell = n_hold = 0; n_wins = 0
    for sym, sd in stocks_data.items():
        test = sd["test"]
        if len(test) < holding_days + 1: continue
        pred = model_preds.get(sym)
        if not pred: continue
        sig = pred.get("signal", "HOLD"); d = pred.get("direction", "LONG")
        if sig == "HOLD": n_hold += 1; continue
        if sig == "BUY": n_buy += 1
        elif sig == "SELL": n_sell += 1
        entry_prices = test["close"].values[:-holding_days]
        exit_prices = test["close"].values[holding_days:]
        if sig == "BUY": rets = (exit_prices - entry_prices) / entry_prices
        else: rets = (entry_prices - exit_prices) / entry_prices
        rets = rets - cost_bps / 10000.0
        trades.extend(rets.tolist())
        n_wins += int((rets > 0).sum())
    if not trades:
        return {"trades": 0, "winRate": 0, "avgReturnPct": 0, "profitFactor": 0, "sharpe": 0, "maxDrawdownPct": 0, "n_buy": n_buy, "n_sell": n_sell, "n_hold": n_hold}
    arr = np.array(trades); n_trades = len(arr)
    wins = arr[arr > 0]; losses = arr[arr < 0]
    win_rate = (len(wins) / n_trades) * 100 if n_trades > 0 else 0
    avg_ret = arr.mean() * 100
    pf = wins.sum() / abs(losses.sum()) if len(losses) > 0 and losses.sum() != 0 else (float('inf') if wins.sum() > 0 else 0)
    sharpe = (arr.mean() / arr.std()) * np.sqrt(252) if arr.std() > 0 else 0
    cum = np.cumsum(arr); running_max = np.maximum.accumulate(cum)
    drawdowns = cum - running_max
    max_dd = drawdowns.min() * 100 if len(drawdowns) > 0 else 0
    return {"trades": int(n_trades), "winRate": round(win_rate, 2), "avgReturnPct": round(avg_ret, 4),
            "profitFactor": round(float(pf), 4) if pf != float('inf') else 999.0,
            "sharpe": round(float(sharpe), 4), "maxDrawdownPct": round(float(max_dd), 4),
            "n_buy": n_buy, "n_sell": n_sell, "n_hold": n_hold}

def compute_meta_ensemble_predictions(all_model_preds, method="majority"):
    symbol_models = {}
    for model_name, preds in all_model_preds.items():
        for sym, pred in preds.items():
            if not isinstance(pred, dict): continue
            symbol_models.setdefault(sym, {})[model_name] = pred
    ensemble_preds = {}
    for sym, models in symbol_models.items():
        if len(models) < 5: continue
        if method == "majority":
            buys = sum(1 for p in models.values() if p.get("signal") == "BUY")
            sells = sum(1 for p in models.values() if p.get("signal") == "SELL")
            holds = sum(1 for p in models.values() if p.get("signal") == "HOLD")
            if buys > sells and buys > holds: sig, d = "BUY", "LONG"
            elif sells > buys and sells > holds: sig, d = "SELL", "SHORT"
            else: sig, d = "HOLD", "LONG"
            ars = [p.get("avgReturn", 0) for p in models.values() if p.get("signal") in ("BUY", "SELL")]
            avg_ar = float(np.mean(ars)) if ars else 0
            ref_pred = next((p for p in models.values() if p.get("signal") in ("BUY", "SELL")), list(models.values())[0])
            cp = ref_pred.get("currentPrice", 0)
            conf = int(buys / max(1, len(models)) * 100) if sig == "BUY" else int(sells / max(1, len(models)) * 100) if sig == "SELL" else 0
            ensemble_preds[sym] = {"signal": sig, "direction": d, "confidence": conf, "currentPrice": cp, "entry": ref_pred.get("entry", cp), "tp1": ref_pred.get("tp1", cp*1.02), "tp2": ref_pred.get("tp2", cp*1.04), "tp3": ref_pred.get("tp3", cp*1.06), "sl": ref_pred.get("sl", cp*0.97), "avgReturn": round(avg_ar, 4)}
        elif method == "prob_weighted":
            total_conf = sum(p.get("confidence", 0) for p in models.values())
            if total_conf == 0: total_conf = 1
            wsum_ar = sum(p.get("avgReturn", 0) * p.get("confidence", 0) for p in models.values())
            avg_ar = wsum_ar / total_conf
            if avg_ar > 0.01: sig, d = "BUY", "LONG"
            elif avg_ar < -0.01: sig, d = "SELL", "SHORT"
            else: sig, d = "HOLD", "LONG"
            ref_pred = list(models.values())[0]
            cp = ref_pred.get("currentPrice", 0)
            ensemble_preds[sym] = {"signal": sig, "direction": d, "confidence": min(100, int(abs(avg_ar)*1000)), "currentPrice": cp, "entry": ref_pred.get("entry", cp), "tp1": ref_pred.get("tp1", cp*1.02), "tp2": ref_pred.get("tp2", cp*1.04), "tp3": ref_pred.get("tp3", cp*1.06), "sl": ref_pred.get("sl", cp*0.97), "avgReturn": round(float(avg_ar), 4)}
        elif method == "tier_weighted":
            wsum_ar = 0; wsum_w = 0
            for mn, p in models.items():
                tier = MODEL_TIER.get(mn, "TIER_3")
                w = TIER_WEIGHTS.get(tier, 0.20)
                wsum_ar += p.get("avgReturn", 0) * w
                wsum_w += w
            avg_ar = wsum_ar / wsum_w if wsum_w > 0 else 0
            if avg_ar > 0.01: sig, d = "BUY", "LONG"
            elif avg_ar < -0.01: sig, d = "SELL", "SHORT"
            else: sig, d = "HOLD", "LONG"
            ref_pred = list(models.values())[0]
            cp = ref_pred.get("currentPrice", 0)
            ensemble_preds[sym] = {"signal": sig, "direction": d, "confidence": min(100, int(abs(avg_ar)*1000)), "currentPrice": cp, "entry": ref_pred.get("entry", cp), "tp1": ref_pred.get("tp1", cp*1.02), "tp2": ref_pred.get("tp2", cp*1.04), "tp3": ref_pred.get("tp3", cp*1.06), "sl": ref_pred.get("sl", cp*0.97), "avgReturn": round(float(avg_ar), 4)}
    return ensemble_preds

def build_stacking_ensemble(all_model_preds, stocks_data):
    model_names = sorted(all_model_preds.keys())
    stocks_list = sorted(stocks_data.keys())
    X, y, covered = [], [], []
    for sym in stocks_list:
        test = stocks_data[sym]["test"]
        if len(test) < 21: continue
        entry = test["close"].iloc[0]
        exit_ = test["close"].iloc[min(21, len(test)-1)]
        if entry <= 0: continue
        label = 1 if exit_ > entry else 0
        features = []
        for mn in model_names:
            p = all_model_preds.get(mn, {}).get(sym, {})
            sig = p.get("signal", "HOLD")
            features.extend([1 if sig == "BUY" else -1 if sig == "SELL" else 0, p.get("confidence", 0) / 100.0, p.get("avgReturn", 0)])
        X.append(features); y.append(label); covered.append(sym)
    if len(X) < 100:
        return {}, {"trades": 0, "winRate": 0, "avgReturnPct": 0, "profitFactor": 0, "sharpe": 0, "maxDrawdownPct": 0, "error": f"Only {len(X)} stocks for stacking"}
    X = np.array(X); y = np.array(y)
    split = int(len(X) * 0.5)
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]
    test_stocks = covered[split:]
    print(f"    Stacking: {len(X_train)} train, {len(X_test)} test, {X.shape[1]} features")
    lr = LogisticRegression(max_iter=500, class_weight="balanced")
    lr.fit(X_train, y_train)
    train_acc = accuracy_score(y_train, lr.predict(X_train))
    test_acc = accuracy_score(y_test, lr.predict(X_test))
    print(f"    Stacking train acc: {train_acc*100:.1f}%, test acc: {test_acc*100:.1f}%")
    test_preds = lr.predict(X_test)
    test_probs = lr.predict_proba(X_test)[:, 1]
    stacking_preds = {}
    for i, sym in enumerate(test_stocks):
        prob = float(test_probs[i])
        if prob > 0.55: sig, d = "BUY", "LONG"
        elif prob < 0.45: sig, d = "SELL", "SHORT"
        else: sig, d = "HOLD", "LONG"
        test_df = stocks_data[sym]["test"]
        cp = float(test_df["close"].iloc[0])
        stacking_preds[sym] = {"signal": sig, "direction": d, "confidence": min(100, int(abs(prob - 0.5) * 200)), "currentPrice": round(cp, 2), "entry": round(cp, 2), "tp1": round(cp*1.02, 2), "tp2": round(cp*1.04, 2), "tp3": round(cp*1.06, 2), "sl": round(cp*0.97, 2), "avgReturn": round((prob - 0.5) * 2, 4)}
    test_stocks_data = {sym: stocks_data[sym] for sym in test_stocks}
    return stacking_preds, backtest_model(stacking_preds, test_stocks_data)

def main():
    print(f"\n{'='*70}\nLatent.pk — Meta-Ensemble Training + Comprehensive Backtest\n{'='*70}")
    print(f"Stocks in OHLCV dir: {len(STOCKS)}")
    t0 = time.time()
    print("\n[1/5] Loading predictions file...")
    data = json.loads(PRED_FILE.read_text())
    all_models = data.get("models", {})
    trained_models = {k: v for k, v in all_models.items() if isinstance(v, dict) and v.get("trained")}
    print(f"  Found {len(trained_models)} trained models")
    all_model_preds = {}
    for mn, mi in trained_models.items():
        preds = mi.get("predictions", {})
        if isinstance(preds, dict) and len(preds) > 0:
            all_model_preds[mn] = preds
    print(f"  Models with predictions: {len(all_model_preds)}")
    print("\n[2/5] Loading OHLCV data...")
    stocks_data = load_stock_data()
    print(f"  Loaded {len(stocks_data)} stocks with test data")
    print(f"\n[3/5] Backtesting {len(all_model_preds)} individual models...")
    model_backtests = {}
    for i, (mn, preds) in enumerate(all_model_preds.items()):
        bt = backtest_model(preds, stocks_data)
        model_backtests[mn] = bt
    print(f"\n[4/5] Computing 3 meta-ensembles...")
    meta_ensembles = {
        "META_MAJORITY": compute_meta_ensemble_predictions(all_model_preds, "majority"),
        "META_PROB_WEIGHTED": compute_meta_ensemble_predictions(all_model_preds, "prob_weighted"),
        "META_TIER_WEIGHTED": compute_meta_ensemble_predictions(all_model_preds, "tier_weighted"),
    }
    ensemble_backtests = {}
    for name, preds in meta_ensembles.items():
        ensemble_backtests[name] = backtest_model(preds, stocks_data)
    print(f"\n[5/5] Building STACKING ensemble...")
    stacking_preds, stacking_bt = build_stacking_ensemble(all_model_preds, stocks_data)
    ensemble_backtests["META_STACKING"] = stacking_bt
    final_consensus_bt = backtest_model(meta_ensembles.get("META_MAJORITY", {}), stocks_data)
    ensemble_backtests["META_FINAL_CONSENSUS"] = final_consensus_bt
    elapsed = time.time() - t0
    report = {"generated_at": pd.Timestamp.now().isoformat(), "elapsed_seconds": elapsed,
              "universe": {"total_stocks_ohlcv": len(STOCKS), "total_stocks_tested": len(stocks_data), "test_fraction": TEST_FRACTION, "max_rows_per_stock": MAX_ROWS_PER_STOCK, "transaction_cost_bps": COST_BPS, "holding_period_days": HOLDING_DAYS},
              "models_backtested": len(model_backtests), "ensembles_backtested": len(ensemble_backtests),
              "model_backtests": model_backtests, "ensemble_backtests": ensemble_backtests}
    REPORT_FILE.write_text(json.dumps(report, indent=2))
    print(f"\n✓ Backtest report saved to {REPORT_FILE}")
    existing = json.loads(PRED_FILE.read_text())
    existing["meta_ensemble_predictions"] = meta_ensembles
    existing["meta_ensemble_backtest"] = ensemble_backtests
    PRED_FILE.write_text(json.dumps(existing, indent=2))
    print(f"✓ Saved to {PRED_FILE}")
    print(f"✓ Total time: {elapsed:.1f}s")

if __name__ == "__main__":
    main()
