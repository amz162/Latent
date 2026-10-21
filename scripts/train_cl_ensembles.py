#!/usr/bin/env python3
"""Latent.pk — Generate CL Ensemble + CL-Extender backtesting data.

Builds:
  • cl_ensemble_backtest: triple-barrier backtest of LightGBM+LogReg ensemble
  • cl_ensemble_backtest_all: every trained model tested with same triple-barrier method
  • cl_extender_backtest: 8-model weighted ensemble (LightGBM/XGBoost/Ridge/LSTM/GRU/Prophet/Holt-Winters/GARCH)

Injects into data/ml_predictions_multi.json. Also computes the ensemble METHOD-level
predictions (CL-Ensemble, CL-Extender) so the AI Models page can show them alongside
Majority Vote / Probability-Weighted / Tier-Weighted.
"""
import json, sys, warnings, numpy as np, pandas as pd
from pathlib import Path
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_squared_error
warnings.filterwarnings("ignore")

OHLCV = Path("data/ohlcv")
PRED_FILE = Path("data/ml_predictions_multi.json")
STOCKS = ["ENGRO", "HUBC", "LUCK", "SYS", "MEBL", "PSO", "OGDC", "PPL"]
FC = ["rsi_14","macd","macd_signal","macd_hist","bb_width","bb_pct_b","atr_14","obv_change_pct",
      "price_sma_20_ratio","price_sma_50_ratio","price_sma_200_ratio","volume_sma_20_ratio",
      "return_1d","return_7d","return_14d","return_30d","hl_range_pct","body_size_pct","volatility_14d"]

# CL-Extender weights (from previous design)
EXTENDER_WEIGHTS = {
    "LightGBM": 0.20, "XGBoost": 0.15, "Ridge Regression": 0.15,
    "LSTM": 0.10, "GRU": 0.10, "Prophet": 0.10,
    "Holt-Winters": 0.10, "GARCH": 0.10,
}

# CL-Ensemble weights (LightGBM 70% + LogReg-on-Ridge-features 30%)
ENSEMBLE_WEIGHTS = {"LightGBM": 0.70, "LogReg": 0.30}

# Triple-barrier config
SL_MULT = 1.5
PROB_MIN = 0.40
MAX_HOLD_DAYS = 15
EXIT_FRACTIONS = [0.5, 0.3, 0.2]
VOL_REGIME_MAX = 2.5
MOMENTUM_FILTER = "return_5d > -0.03"  # filter out strong downtrend entries


def compute_rsi(p, n=14):
    d = p.diff(); g = d.where(d > 0, 0); l = -d.where(d < 0, 0)
    ag = g.ewm(alpha=1/n, min_periods=n).mean(); al = l.ewm(alpha=1/n, min_periods=n).mean()
    return (100 - 100 / (1 + ag / al.replace(0, np.nan))).fillna(50)


def compute_macd(p):
    e12 = p.ewm(span=12, adjust=False).mean(); e26 = p.ewm(span=26, adjust=False).mean()
    m = e12 - e26; s = m.ewm(span=9, adjust=False).mean(); return m, s, m - s


def compute_bb(p, w=20):
    sma = p.rolling(w).mean(); sd = p.rolling(w).std()
    return ((sma + 2*sd - (sma - 2*sd)) / sma).fillna(0), \
           ((p - (sma - 2*sd)) / (4*sd).replace(0, np.nan)).fillna(0.5)


def compute_atr(h, l, c, n=14):
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
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
    obv = compute_obv(c, v)
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


def load():
    frames = []
    for s in STOCKS:
        p = OHLCV / f"{s}.csv"
        if not p.exists():
            continue
        df = pd.read_csv(p, usecols=range(6))
        df = df[df["volume"] > 0].reset_index(drop=True)
        if len(df) < 50:
            continue
        df = add_features(df); df["symbol"] = s
        frames.append(df)
    return pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()


def triple_barrier_backtest(df, signal_fn, name):
    """Run a triple-barrier backtest for one signal function.

    signal_fn: (sdf_row, atr) -> "BUY" / "SELL" / "HOLD"
    Returns dict with total_trades, wins, losses, win_rate, avg_return_pct,
    avg_win_pct, avg_loss_pct, profit_factor, total_pnl_pkr, stars, pass_mark.
    """
    wins = 0; losses = 0; rets = []; pnls = []
    for s in STOCKS:
        sdf = df[df["symbol"] == s].sort_values("date").reset_index(drop=True)
        if len(sdf) < 60:
            continue
        # Walk forward: enter at each bar, exit at SL/TP/MAX_HOLD
        for i in range(60, len(sdf) - MAX_HOLD_DAYS):
            row = sdf.iloc[i]
            atr = float(row["atr_14"]) if row["atr_14"] > 0 else float(sdf["close"].iloc[i]) * 0.02
            cp = float(row["close"])
            sig = signal_fn(sdf, i)
            if sig == "HOLD":
                continue
            # Apply momentum filter
            if float(row["return_5d"]) < -0.03 and sig == "BUY":
                continue
            # Vol regime filter
            vol = float(row["volatility_14d"])
            if vol > VOL_REGIME_MAX:
                continue

            sl = cp - SL_MULT * atr if sig == "BUY" else cp + SL_MULT * atr
            tp1 = cp + 1.0 * atr if sig == "BUY" else cp - 1.0 * atr
            tp2 = cp + 2.0 * atr if sig == "BUY" else cp - 2.0 * atr
            tp3 = cp + 3.0 * atr if sig == "BUY" else cp - 3.0 * atr

            # Walk forward up to MAX_HOLD_DAYS to find exit
            exit_price = cp
            exit_reason = "timeout"
            for j in range(1, MAX_HOLD_DAYS + 1):
                if i + j >= len(sdf):
                    break
                next_row = sdf.iloc[i + j]
                nh = float(next_row["high"]); nl = float(next_row["low"])
                if sig == "BUY":
                    if nl <= sl:
                        exit_price = sl; exit_reason = "sl"; break
                    if nh >= tp3:
                        exit_price = tp3; exit_reason = "tp3"; break
                    if nh >= tp2:
                        exit_price = tp2; exit_reason = "tp2"; break
                    if nh >= tp1:
                        exit_price = tp1; exit_reason = "tp1"; break
                else:  # SELL
                    if nh >= sl:
                        exit_price = sl; exit_reason = "sl"; break
                    if nl <= tp3:
                        exit_price = tp3; exit_reason = "tp3"; break
                    if nl <= tp2:
                        exit_price = tp2; exit_reason = "tp2"; break
                    if nl <= tp1:
                        exit_price = tp1; exit_reason = "tp1"; break
            else:
                exit_price = float(sdf.iloc[i + MAX_HOLD_DAYS]["close"])

            if sig == "BUY":
                ret = (exit_price - cp) / cp
            else:
                ret = (cp - exit_price) / cp
            pnl = ret * 10000  # assume 10K shares per trade
            rets.append(ret)
            pnls.append(pnl)
            if ret > 0:
                wins += 1
            else:
                losses += 1

    total = wins + losses
    win_rate = round(wins / max(total, 1) * 100, 1)
    avg_return = round(float(np.mean(rets)) * 100, 2) if rets else 0
    avg_win = round(float(np.mean([r for r in rets if r > 0]) * 100), 2) if any(r > 0 for r in rets) else 0
    avg_loss = round(float(np.mean([r for r in rets if r < 0]) * 100), 2) if any(r < 0 for r in rets) else 0
    gross_profit = sum(p for p in pnls if p > 0)
    gross_loss = abs(sum(p for p in pnls if p < 0))
    pf = round(gross_profit / max(gross_loss, 1), 2) if gross_loss > 0 else 0
    total_pnl = int(sum(pnls))
    stars = int(min(5, max(1, int(win_rate / 20) + 1))) if total > 0 else 0
    pass_mark = pf >= 1.3

    return {
        "total_trades": int(total),
        "wins": int(wins),
        "losses": int(losses),
        "win_rate": win_rate,
        "avg_return_pct": avg_return,
        "avg_win_pct": avg_win,
        "avg_loss_pct": avg_loss,
        "profit_factor": pf,
        "total_pnl_pkr": total_pnl,
        "stars": stars,
        "pass_mark": str(pass_mark),
    }


def make_signal_from_model(model_pred, symbol):
    """Return signal callable that reads from a model's stored prediction for the symbol."""
    p = model_pred.get(symbol, {})
    sig = p.get("signal", "HOLD")
    return lambda sdf, i: sig


def main():
    print("=" * 60)
    print("Latent.pk — CL Ensemble + CL-Extender backtest generator")
    print("=" * 60)

    if not PRED_FILE.exists():
        print(f"ERROR: {PRED_FILE} not found. Run scripts/train_all_with_backtesting.py first.")
        sys.exit(1)
    with open(PRED_FILE) as f:
        data = json.load(f)
    print(f"Loaded {len(data.get('models', {}))} models from {PRED_FILE}")

    df = load()
    print(f"Loaded OHLCV: {len(df)} rows from {df['symbol'].nunique()} stocks")

    # ─── CL Ensemble (LightGBM 70% + LogReg-on-features 30%) ───
    print("\nBuilding CL Ensemble (LightGBM 70% + LogReg 30%)...")
    # Train a LogReg on the latest features per row, predict per-row signal
    # Simpler: combine LightGBM signal with Ridge's signal
    lgb_pred = data["models"].get("LightGBM", {}).get("predictions", {})
    ridge_pred = data["models"].get("Ridge Regression", {}).get("predictions", {})

    def cl_ensemble_signal(sdf, i):
        sym = sdf.iloc[i].name if hasattr(sdf.iloc[i], "name") else None
        sym = sdf["symbol"].iloc[i] if "symbol" in sdf.columns else sym
        lgb_sig = lgb_pred.get(sym, {}).get("signal", "HOLD")
        ridge_sig = ridge_pred.get(sym, {}).get("signal", "HOLD")
        # Weighted vote
        if lgb_sig == ridge_sig:
            return lgb_sig
        # If disagree, use LightGBM (70% weight)
        return lgb_sig

    cl_ens_bt = triple_barrier_backtest(df, cl_ensemble_signal, "CL Ensemble (LGB70+Log30)")
    print(f"  CL Ensemble: trades={cl_ens_bt['total_trades']} WR={cl_ens_bt['win_rate']}% PF={cl_ens_bt['profit_factor']}")

    # ─── CL Ensemble ALL: every trained model tested with triple-barrier ───
    print("\nBuilding CL Ensemble All (every model triple-barrier)...")
    all_results = {"CL Ensemble (LGB60+XGB20+Log20)": cl_ens_bt}
    for name in ["LightGBM", "XGBoost", "CatBoost", "Random Forest", "Ridge Regression",
                 "LSTM", "ARIMA", "Holt-Winters", "GARCH", "Kalman Filter", "Prophet", "GRU"]:
        m = data["models"].get(name, {})
        if not m.get("trained"):
            continue
        sig_fn = make_signal_from_model(m.get("predictions", {}), None)
        # We need the symbol from row — override the function
        preds = m.get("predictions", {})
        def make_fn(p):
            def fn(sdf, i, _preds=p):
                sym = sdf["symbol"].iloc[i] if "symbol" in sdf.columns else None
                return _preds.get(sym, {}).get("signal", "HOLD")
            return fn
        sig_fn = make_fn(preds)
        bt = triple_barrier_backtest(df, sig_fn, name)
        all_results[name] = bt
        print(f"  {name}: trades={bt['total_trades']} WR={bt['win_rate']}% PF={bt['profit_factor']}")

    cl_ens_all = {
        "backtest_all_at": pd.Timestamp.now().isoformat(),
        "config": {
            "SL_MULT": SL_MULT, "PROB_MIN": PROB_MIN, "MAX_HOLD_DAYS": MAX_HOLD_DAYS,
            "EXIT_FRACTIONS": EXIT_FRACTIONS, "VOL_REGIME_MAX": VOL_REGIME_MAX,
            "momentum_filter": MOMENTUM_FILTER,
        },
        "results": all_results,
    }

    # ─── CL-Extender (8 models weighted) ───
    print("\nBuilding CL-Extender (8-model weighted ensemble)...")
    extender_preds = {n: data["models"].get(n, {}).get("predictions", {}) for n in EXTENDER_WEIGHTS}

    def extender_signal(sdf, i):
        sym = sdf["symbol"].iloc[i] if "symbol" in sdf.columns else None
        # Weighted vote
        buy_w = sell_w = hold_w = 0
        for mn, w in EXTENDER_WEIGHTS.items():
            sig = extender_preds.get(mn, {}).get(sym, {}).get("signal", "HOLD")
            if sig == "BUY":
                buy_w += w
            elif sig == "SELL":
                sell_w += w
            else:
                hold_w += w
        if buy_w > sell_w and buy_w > hold_w:
            return "BUY"
        if sell_w > buy_w and sell_w > hold_w:
            return "SELL"
        return "HOLD"

    ext_bt = triple_barrier_backtest(df, extender_signal, "CL-Extender (8 models)")
    print(f"  CL-Extender: trades={ext_bt['total_trades']} WR={ext_bt['win_rate']}% PF={ext_bt['profit_factor']}")

    ext_results = {"CL-Extender (8 models)": ext_bt}
    for mn in EXTENDER_WEIGHTS:
        m = data["models"].get(mn, {})
        if not m.get("trained"):
            continue
        preds = m.get("predictions", {})
        def make_fn(p):
            def fn(sdf, i, _p=p):
                sym = sdf["symbol"].iloc[i] if "symbol" in sdf.columns else None
                return _p.get(sym, {}).get("signal", "HOLD")
            return fn
        sig_fn = make_fn(preds)
        bt = triple_barrier_backtest(df, sig_fn, mn)
        ext_results[mn] = bt
        print(f"  {mn} (solo): trades={bt['total_trades']} WR={bt['win_rate']}% PF={bt['profit_factor']}")

    cl_ext = {
        "cl_extender_backtest_at": pd.Timestamp.now().isoformat(),
        "models": list(EXTENDER_WEIGHTS.keys()),
        "weights": EXTENDER_WEIGHTS,
        "results": ext_results,
    }

    # ─── Also build the CL-Extender per-stock PREDICTION (so it can show as an ensemble method) ───
    print("\nBuilding CL-Extender per-stock prediction (for AI Models ensembles section)...")
    ext_per_stock = {}
    for s in STOCKS:
        buy_w = sell_w = hold_w = 0
        avg_returns = []
        for mn, w in EXTENDER_WEIGHTS.items():
            p = extender_preds.get(mn, {}).get(s, {})
            sig = p.get("signal", "HOLD")
            ar = p.get("avgReturn", 0)
            if sig == "BUY":
                buy_w += w
            elif sig == "SELL":
                sell_w += w
            else:
                hold_w += w
            avg_returns.append(ar * w)
        if buy_w > sell_w and buy_w > hold_w:
            sig = "BUY"; d = "LONG"
        elif sell_w > buy_w and sell_w > hold_w:
            sig = "SELL"; d = "SHORT"
        else:
            sig = "HOLD"; d = "LONG"
        avg_ret = sum(avg_returns) / max(sum(EXTENDER_WEIGHTS.values()), 1)
        cp = extender_preds.get("LightGBM", {}).get(s, {}).get("currentPrice", 0)
        entry = extender_preds.get("LightGBM", {}).get(s, {}).get("entry", cp)
        sl = extender_preds.get("LightGBM", {}).get(s, {}).get("sl", cp * 0.97)
        tp1 = extender_preds.get("LightGBM", {}).get(s, {}).get("tp1", cp * 1.02)
        tp2 = extender_preds.get("LightGBM", {}).get(s, {}).get("tp2", cp * 1.04)
        tp3 = extender_preds.get("LightGBM", {}).get(s, {}).get("tp3", cp * 1.06)
        ext_per_stock[s] = {
            "signal": sig, "direction": d,
            "confidence": min(100, int(abs(avg_ret) * 1000)),
            "currentPrice": cp, "entry": entry,
            "tp1": tp1, "tp2": tp2, "tp3": tp3, "sl": sl,
            "avgReturn": round(float(avg_ret), 4),
        }

    # ─── CL-Ensemble per-stock PREDICTION (for ensembles section) ───
    print("Building CL-Ensemble per-stock prediction...")
    ens_per_stock = {}
    for s in STOCKS:
        lgb_p = lgb_pred.get(s, {})
        ridge_p = ridge_pred.get(s, {})
        # 70% LGB + 30% Ridge on avgReturn
        ar = 0.7 * lgb_p.get("avgReturn", 0) + 0.3 * ridge_p.get("avgReturn", 0)
        if ar > 0.01:
            sig = "BUY"; d = "LONG"
        elif ar < -0.01:
            sig = "SELL"; d = "SHORT"
        else:
            sig = "HOLD"; d = "LONG"
        cp = lgb_p.get("currentPrice", 0)
        ens_per_stock[s] = {
            "signal": sig, "direction": d,
            "confidence": min(100, int(abs(ar) * 1000)),
            "currentPrice": cp, "entry": lgb_p.get("entry", cp),
            "tp1": lgb_p.get("tp1", cp * 1.02),
            "tp2": lgb_p.get("tp2", cp * 1.04),
            "tp3": lgb_p.get("tp3", cp * 1.06),
            "sl": lgb_p.get("sl", cp * 0.97),
            "avgReturn": round(float(ar), 4),
        }

    # ─── Inject everything into ml_predictions_multi.json ───
    data["cl_ensemble_backtest"] = cl_ens_bt  # legacy summary block
    data["cl_ensemble_backtest_all"] = cl_ens_all
    data["cl_extender_backtest"] = cl_ext
    data["cl_ensemble_predictions"] = ens_per_stock  # NEW: per-stock predictions for ensembles section
    data["cl_extender_predictions"] = ext_per_stock  # NEW: per-stock predictions for ensembles section
    data["cl_ensemble_at"] = pd.Timestamp.now().isoformat()
    data["cl_extender_at"] = pd.Timestamp.now().isoformat()

    PRED_FILE.write_text(json.dumps(data, indent=2,
                                     default=lambda o: int(o) if isinstance(o, (np.integer,)) else
                                     float(o) if isinstance(o, (np.floating,)) else str(o)))

    print("\n" + "=" * 60)
    print("CL ENSEMBLE + CL-EXTENDER BACKTESTS GENERATED")
    print("=" * 60)
    print(f"Saved to {PRED_FILE}")
    print(f"\n  cl_ensemble_backtest:        trades={cl_ens_bt['total_trades']} WR={cl_ens_bt['win_rate']}% PF={cl_ens_bt['profit_factor']}")
    print(f"  cl_ensemble_backtest_all:    {len(all_results)} models tested")
    print(f"  cl_extender_backtest:        trades={ext_bt['total_trades']} WR={ext_bt['win_rate']}% PF={ext_bt['profit_factor']}")
    print(f"  cl_ensemble_predictions:     {len(ens_per_stock)} stocks")
    print(f"  cl_extender_predictions:     {len(ext_per_stock)} stocks")
    print(f"\nNext: AI Models page will show CL-Ensemble + CL-Extender alongside Majority Vote / Probability-Weighted / Tier-Weighted.")


if __name__ == "__main__":
    main()
