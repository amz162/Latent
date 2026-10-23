#!/usr/bin/env python3
"""Latent.pk — Unified backtest of all 13 ensemble methods (A through M).

A. Majority Vote              (computed on-the-fly)
B. Probability-Weighted       (computed on-the-fly)
C. Tier-Weighted              (computed on-the-fly)
D. CL-Ensemble                (from cl_ensemble_predictions)
E. CL-Extender                (from cl_extender_predictions)
F. CL-2 Ensemble              (from cl2_ensemble_predictions)
G. PI-Ensemble                (from pi_ensemble_predictions)
H. GM-Model                   (from gm_model_predictions)
I. CG-Ensemble                (from cg_ensemble_predictions)
J. X-Ensemble                 (from x_ensemble_predictions)
K. Gian-Ensemble             (from gian_ensemble_predictions)
L. Gian-Extender             (from gian_extender_predictions)
M. M-Ensemble                (from m_ensemble_predictions)

All backtested with the SAME methodology:
- Universe: 654 stocks with test data
- Test period: last 20% of each stock's bars
- Holding period: 21 trading days
- Transaction cost: 50 bps (0.5%) per round-trip
"""
import sys, os, json, warnings, time, gc
import numpy as np
import pandas as pd
from pathlib import Path

warnings.filterwarnings("ignore")

OHLCV = Path("data/ohlcv_all")
PRED_FILE = Path("data/ml_predictions_multi.json")
REPORT_FILE = Path("data/backtest_report_A_to_M_ensembles.json")
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

def backtest_ensemble(ensemble_preds, stocks_data, cost_bps=COST_BPS, holding_days=HOLDING_DAYS):
    trades = []; n_buy = n_sell = n_hold = 0; covered_stocks = 0
    for sym, sd in stocks_data.items():
        test = sd["test"]
        if len(test) < holding_days + 1: continue
        pred = ensemble_preds.get(sym)
        if not pred: continue
        covered_stocks += 1
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
        return {"trades": 0, "coveredStocks": covered_stocks, "winRate": 0, "avgReturnPct": 0, "profitFactor": 0, "sharpe": 0, "maxDrawdownPct": 0, "n_buy": n_buy, "n_sell": n_sell, "n_hold": n_hold}
    arr = np.array(trades); n_trades = len(arr)
    wins = arr[arr > 0]; losses = arr[arr < 0]
    win_rate = (len(wins) / n_trades) * 100
    avg_ret = arr.mean() * 100
    pf = wins.sum() / abs(losses.sum()) if len(losses) > 0 and losses.sum() != 0 else (float('inf') if wins.sum() > 0 else 0)
    sharpe = (arr.mean() / arr.std()) * np.sqrt(252) if arr.std() > 0 else 0
    cum = np.cumsum(arr); running_max = np.maximum.accumulate(cum)
    drawdowns = cum - running_max
    max_dd = drawdowns.min() * 100
    return {"trades": int(n_trades), "coveredStocks": covered_stocks, "winRate": round(win_rate, 2), "avgReturnPct": round(avg_ret, 4), "profitFactor": round(float(pf), 4) if pf != float('inf') else 999.0, "sharpe": round(float(sharpe), 4), "maxDrawdownPct": round(float(max_dd), 4), "n_buy": n_buy, "n_sell": n_sell, "n_hold": n_hold}

def compute_majority_vote(all_model_preds):
    symbol_models = {}
    for mn, preds in all_model_preds.items():
        for sym, p in preds.items():
            if not isinstance(p, dict): continue
            symbol_models.setdefault(sym, {})[mn] = p
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

def compute_prob_weighted(all_model_preds):
    symbol_models = {}
    for mn, preds in all_model_preds.items():
        for sym, p in preds.items():
            if not isinstance(p, dict): continue
            symbol_models.setdefault(sym, {})[mn] = p
    out = {}
    for sym, models in symbol_models.items():
        if len(models) < 3: continue
        total_conf = sum(p.get("confidence", 0) for p in models.values()) or 1
        wsum_ar = sum(p.get("avgReturn", 0) * p.get("confidence", 0) for p in models.values())
        avg_ar = wsum_ar / total_conf
        if avg_ar > 0.01: sig, d = "BUY", "LONG"
        elif avg_ar < -0.01: sig, d = "SELL", "SHORT"
        else: sig, d = "HOLD", "LONG"
        ref = list(models.values())[0]
        cp = ref.get("currentPrice", 0)
        out[sym] = {"signal": sig, "direction": d, "confidence": min(100, int(abs(avg_ar)*1000)), "currentPrice": cp, "entry": ref.get("entry", cp), "tp1": ref.get("tp1", cp*1.02), "tp2": ref.get("tp2", cp*1.04), "tp3": ref.get("tp3", cp*1.06), "sl": ref.get("sl", cp*0.97), "avgReturn": round(float(avg_ar), 4)}
    return out

def compute_tier_weighted(all_model_preds):
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
            tier = MODEL_TIER.get(mn, "TIER_3"); w = TIER_WEIGHTS.get(tier, 0.20)
            wsum_ar += p.get("avgReturn", 0) * w; wsum_w += w
        avg_ar = wsum_ar / wsum_w if wsum_w > 0 else 0
        if avg_ar > 0.01: sig, d = "BUY", "LONG"
        elif avg_ar < -0.01: sig, d = "SELL", "SHORT"
        else: sig, d = "HOLD", "LONG"
        ref = list(models.values())[0]
        cp = ref.get("currentPrice", 0)
        out[sym] = {"signal": sig, "direction": d, "confidence": min(100, int(abs(avg_ar)*1000)), "currentPrice": cp, "entry": ref.get("entry", cp), "tp1": ref.get("tp1", cp*1.02), "tp2": ref.get("tp2", cp*1.04), "tp3": ref.get("tp3", cp*1.06), "sl": ref.get("sl", cp*0.97), "avgReturn": round(float(avg_ar), 4)}
    return out

def main():
    print(f"\n{'='*85}\nLatent.pk — Unified Backtest of All 13 Ensemble Methods (A through M)\n{'='*85}")
    print(f"Stocks in OHLCV dir: {len(STOCKS)}")
    t0 = time.time()
    print("\n[1/3] Loading predictions file...")
    data = json.loads(PRED_FILE.read_text())
    all_models = data.get("models", {})
    trained_models = {k: v for k, v in all_models.items() if isinstance(v, dict) and v.get("trained")}
    all_model_preds = {}
    for mn, mi in trained_models.items():
        preds = mi.get("predictions", {})
        if isinstance(preds, dict) and len(preds) > 0:
            all_model_preds[mn] = preds
    print(f"  {len(all_model_preds)} models with predictions")
    print("\n[2/3] Loading OHLCV data...")
    stocks_data = load_stock_data()
    print(f"  Loaded {len(stocks_data)} stocks with test data")
    print(f"\n[3/3] Building + backtesting all 13 ensembles (A-M)...")
    ensemble_backtests = {}
    def run(label, preds):
        bt = backtest_ensemble(preds, stocks_data)
        ensemble_backtests[label] = bt
        if bt["trades"] > 0:
            print(f"  {label:<55} {bt['coveredStocks']:<8} {bt['trades']:<8} {bt['winRate']:<10} {bt['avgReturnPct']:<10} {bt['profitFactor']:<8} {bt['sharpe']:<8} {bt['maxDrawdownPct']:<10}")
        else:
            print(f"  {label:<55} {bt['coveredStocks']:<8} (no trades)")
    run("A. Majority Vote", compute_majority_vote(all_model_preds))
    run("B. Probability-Weighted", compute_prob_weighted(all_model_preds))
    run("C. Tier-Weighted", compute_tier_weighted(all_model_preds))
    run("D. CL-Ensemble (LGB70+Log30)", data.get("cl_ensemble_predictions", {}))
    run("E. CL-Extender (8-model weighted)", data.get("cl_extender_predictions", {}))
    run("F. CL-2 Ensemble (7 clf + logistic meta)", data.get("cl2_ensemble_predictions", {}))
    run("G. PI-Ensemble (4 models: Linear/Logistic, KNN, NN)", data.get("pi_ensemble_predictions", {}))
    run("H. GM-Model Ensembler (4-Pillar: 35/30/20/15)", data.get("gm_model_predictions", {}))
    run("I. CG-Ensemble (LightGBM + XGBoost, triple-barrier)", data.get("cg_ensemble_predictions", {}))
    run("J. X-Ensemble (10 strategies + LightGBM meta-labeling)", data.get("x_ensemble_predictions", {}))
    run("K. Gian-Ensemble (Square-root S/R with odd-number rule)", data.get("gian_ensemble_predictions", {}))
    run("L. Gian-Extender (Fixed GANN square-of-9 levels)", data.get("gian_extender_predictions", {}))
    run("M. M-Ensemble (Historical price-touch S/R with ATR)", data.get("m_ensemble_predictions", {}))
    elapsed = time.time() - t0
    report = {"generated_at": pd.Timestamp.now().isoformat(), "elapsed_seconds": elapsed,
              "universe": {"total_stocks_ohlcv": len(STOCKS), "total_stocks_tested": len(stocks_data), "test_fraction": TEST_FRACTION, "max_rows_per_stock": MAX_ROWS_PER_STOCK, "transaction_cost_bps": COST_BPS, "holding_period_days": HOLDING_DAYS},
              "ensembles_backtested": len(ensemble_backtests), "ensemble_backtests": ensemble_backtests}
    REPORT_FILE.write_text(json.dumps(report, indent=2))
    print(f"\n✓ Backtest report saved to {REPORT_FILE}")
    existing = json.loads(PRED_FILE.read_text())
    existing["ensemble_A_to_M_backtest"] = ensemble_backtests
    PRED_FILE.write_text(json.dumps(existing, indent=2))
    print(f"✓ Saved to {PRED_FILE}")
    print(f"✓ Total time: {elapsed:.1f}s")
    print(f"\n{'='*85}\nFINAL RANKING — All 13 Ensemble Methods (A-M) by Sharpe Ratio\n{'='*85}")
    sorted_bt = sorted(ensemble_backtests.items(), key=lambda x: x[1].get("sharpe", -999), reverse=True)
    for i, (name, bt) in enumerate(sorted_bt, 1):
        if bt.get("trades", 0) > 0:
            print(f"  {i:<3} {name[:55]:<55} {bt['trades']:<8} {bt['winRate']:<10} {bt['avgReturnPct']:<10} {bt['profitFactor']:<8} {bt['sharpe']:<8} {bt['maxDrawdownPct']:<10}")
        else:
            print(f"  {i:<3} {name[:55]:<55} (no trades)")

if __name__ == "__main__":
    main()
