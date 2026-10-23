#!/usr/bin/env python3
"""Latent.pk — Train ALL ensemble methods on the full PSX stock universe.

Implements 20 ensemble methods (beyond the 5 we already have) and backtests each.
"""
import sys, os, json, warnings, time, gc
import numpy as np
import pandas as pd
from pathlib import Path
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.metrics import accuracy_score
import xgboost as xgb

warnings.filterwarnings("ignore")

OHLCV = Path("data/ohlcv_all")
PRED_FILE = Path("data/ml_predictions_multi.json")
REPORT_FILE = Path("data/backtest_report_all_ensembles.json")
STOCKS = sorted([p.stem for p in OHLCV.glob("*.csv")])
MAX_ROWS_PER_STOCK = 180
TEST_FRACTION = 0.20
COST_BPS = 50
HOLDING_DAYS = 21

TIER_WEIGHTS = {"TIER_1": 0.30, "TIER_2": 0.20, "TIER_3": 0.25, "TIER_4": 0.10, "TIER_CL": 0.15, "TIER_CL_2": 0.20, "TIER_PI": 0.20, "TIER_GM": 0.20, "TIER_CG": 0.20, "TIER_X": 0.20, "TIER_GIAN": 0.20}
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
    trades = []; n_buy = n_sell = n_hold = 0
    for sym, sd in stocks_data.items():
        test = sd["test"]
        if len(test) < holding_days + 1: continue
        pred = model_preds.get(sym)
        if not pred: continue
        sig = pred.get("signal", "HOLD")
        if sig == "HOLD": n_hold += 1; continue
        if sig == "BUY": n_buy += 1
        elif sig == "SELL": n_sell += 1
        entry_prices = test["close"].values[:-holding_days]
        exit_prices = test["close"].values[holding_days:]
        if sig == "BUY": rets = (exit_prices - entry_prices) / entry_prices
        else: rets = (entry_prices - exit_prices) / entry_prices
        rets = rets - cost_bps / 10000.0
        trades.extend(rets.tolist())
    if not trades:
        return {"trades": 0, "winRate": 0, "avgReturnPct": 0, "profitFactor": 0, "sharpe": 0, "maxDrawdownPct": 0, "n_buy": n_buy, "n_sell": n_sell, "n_hold": n_hold}
    arr = np.array(trades); n_trades = len(arr)
    wins = arr[arr > 0]; losses = arr[arr < 0]
    win_rate = (len(wins) / n_trades) * 100
    avg_ret = arr.mean() * 100
    pf = wins.sum() / abs(losses.sum()) if len(losses) > 0 and losses.sum() != 0 else (float('inf') if wins.sum() > 0 else 0)
    sharpe = (arr.mean() / arr.std()) * np.sqrt(252) if arr.std() > 0 else 0
    cum = np.cumsum(arr); running_max = np.maximum.accumulate(cum)
    drawdowns = cum - running_max
    max_dd = drawdowns.min() * 100
    return {"trades": int(n_trades), "winRate": round(win_rate, 2), "avgReturnPct": round(avg_ret, 4),
            "profitFactor": round(float(pf), 4) if pf != float('inf') else 999.0,
            "sharpe": round(float(sharpe), 4), "maxDrawdownPct": round(float(max_dd), 4),
            "n_buy": n_buy, "n_sell": n_sell, "n_hold": n_hold}

def ensemble_majority(all_model_preds, model_subset=None):
    if model_subset is None: model_subset = list(all_model_preds.keys())
    symbol_models = {}
    for mn in model_subset:
        for sym, p in all_model_preds.get(mn, {}).items():
            if not isinstance(p, dict): continue
            symbol_models.setdefault(sym, {})[mn] = p
    preds = {}
    for sym, models in symbol_models.items():
        if len(models) < 3: continue
        buys = sum(1 for p in models.values() if p.get("signal") == "BUY")
        sells = sum(1 for p in models.values() if p.get("signal") == "SELL")
        holds = sum(1 for p in models.values() if p.get("signal") == "HOLD")
        if buys > sells and buys > holds: sig, d = "BUY", "LONG"
        elif sells > buys and sells > holds: sig, d = "SELL", "SHORT"
        else: sig, d = "HOLD", "LONG"
        ars = [p.get("avgReturn", 0) for p in models.values() if p.get("signal") in ("BUY", "SELL")]
        avg_ar = float(np.mean(ars)) if ars else 0
        ref = next((p for p in models.values() if p.get("signal") in ("BUY", "SELL")), list(models.values())[0])
        cp = ref.get("currentPrice", 0)
        preds[sym] = {"signal": sig, "direction": d, "confidence": int(max(buys, sells) / len(models) * 100), "currentPrice": cp, "entry": ref.get("entry", cp), "tp1": ref.get("tp1", cp*1.02), "tp2": ref.get("tp2", cp*1.04), "tp3": ref.get("tp3", cp*1.06), "sl": ref.get("sl", cp*0.97), "avgReturn": round(avg_ar, 4)}
    return preds

def ensemble_weighted(all_model_preds, weight_fn):
    symbol_models = {}
    for mn, preds in all_model_preds.items():
        for sym, p in preds.items():
            if not isinstance(p, dict): continue
            symbol_models.setdefault(sym, {})[mn] = p
    out = {}
    for sym, models in symbol_models.items():
        if len(models) < 3: continue
        wsum_ar = 0; wsum_w = 0
        for mn, p in models.items():
            w = weight_fn(mn, p)
            wsum_ar += p.get("avgReturn", 0) * w
            wsum_w += w
        avg_ar = wsum_ar / wsum_w if wsum_w > 0 else 0
        if avg_ar > 0.01: sig, d = "BUY", "LONG"
        elif avg_ar < -0.01: sig, d = "SELL", "SHORT"
        else: sig, d = "HOLD", "LONG"
        ref = list(models.values())[0]
        cp = ref.get("currentPrice", 0)
        out[sym] = {"signal": sig, "direction": d, "confidence": min(100, int(abs(avg_ar)*1000)), "currentPrice": cp, "entry": ref.get("entry", cp), "tp1": ref.get("tp1", cp*1.02), "tp2": ref.get("tp2", cp*1.04), "tp3": ref.get("tp3", cp*1.06), "sl": ref.get("sl", cp*0.97), "avgReturn": round(float(avg_ar), 4)}
    return out

def ensemble_quorum(all_model_preds, threshold):
    symbol_models = {}
    for mn, preds in all_model_preds.items():
        for sym, p in preds.items():
            if not isinstance(p, dict): continue
            symbol_models.setdefault(sym, {})[mn] = p
    out = {}
    for sym, models in symbol_models.items():
        if len(models) < threshold: continue
        buys = sum(1 for p in models.values() if p.get("signal") == "BUY")
        sells = sum(1 for p in models.values() if p.get("signal") == "SELL")
        if buys >= threshold: sig, d = "BUY", "LONG"
        elif sells >= threshold: sig, d = "SELL", "SHORT"
        else: sig, d = "HOLD", "LONG"
        ars = [p.get("avgReturn", 0) for p in models.values() if p.get("signal") in ("BUY", "SELL")]
        avg_ar = float(np.mean(ars)) if ars else 0
        ref = next((p for p in models.values() if p.get("signal") in ("BUY", "SELL")), list(models.values())[0])
        cp = ref.get("currentPrice", 0)
        out[sym] = {"signal": sig, "direction": d, "confidence": int(max(buys, sells) / len(models) * 100), "currentPrice": cp, "entry": ref.get("entry", cp), "tp1": ref.get("tp1", cp*1.02), "tp2": ref.get("tp2", cp*1.04), "tp3": ref.get("tp3", cp*1.06), "sl": ref.get("sl", cp*0.97), "avgReturn": round(avg_ar, 4)}
    return out

def ensemble_majority_filtered(symbol_models):
    out = {}
    for sym, models in symbol_models.items():
        if len(models) < 3: continue
        buys = sum(1 for p in models.values() if p.get("signal") == "BUY")
        sells = sum(1 for p in models.values() if p.get("signal") == "SELL")
        holds = sum(1 for p in models.values() if p.get("signal") == "HOLD")
        if buys > sells and buys > holds: sig, d = "BUY", "LONG"
        elif sells > buys and sells > holds: sig, d = "SELL", "SHORT"
        else: sig, d = "HOLD", "LONG"
        ars = [p.get("avgReturn", 0) for p in models.values() if p.get("signal") in ("BUY", "SELL")]
        avg_ar = float(np.mean(ars)) if ars else 0
        ref = next((p for p in models.values() if p.get("signal") in ("BUY", "SELL")), list(models.values())[0])
        cp = ref.get("currentPrice", 0)
        out[sym] = {"signal": sig, "direction": d, "confidence": int(max(buys, sells) / len(models) * 100), "currentPrice": cp, "entry": ref.get("entry", cp), "tp1": ref.get("tp1", cp*1.02), "tp2": ref.get("tp2", cp*1.04), "tp3": ref.get("tp3", cp*1.06), "sl": ref.get("sl", cp*0.97), "avgReturn": round(avg_ar, 4)}
    return out

def build_stacking(meta_clf, all_model_preds, stocks_data, name):
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
        return {}, {"trades": 0, "winRate": 0, "avgReturnPct": 0, "profitFactor": 0, "sharpe": 0, "maxDrawdownPct": 0, "error": "Not enough stocks"}
    X = np.array(X); y = np.array(y)
    split = int(len(X) * 0.5)
    X_train, X_test = X[:split], X[split:]
    y_train, y_test = y[:split], y[split:]
    test_stocks = covered[split:]
    print(f"    {name}: {len(X_train)} train, {len(X_test)} test, {X.shape[1]} features")
    meta_clf.fit(X_train, y_train)
    train_acc = accuracy_score(y_train, meta_clf.predict(X_train))
    test_acc = accuracy_score(y_test, meta_clf.predict(X_test))
    print(f"      train_acc={train_acc*100:.1f}% test_acc={test_acc*100:.1f}%")
    if hasattr(meta_clf, "predict_proba"):
        probs = meta_clf.predict_proba(X_test)[:, 1]
    else:
        probs = meta_clf.predict(X_test).astype(float)
    stacking_preds = {}
    for i, sym in enumerate(test_stocks):
        prob = float(probs[i])
        if prob > 0.55: sig, d = "BUY", "LONG"
        elif prob < 0.45: sig, d = "SELL", "SHORT"
        else: sig, d = "HOLD", "LONG"
        test_df = stocks_data[sym]["test"]
        cp = float(test_df["close"].iloc[0])
        stacking_preds[sym] = {"signal": sig, "direction": d, "confidence": min(100, int(abs(prob - 0.5) * 200)), "currentPrice": round(cp, 2), "entry": round(cp, 2), "tp1": round(cp*1.02, 2), "tp2": round(cp*1.04, 2), "tp3": round(cp*1.06, 2), "sl": round(cp*0.97, 2), "avgReturn": round((prob - 0.5) * 2, 4)}
    test_stocks_data = {sym: stocks_data[sym] for sym in test_stocks}
    return stacking_preds, backtest_model(stacking_preds, test_stocks_data)

def main():
    print(f"\n{'='*80}\nLatent.pk — Train ALL Ensemble Methods + Backtest\n{'='*80}")
    print(f"Stocks in OHLCV dir: {len(STOCKS)}")
    t0 = time.time()
    print("\n[1/4] Loading predictions file...")
    data = json.loads(PRED_FILE.read_text())
    all_models = data.get("models", {})
    trained_models = {k: v for k, v in all_models.items() if isinstance(v, dict) and v.get("trained")}
    all_model_preds = {}
    for mn, mi in trained_models.items():
        preds = mi.get("predictions", {})
        if isinstance(preds, dict) and len(preds) > 0:
            all_model_preds[mn] = preds
    print(f"  {len(all_model_preds)} models with predictions")
    model_backtests = data.get("meta_ensemble_backtest", {}).get("model_backtests", {})
    if not model_backtests:
        model_backtests = data.get("backtesting", {})
    print(f"  Loaded existing individual model backtests: {len(model_backtests)}")
    model_sharpes = [(mn, bt.get("sharpe", 0)) for mn, bt in model_backtests.items()]
    model_sharpes.sort(key=lambda x: x[1], reverse=True)
    top5 = [m for m, _ in model_sharpes[:5]]
    top10 = [m for m, _ in model_sharpes[:10]]
    top20 = [m for m, _ in model_sharpes[:20]]
    bottom10 = [m for m, _ in model_sharpes[-10:]]
    print("\n[2/4] Loading OHLCV data...")
    stocks_data = load_stock_data()
    print(f"  Loaded {len(stocks_data)} stocks with test data")
    print(f"\n[3/4] Building + backtesting 20 ensemble methods...")
    all_ensembles = {}; ensemble_backtests = {}
    def run(name, preds):
        bt = backtest_model(preds, stocks_data)
        all_ensembles[name] = preds; ensemble_backtests[name] = bt
        if bt["trades"] > 0:
            print(f"  {name:<30} {bt['trades']:<8} {bt['winRate']:<10} {bt['avgReturnPct']:<10} {bt['profitFactor']:<8} {bt['sharpe']:<8} {bt['maxDrawdownPct']:<10}")
        else:
            print(f"  {name:<30} (no trades)")
    run("ALL_MAJORITY", ensemble_majority(all_model_preds))
    run("ALL_PROB_WEIGHTED", ensemble_weighted(all_model_preds, lambda mn, p: p.get("confidence", 0)))
    run("ALL_TIER_WEIGHTED", ensemble_weighted(all_model_preds, lambda mn, p: TIER_WEIGHTS.get(MODEL_TIER.get(mn, "TIER_3"), 0.20)))
    run("TOP5_MAJORITY", ensemble_majority({m: all_model_preds[m] for m in top5 if m in all_model_preds}))
    run("TOP10_MAJORITY", ensemble_majority({m: all_model_preds[m] for m in top10 if m in all_model_preds}))
    run("TOP20_MAJORITY", ensemble_majority({m: all_model_preds[m] for m in top20 if m in all_model_preds}))
    excluded_set = set(bottom10)
    run("BOTTOM10_EXCLUDED", ensemble_majority({m: p for m, p in all_model_preds.items() if m not in excluded_set}))
    run("QUORUM_5", ensemble_quorum(all_model_preds, 5))
    run("QUORUM_10", ensemble_quorum(all_model_preds, 10))
    run("QUORUM_20", ensemble_quorum(all_model_preds, 20))
    winners = {m for m, bt in model_backtests.items() if bt.get("profitFactor", 0) > 1.0 and bt.get("trades", 0) > 0}
    symbol_models_winners = {}
    for mn in winners:
        for sym, p in all_model_preds.get(mn, {}).items():
            if isinstance(p, dict): symbol_models_winners.setdefault(sym, {})[mn] = p
    run("WINNERS_ONLY", ensemble_majority_filtered(symbol_models_winners))
    symbol_models_highconf = {}
    for mn, preds in all_model_preds.items():
        for sym, p in preds.items():
            if isinstance(p, dict) and p.get("confidence", 0) > 50:
                symbol_models_highconf.setdefault(sym, {})[mn] = p
    run("HIGH_CONF_ONLY", ensemble_majority_filtered(symbol_models_highconf))
    def sharpe_weight(mn, p):
        bt = model_backtests.get(mn, {}); s = bt.get("sharpe", 0); return max(0.01, s)
    run("SHARPE_WEIGHTED", ensemble_weighted(all_model_preds, sharpe_weight))
    def pf_weight(mn, p):
        bt = model_backtests.get(mn, {}); pf = bt.get("profitFactor", 0); return max(0.01, pf)
    run("PF_WEIGHTED", ensemble_weighted(all_model_preds, pf_weight))
    def winrate_weight(mn, p):
        bt = model_backtests.get(mn, {}); wr = bt.get("winRate", 50); return max(0.01, wr / 100.0)
    run("WINRATE_WEIGHTED", ensemble_weighted(all_model_preds, winrate_weight))
    def bayesian_weight(mn, p):
        bt = model_backtests.get(mn, {}); n = bt.get("trades", 0); wr = bt.get("winRate", 50) / 100.0
        wins = wr * n; posterior = (wins + 2) / (n + 4); sharpe = max(0.01, bt.get("sharpe", 0))
        return posterior * sharpe
    run("BAYESIAN_AVG", ensemble_weighted(all_model_preds, bayesian_weight))
    print(f"\n  Stacking ensembles (training meta-learners)...")
    preds_lr, bt_lr = build_stacking(LogisticRegression(max_iter=500, class_weight="balanced"), all_model_preds, stocks_data, "STACKING_LR")
    all_ensembles["STACKING_LR"] = preds_lr; ensemble_backtests["STACKING_LR"] = bt_lr
    if bt_lr.get("trades", 0) > 0: print(f"  {'STACKING_LR':<30} {bt_lr['trades']:<8} {bt_lr['winRate']:<10} {bt_lr['avgReturnPct']:<10} {bt_lr['profitFactor']:<8} {bt_lr['sharpe']:<8} {bt_lr['maxDrawdownPct']:<10}")
    preds_rf, bt_rf = build_stacking(RandomForestClassifier(n_estimators=100, max_depth=5, random_state=42, class_weight="balanced"), all_model_preds, stocks_data, "STACKING_RF")
    all_ensembles["STACKING_RF"] = preds_rf; ensemble_backtests["STACKING_RF"] = bt_rf
    if bt_rf.get("trades", 0) > 0: print(f"  {'STACKING_RF':<30} {bt_rf['trades']:<8} {bt_rf['winRate']:<10} {bt_rf['avgReturnPct']:<10} {bt_rf['profitFactor']:<8} {bt_rf['sharpe']:<8} {bt_rf['maxDrawdownPct']:<10}")
    preds_xgb, bt_xgb = build_stacking(xgb.XGBClassifier(n_estimators=100, max_depth=4, learning_rate=0.05, random_state=42, eval_metric="logloss"), all_model_preds, stocks_data, "STACKING_XGB")
    all_ensembles["STACKING_XGB"] = preds_xgb; ensemble_backtests["STACKING_XGB"] = bt_xgb
    if bt_xgb.get("trades", 0) > 0: print(f"  {'STACKING_XGB':<30} {bt_xgb['trades']:<8} {bt_xgb['winRate']:<10} {bt_xgb['avgReturnPct']:<10} {bt_xgb['profitFactor']:<8} {bt_xgb['sharpe']:<8} {bt_xgb['maxDrawdownPct']:<10}")
    preds_mlp, bt_mlp = build_stacking(MLPClassifier(hidden_layer_sizes=(64, 32), max_iter=300, random_state=42), all_model_preds, stocks_data, "STACKING_MLP")
    all_ensembles["STACKING_MLP"] = preds_mlp; ensemble_backtests["STACKING_MLP"] = bt_mlp
    if bt_mlp.get("trades", 0) > 0: print(f"  {'STACKING_MLP':<30} {bt_mlp['trades']:<8} {bt_mlp['winRate']:<10} {bt_mlp['avgReturnPct']:<10} {bt_mlp['profitFactor']:<8} {bt_mlp['sharpe']:<8} {bt_mlp['maxDrawdownPct']:<10}")
    elapsed = time.time() - t0
    report = {"generated_at": pd.Timestamp.now().isoformat(), "elapsed_seconds": elapsed,
              "universe": {"total_stocks_ohlcv": len(STOCKS), "total_stocks_tested": len(stocks_data), "test_fraction": TEST_FRACTION, "max_rows_per_stock": MAX_ROWS_PER_STOCK, "transaction_cost_bps": COST_BPS, "holding_period_days": HOLDING_DAYS},
              "individual_models_count": len(all_model_preds), "ensembles_count": len(ensemble_backtests),
              "ensemble_backtests": ensemble_backtests, "top_5_models_by_sharpe": top5, "top_10_models_by_sharpe": top10, "bottom_10_models_by_sharpe": bottom10}
    REPORT_FILE.write_text(json.dumps(report, indent=2))
    print(f"\n✓ Backtest report saved to {REPORT_FILE}")
    existing = json.loads(PRED_FILE.read_text())
    existing["all_ensemble_predictions"] = all_ensembles; existing["all_ensemble_backtest"] = ensemble_backtests
    PRED_FILE.write_text(json.dumps(existing, indent=2))
    print(f"✓ Saved to {PRED_FILE}"); print(f"✓ Total time: {elapsed:.1f}s")

if __name__ == "__main__":
    main()
