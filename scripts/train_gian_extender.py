#!/usr/bin/env python3
"""Gian-Extender Ensemble: GANN square-of-9 support/resistance levels.

Uses the FIXED price levels from the "Linear GANN 2.0" Pine Script
(provided by the user) instead of dynamically computing from sqrt(price).

The GANN levels are the squares of odd numbers (1², 3², 5², 7², 9², ...)
plus some additional levels, forming a fixed grid of support/resistance.

Signal rules are the same as Gian-Ensemble:
  - BUY when price within 2% of a support level
  - SELL when price within 2% of a resistance level
  - SL/TP: ATR-based (same as CG/X/Gian)
  - Cost: 50 bps round-trip + 15% CGT on gains
  - Entry: next-bar-open (no look-ahead)
  - Test: last 25% of bars (untouched OOS)
"""
from __future__ import annotations
import json, sys, time, math, warnings
from pathlib import Path
from typing import Dict, List, Tuple, Optional
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

sys.path.insert(0, str(Path(__file__).parent))
from train_cl2_tier import (
    OHLCV_DIR, PRED_FILE, FC,
    add_features, load_ohlcv, get_atr_per_stock,
    StockSupportCache, MIN_PRED_BARS,
)
from train_cg_model import (
    CG_TP1_MULT, CG_TP2_MULT, CG_TP3_MULT, CG_HORIZON,
    COST_ROUND_TRIP, CGT_RATE,
    compute_cg_sl_and_targets,
)

GE_TEST_FRAC = 0.75

# The GANN price levels from the Pine Script "Linear GANN 2.0"
# These are the squares of consecutive odd numbers + some additional levels
# 1²=1, 3²=9, 5²=25, 7²=49, 9²=81, 11²=121, 13²=169, 15²=225, 17²=289, 19²=361, 21²=441, 23²=529, 25²=625, ...
GANN_LEVELS = [
    1.0, 5.0, 9.0, 17.0, 25.0, 37.0, 49.0, 65.0, 81.0, 101.0, 121.0, 145.0, 169.0, 197.0, 225.0, 257.0, 289.0, 325.0, 361.0, 401.0,
    441.0, 485.0, 529.0, 577.0, 625.0, 677.0, 729.0, 785.0, 841.0, 901.0, 961.0, 1025.0, 1089.0, 1157.0, 1225.0, 1297.0, 1369.0, 1445.0, 1521.0, 1601.0,
    1681.0, 1765.0, 1849.0, 1937.0, 2025.0, 2117.0, 2209.0, 2305.0, 2401.0, 2501.0, 2601.0, 2705.0, 2809.0, 2917.0, 3025.0, 3137.0, 3249.0, 3365.0, 3481.0, 3601.0,
    3721.0, 3845.0, 3969.0, 4097.0, 4225.0, 4357.0, 4489.0, 4625.0, 4761.0, 4901.0, 5041.0, 5185.0, 5329.0, 5477.0, 5625.0, 5777.0, 5929.0, 6085.0, 6241.0, 6401.0,
    6561.0, 6725.0, 6889.0, 7057.0, 7225.0, 7397.0, 7569.0, 7745.0, 7921.0, 8101.0, 8281.0, 8465.0, 8649.0, 8837.0, 9025.0, 9217.0, 9409.0, 9605.0, 9801.0, 10001.0,
]

# For stocks priced above 10000, extend the grid
for i in range(101, 401, 2):
    GANN_LEVELS.append(float(i * i))
    GANN_LEVELS.append(float(i * i + 2 * (i - 1)))  # i² + (i-1)² pattern
GANN_LEVELS = sorted(set(GANN_LEVELS))

ENTRY_ZONE_PCT = 0.02  # within 2% of level = "near"


def find_nearest_gann_levels(cp: float) -> Tuple[float, float, float, float, float, float, int]:
    """Find the 3 nearest GANN levels below (supports) and above (resistances).
    Returns (s1, s2, s3, r1, r2, r3, nearest_level_index).
    """
    levels = np.array(GANN_LEVELS)
    below = levels[levels <= cp]
    above = levels[levels > cp]
    
    # Sort below descending (closest below first)
    below_sorted = np.sort(below)[::-1] if len(below) > 0 else np.array([0.0, 0.0, 0.0])
    # Sort above ascending (closest above first)
    above_sorted = np.sort(above) if len(above) > 0 else np.array([0.0, 0.0, 0.0])
    
    s1 = float(below_sorted[0]) if len(below_sorted) > 0 else 0.0
    s2 = float(below_sorted[1]) if len(below_sorted) > 1 else 0.0
    s3 = float(below_sorted[2]) if len(below_sorted) > 2 else 0.0
    
    r1 = float(above_sorted[0]) if len(above_sorted) > 0 else 0.0
    r2 = float(above_sorted[1]) if len(above_sorted) > 1 else 0.0
    r3 = float(above_sorted[2]) if len(above_sorted) > 2 else 0.0
    
    return s1, s2, s3, r1, r2, r3, 0


def compute_ge_signal(cp: float, atr: float, support: float, resistance: float,
                      gann_levels: Tuple) -> Tuple[str, str, float, float, float, float, float]:
    """Generate signal: BUY near support, SELL near resistance.
    Uses GANN levels for support/resistance detection, ATR-based SL/TP.
    """
    s1, s2, s3, r1, r2, r3, _ = gann_levels
    
    near_support = False
    for s in [s1, s2, s3]:
        if s > 0 and abs(cp - s) / cp < ENTRY_ZONE_PCT:
            near_support = True
            break
    
    near_resistance = False
    for r in [r1, r2, r3]:
        if r > 0 and abs(cp - r) / cp < ENTRY_ZONE_PCT:
            near_resistance = True
            break
    
    if near_support and not near_resistance:
        signal = "BUY"
    elif near_resistance and not near_support:
        signal = "SELL"
    elif near_support and near_resistance:
        min_s_dist = min([abs(cp - s) / cp for s in [s1, s2, s3] if s > 0])
        min_r_dist = min([abs(cp - r) / cp for r in [r1, r2, r3] if r > 0])
        signal = "BUY" if min_s_dist < min_r_dist else "SELL"
    else:
        signal = "HOLD"
    
    sl, tp1, tp2, tp3, skip = compute_cg_sl_and_targets(
        cp, atr, support, resistance, signal if signal != "HOLD" else "BUY"
    )
    if signal == "HOLD":
        sl = cp; tp1 = cp; tp2 = cp; tp3 = cp
    return signal, "LONG" if signal != "SELL" else "SHORT", sl, tp1, tp2, tp3, skip


def compute_label(sd, t, direction, sl, tp1, tp2, tp3, horizon=CG_HORIZON,
                   high_arr=None, low_arr=None, open_arr=None, close_arr=None):
    entry_t = t + 1
    n = len(close_arr) if close_arr is not None else len(sd)
    if entry_t >= n:
        return 4, 0.0, "no_data"
    entry_price = float(open_arr[entry_t]) if open_arr is not None else float(sd.iloc[entry_t]["open"])
    if entry_price <= 0:
        return 4, 0.0, "invalid_entry"
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
            if h >= tp3 and highest_tp < 3: highest_tp = 3
            elif h >= tp2 and highest_tp < 2: highest_tp = 2
            elif h >= tp1 and highest_tp < 1: highest_tp = 1
        else:
            if h >= sl:
                return 0, sl, "sl"
            if l <= tp3 and highest_tp < 3: highest_tp = 3
            elif l <= tp2 and highest_tp < 2: highest_tp = 2
            elif l <= tp1 and highest_tp < 1: highest_tp = 1
    if highest_tp == 3: return 3, tp3, "tp3"
    elif highest_tp == 2: return 2, tp2, "tp2"
    elif highest_tp == 1: return 1, tp1, "tp1"
    else:
        last_close = float(close_arr[end_t - 1]) if close_arr is not None else float(sd.iloc[end_t - 1]["close"])
        return 4, last_close, "timeout"


def compute_net_return(direction, entry_price, exit_price):
    if direction == "BUY":
        gross = (exit_price - entry_price) / entry_price
    else:
        gross = (entry_price - exit_price) / entry_price
    net = gross - COST_ROUND_TRIP
    if net > 0:
        net = net - net * CGT_RATE
    return float(net)


def wilson_ci(k, n, z=1.96):
    if n == 0: return 0.0, 0.0
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    spread = z * np.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom
    return max(0, center - spread), min(1, center + spread)


def predict_all_stocks(stocks, df_all, atr_per):
    print("\n[GIAN-EXT] Generating per-stock predictions...")
    ge_predictions = {}

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

        gann_levels = find_nearest_gann_levels(cp)
        signal, direction, sl, tp1, tp2, tp3, skip = compute_ge_signal(
            cp, atr, support, resistance, gann_levels
        )

        s1, s2, s3, r1, r2, r3, _ = gann_levels
        ge_predictions[s] = {
            "signal": signal,
            "direction": direction,
            "confidence": int(80 if signal != "HOLD" else 20),
            "currentPrice": round(cp, 2),
            "entry": round(cp, 2),
            "tp1": round(tp1, 2), "tp2": round(tp2, 2), "tp3": round(tp3, 2),
            "sl": round(sl, 2),
            "avgReturn": 0.0,
            "gann_levels": {
                "s1": s1, "s2": s2, "s3": s3,
                "r1": r1, "r2": r2, "r3": r3,
                "source": "Linear GANN 2.0 Pine Script (Adib Noorani)",
            },
        }

        if (si + 1) % 50 == 0:
            print(f"  {si+1}/{len(stocks)} stocks processed...")

    print(f"  Done: {len(ge_predictions)} stocks have Gian-Extender predictions")
    return ge_predictions


def backtest_ge(stocks, df_all, atr_per):
    print(f"\n[GIAN-EXT] Backtesting on test period (last {100-GE_TEST_FRAC*100:.0f}%, untouched OOS)...")
    trades = []

    for s in stocks:
        sd = df_all[df_all["symbol"] == s].sort_values("date").reset_index(drop=True)
        n = len(sd)
        if n < MIN_PRED_BARS + CG_HORIZON + 20:
            continue
        sp = int(n * GE_TEST_FRAC)
        if sp >= n - 5:
            continue
        sc = StockSupportCache(sd)
        close_arr = sd["close"].values.astype(np.float64)
        high_arr = sd["high"].values.astype(np.float64)
        low_arr = sd["low"].values.astype(np.float64)
        open_arr = sd["open"].values.astype(np.float64)
        atr_arr = sd["atr_14"].values.astype(np.float64)

        for t in range(sp, n - 5, 5):
            cp = float(close_arr[t])
            atr = float(atr_arr[t])
            if atr <= 0 or cp <= 0:
                continue
            support = sc.support_at(t)
            resistance = sc.resistance_at(t)
            if np.isnan(support) or np.isnan(resistance):
                continue

            gann_levels = find_nearest_gann_levels(cp)
            signal, direction, sl, tp1, tp2, tp3, skip = compute_ge_signal(
                cp, atr, support, resistance, gann_levels
            )
            if signal == "HOLD":
                continue

            label, exit_price, exit_reason = compute_label(
                sd, t, direction, sl, tp1, tp2, tp3, horizon=CG_HORIZON,
                high_arr=high_arr, low_arr=low_arr, open_arr=open_arr, close_arr=close_arr,
            )
            entry_price = float(open_arr[t + 1]) if t + 1 < len(open_arr) else cp
            if entry_price <= 0:
                continue
            net_ret = compute_net_return(direction, entry_price, exit_price)
            trades.append({
                "symbol": s, "t": t, "direction": direction,
                "signal": signal, "label": label, "net_ret": net_ret,
            })

    if not trades:
        print("  ! No trades generated")
        return _empty_bt()

    rets = np.array([tr["net_ret"] for tr in trades], dtype=float)
    valid = np.isfinite(rets)
    if not valid.all():
        print(f"  ! Dropping {int((~valid).sum())} non-finite trades")
    rets = rets[valid]
    labels = np.array([tr["label"] for tr in trades])[valid]
    sigs = np.array([tr["signal"] for tr in trades])[valid]

    n = len(rets)
    wins = rets > 0
    losses = rets <= 0
    win_count = int(wins.sum())
    loss_count = int(losses.sum())
    win_rate = win_count / n

    tp1_hits = int(np.isin(labels, [1, 2, 3]).sum())
    sl_count = int((labels == 0).sum())
    tp1_count = int((labels == 1).sum())
    tp2_count = int((labels == 2).sum())
    tp3_count = int((labels == 3).sum())
    timeout_count = int((labels == 4).sum())
    precision = tp1_hits / n
    ci_low, ci_high = wilson_ci(tp1_hits, n)

    gains = rets[rets > 0]
    losses_vals = -rets[rets < 0]
    gross_profit = float(gains.sum()) if gains.any() else 0
    gross_loss = float(losses_vals.sum()) if losses_vals.any() else 0
    pf = gross_profit / max(gross_loss, 1e-9)
    avg_ret = float(rets.mean())
    median_ret = float(np.median(rets))
    if rets.std() > 0:
        sharpe = float(rets.mean() / rets.std() * np.sqrt(252))
    else:
        sharpe = 0.0
    downside = rets[rets < 0]
    sortino = float(rets.mean() / downside.std() * np.sqrt(252)) if len(downside) > 0 and downside.std() > 0 else 0.0
    log_rets = np.log1p(np.clip(rets, -0.99, None))
    cum_log = np.cumsum(log_rets)
    peak_log = np.maximum.accumulate(cum_log)
    dd_log = cum_log - peak_log
    max_dd_pct = float((np.exp(dd_log.min()) - 1) * 100)

    buy_count = int((sigs == "BUY").sum())
    sell_count = int((sigs == "SELL").sum())
    correct_buys = int(sum(1 for s, r in zip(sigs, rets) if s == "BUY" and r > 0))
    correct_sells = int(sum(1 for s, r in zip(sigs, rets) if s == "SELL" and r > 0))

    print(f"  Trades: {n} | Wins: {win_count} | Losses: {loss_count} | "
          f"Win rate: {win_rate*100:.1f}% | Avg: {avg_ret*100:.2f}% | "
          f"PF: {pf:.3f} | Sharpe: {sharpe:.2f}")

    return {
        "totalTrades": n, "buySignals": buy_count, "sellSignals": sell_count,
        "correctBuys": correct_buys, "correctSells": correct_sells,
        "winRate": round(win_rate * 100, 1),
        "avgReturnPct": round(avg_ret * 100, 2),
        "maxReturnPct": round(float(rets.max() * 100), 2),
        "minReturnPct": round(float(rets.min() * 100), 2),
        "stars": int(min(5, max(1, int(win_rate * 100 / 20) + 1))),
        "profitFactor": round(pf, 3), "profit_factor": round(pf, 3),
        "costBps": int(COST_ROUND_TRIP * 10000),
        "winTrades": win_count, "lossTrades": loss_count,
        "tp1HitRate": round(tp1_count / n, 4),
        "tp2HitRate": round(tp2_count / n, 4),
        "tp3HitRate": round(tp3_count / n, 4),
        "tp1_count": tp1_count, "tp2_count": tp2_count, "tp3_count": tp3_count,
        "sl_count": sl_count, "timeout_count": timeout_count,
        "precision": round(precision, 4),
        "precision_ci_low": round(ci_low, 4), "precision_ci_high": round(ci_high, 4),
        "net_expectancy_pct": round(avg_ret * 100, 3),
        "median_return_pct": round(median_ret * 100, 3),
        "sharpe": round(sharpe, 3), "sortino": round(sortino, 3),
        "maxDrawdownPct": round(max_dd_pct, 2),
        "max_drawdown_pct": round(max_dd_pct, 2),
        "method": "gian_extender",
        "strategy": "GANN square-of-9 fixed price levels (Linear GANN 2.0 Pine Script)",
        "horizon": CG_HORIZON,
        "tps": f"{CG_TP1_MULT}R/{CG_TP2_MULT}R/{CG_TP3_MULT}R",
        "entry_zone_pct": ENTRY_ZONE_PCT,
        "cost_model": {"round_trip_pct": COST_ROUND_TRIP * 100, "cgt_rate_pct": CGT_RATE * 100},
    }


def _empty_bt():
    return {
        "totalTrades": 0, "buySignals": 0, "sellSignals": 0,
        "correctBuys": 0, "correctSells": 0,
        "winRate": 0, "avgReturnPct": 0, "maxReturnPct": 0, "minReturnPct": 0,
        "stars": 0, "profitFactor": 0, "costBps": int(COST_ROUND_TRIP * 10000),
        "winTrades": 0, "lossTrades": 0,
        "tp1HitRate": 0, "tp2HitRate": 0, "tp3HitRate": 0,
        "tp1_count": 0, "tp2_count": 0, "tp3_count": 0,
        "sl_count": 0, "timeout_count": 0,
        "precision": 0, "net_expectancy_pct": 0, "sharpe": 0, "sortino": 0,
        "maxDrawdownPct": 0, "max_drawdown_pct": 0,
        "method": "gian_extender",
    }


def save_to_json(ge_predictions, ge_bt):
    print(f"\n[GIAN-EXT] Saving to {PRED_FILE}...")
    with open(PRED_FILE, "r") as f:
        existing = json.load(f)
    models_dict = existing.get("models", {})
    models_dict["Gian-Extender (GIAN-EXT)"] = {
        "trained": True, "version": "1.0.0", "predictions": ge_predictions,
    }
    existing["models"] = models_dict
    existing["gian_extender_predictions"] = ge_predictions
    ens_bt = existing.get("ensemble_backtesting", {})
    ens_bt["GIAN_EXTENDER"] = ge_bt
    existing["ensemble_backtesting"] = ens_bt
    existing["gian_extender_metadata"] = {
        "trained_at": pd.Timestamp.now().isoformat(),
        "strategy": "GANN square-of-9 fixed price levels (Linear GANN 2.0 Pine Script by Adib Noorani)",
        "levels_source": "Fixed GANN grid: 1, 9, 25, 49, 81, 121, 169, 225, 289, 361, 441, 529, 625, ...",
        "signal_rules": "BUY when price within 2% of support; SELL when within 2% of resistance",
        "sl_rule": "ATR-based (support/ATR combined, min 0.5×ATR) — same as CG/X/Gian",
        "tp_rule": f"TP1/2/3 = {CG_TP1_MULT}R/{CG_TP2_MULT}R/{CG_TP3_MULT}R",
        "horizon": f"{CG_HORIZON} trading days",
        "cost_model": {"round_trip_pct": COST_ROUND_TRIP * 100, "cgt_rate_pct": CGT_RATE * 100},
        "test_period": f"last {100-GE_TEST_FRAC*100:.0f}% of bars (untouched OOS)",
        "entry_method": "next-bar-open (no look-ahead)",
        "note": "Uses the same GANN price levels from the user's Pine Script indicator",
    }
    def clean(o):
        if isinstance(o, dict): return {k: clean(v) for k, v in o.items()}
        if isinstance(o, list): return [clean(v) for v in o]
        if isinstance(o, float):
            if math.isnan(o) or math.isinf(o): return 0
            return o
        return o
    with open(PRED_FILE, "w") as f:
        json.dump(clean(existing), f, indent=2, allow_nan=False)
    print(f"  Saved. File size: {PRED_FILE.stat().st_size / 1024 / 1024:.1f} MB")


def main():
    start = time.time()
    print("=" * 70)
    print("Gian-Extender Ensemble: GANN square-of-9 support/resistance")
    print("  Levels: Fixed GANN grid from Linear GANN 2.0 Pine Script")
    print("  Rules: Same as Gian-Ensemble (BUY near support, SELL near resistance)")
    print(f"  SL/TP: ATR-based, TP1/2/3 = {CG_TP1_MULT}R/{CG_TP2_MULT}R/{CG_TP3_MULT}R")
    print(f"  Cost: {COST_ROUND_TRIP*100:.2f}% round-trip + {CGT_RATE*100:.0f}% CGT on gains")
    print(f"  Test: last {100-GE_TEST_FRAC*100:.0f}% of bars, next-bar-open entries")
    print(f"  GANN levels count: {len(GANN_LEVELS)} (range: {min(GANN_LEVELS):.0f} - {max(GANN_LEVELS):.0f})")
    print("=" * 70)

    all_stocks = sorted([f.stem for f in OHLCV_DIR.glob("*.csv")])
    print(f"\nStocks: {len(all_stocks)}")

    print("\n[1/3] Loading OHLCV...")
    df_all = load_ohlcv(all_stocks)
    if df_all.empty:
        print("ERROR: No OHLCV data")
        sys.exit(1)
    print(f"  {len(df_all):,} rows, {df_all['symbol'].nunique()} stocks")

    print("\n[2/3] Computing ATR + generating per-stock predictions...")
    atr_per = get_atr_per_stock(df_all)
    ge_predictions = predict_all_stocks(all_stocks, df_all, atr_per)

    print("\n  Example GANN levels:")
    for sym in ["ENGRO", "MARI", "LUCK", "PRL"]:
        p = ge_predictions.get(sym, {})
        gl = p.get("gann_levels", {})
        if gl:
            print(f"    {sym} (price={p.get('currentPrice')}): "
                  f"S1={gl.get('s1')}, S2={gl.get('s2')}, S3={gl.get('s3')}, "
                  f"R1={gl.get('r1')}, R2={gl.get('r2')}, R3={gl.get('r3')}, "
                  f"signal={p.get('signal')}")

    print("\n[3/3] Backtesting on test period (untouched OOS)...")
    ge_bt = backtest_ge(all_stocks, df_all, atr_per)

    save_to_json(ge_predictions, ge_bt)

    elapsed = time.time() - start
    print(f"\n{'='*70}")
    print(f"Gian-Extender complete in {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print(f"{'='*70}")
    print(f"  Stocks with predictions: {len(ge_predictions)}")
    print(f"  Backtest: {ge_bt['totalTrades']} trades, "
          f"winTrades={ge_bt['winTrades']}, lossTrades={ge_bt['lossTrades']}, "
          f"winRate={ge_bt['winRate']}%, avgRet={ge_bt['avgReturnPct']}%, "
          f"PF={ge_bt['profitFactor']}, Sharpe={ge_bt['sharpe']}, "
          f"MaxDD={ge_bt['max_drawdown_pct']}%")


if __name__ == "__main__":
    main()
