#!/usr/bin/env python3
"""M-Ensemble: Historical price-touch support/resistance with ATR clustering.

Strategy:
1. Scan ALL historical daily data for each stock.
2. Find price levels where the price "touched" the most (cluster of highs/lows).
3. Use ATR to cluster nearby touches into support/resistance zones.
4. Take the 3 nearest supports (below current price) and 3 nearest resistances (above).
5. BUY when price near support, SELL when near resistance.
6. SL/TP: same ATR-based rule as CG/X/Gian (TP1=1R, TP2=2R, TP3=3R).

The "touch" detection: for each historical bar, if the high or low is within
0.5×ATR of a price level, that level gets +1 touch. Then we cluster all
touched levels using a 1×ATR window and pick the top clusters by touch count.
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
    OHLCV_DIR, PRED_FILE,
    add_features, load_ohlcv, get_atr_per_stock,
    StockSupportCache, MIN_PRED_BARS,
)
from train_cg_model import (
    CG_TP1_MULT, CG_TP2_MULT, CG_TP3_MULT, CG_HORIZON,
    COST_ROUND_TRIP, CGT_RATE,
    compute_cg_sl_and_targets,
)

M_TEST_FRAC = 0.75
ENTRY_ZONE_PCT = 0.02  # within 2% of level


def find_touch_sr_levels(high_arr, low_arr, close_arr, atr_arr, t, n_levels=3):
    """Find support/resistance levels by counting price touches.

    A "touch" = high or low within 0.5×ATR of a price level.
    Cluster touches using a 1×ATR window, then pick top clusters by touch count.

    Returns (s1, s2, s3, r1, r2, r3) — 3 supports below cp, 3 resistances above cp.
    """
    if t < 50:
        return [], []

    cp = float(close_arr[t])
    atr = float(atr_arr[t]) if not np.isnan(atr_arr[t]) else cp * 0.02
    if atr <= 0:
        atr = cp * 0.02

    touch_radius = atr * 0.5  # how close to a level counts as a "touch"
    cluster_radius = atr * 1.0  # merge levels within 1×ATR

    # Collect all significant highs and lows from the lookback window
    # Use bars [t-250, t] (or all available if < 250)
    lookback = min(t, 250)
    highs = high_arr[t-lookback:t+1]
    lows = low_arr[t-lookback:t+1]
    atrs = atr_arr[t-lookback:t+1]

    # For each bar, register the high and low as candidate levels
    candidates = []  # list of (price, touch_type, atr_at_touch)
    for i in range(len(highs)):
        h = float(highs[i])
        l = float(lows[i])
        a = float(atrs[i]) if not np.isnan(atrs[i]) else atr
        if a <= 0:
            a = atr
        # High = potential resistance touch
        candidates.append((h, 'R', a))
        # Low = potential support touch
        candidates.append((l, 'S', a))

    if not candidates:
        return [], []

    # Sort by price
    candidates.sort(key=lambda x: x[0])

    # Cluster: merge candidates within cluster_radius of each other
    clusters = []  # list of {center, count, type}
    current_cluster = {"prices": [candidates[0][0]], "count": 1, "types": [candidates[0][1]]}

    for i in range(1, len(candidates)):
        price, typ, a = candidates[i]
        if price - current_cluster["prices"][-1] <= cluster_radius:
            current_cluster["prices"].append(price)
            current_cluster["count"] += 1
            current_cluster["types"].append(typ)
        else:
            # Finalize cluster
            clusters.append({
                "center": np.mean(current_cluster["prices"]),
                "count": current_cluster["count"],
                "r_count": current_cluster["types"].count('R'),
                "s_count": current_cluster["types"].count('S'),
            })
            current_cluster = {"prices": [price], "count": 1, "types": [typ]}

    # Add last cluster
    clusters.append({
        "center": np.mean(current_cluster["prices"]),
        "count": current_cluster["count"],
        "r_count": current_cluster["types"].count('R'),
        "s_count": current_cluster["types"].count('S'),
    })

    # Split into supports (below cp) and resistances (above cp)
    supports = sorted([c for c in clusters if c["center"] < cp], key=lambda x: -x["center"])  # closest below first
    resistances = sorted([c for c in clusters if c["center"] >= cp], key=lambda x: x["center"])  # closest above first

    # Pick top 3 by touch count (prefer levels with more touches)
    supports = sorted(supports, key=lambda x: (-x["count"], -x["center"]))[:n_levels]
    resistances = sorted(resistances, key=lambda x: (-x["count"], x["center"]))[:n_levels]

    # Sort by proximity to cp (closest first)
    supports = sorted(supports, key=lambda x: -x["center"])[:n_levels]  # highest (closest to cp) first
    resistances = sorted(resistances, key=lambda x: x["center"])[:n_levels]  # lowest (closest to cp) first

    s_levels = [c["center"] for c in supports[:n_levels]]
    r_levels = [c["center"] for c in resistances[:n_levels]]

    # Pad with 0 if fewer than 3
    while len(s_levels) < n_levels:
        s_levels.append(0.0)
    while len(r_levels) < n_levels:
        r_levels.append(0.0)

    return s_levels, r_levels


def compute_m_signal(cp, atr, support, resistance, m_levels):
    """Signal: BUY near support, SELL near resistance."""
    s_levels, r_levels = m_levels

    near_support = False
    for s in s_levels:
        if s > 0 and abs(cp - s) / cp < ENTRY_ZONE_PCT:
            near_support = True
            break

    near_resistance = False
    for r in r_levels:
        if r > 0 and abs(cp - r) / cp < ENTRY_ZONE_PCT:
            near_resistance = True
            break

    if near_support and not near_resistance:
        signal = "BUY"
    elif near_resistance and not near_support:
        signal = "SELL"
    elif near_support and near_resistance:
        min_s_dist = min([abs(cp - s) / cp for s in s_levels if s > 0]) if any(s > 0 for s in s_levels) else 1
        min_r_dist = min([abs(cp - r) / cp for r in r_levels if r > 0]) if any(r > 0 for r in r_levels) else 1
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
            if l <= sl: return 0, sl, "sl"
            if h >= tp3 and highest_tp < 3: highest_tp = 3
            elif h >= tp2 and highest_tp < 2: highest_tp = 2
            elif h >= tp1 and highest_tp < 1: highest_tp = 1
        else:
            if h >= sl: return 0, sl, "sl"
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
    print("\n[M-ENS] Generating per-stock predictions...")
    m_predictions = {}

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

        high_arr = sd["high"].values.astype(np.float64)
        low_arr = sd["low"].values.astype(np.float64)
        close_arr = sd["close"].values.astype(np.float64)
        atr_arr = sd["atr_14"].values.astype(np.float64)

        s_levels, r_levels = find_touch_sr_levels(high_arr, low_arr, close_arr, atr_arr, t)
        signal, direction, sl, tp1, tp2, tp3, skip = compute_m_signal(
            cp, atr, support, resistance, (s_levels, r_levels)
        )

        m_predictions[s] = {
            "signal": signal,
            "direction": direction,
            "confidence": int(80 if signal != "HOLD" else 20),
            "currentPrice": round(cp, 2),
            "entry": round(cp, 2),
            "tp1": round(tp1, 2), "tp2": round(tp2, 2), "tp3": round(tp3, 2),
            "sl": round(sl, 2),
            "avgReturn": 0.0,
            "m_levels": {
                "s1": round(s_levels[0], 2) if len(s_levels) > 0 else 0,
                "s2": round(s_levels[1], 2) if len(s_levels) > 1 else 0,
                "s3": round(s_levels[2], 2) if len(s_levels) > 2 else 0,
                "r1": round(r_levels[0], 2) if len(r_levels) > 0 else 0,
                "r2": round(r_levels[1], 2) if len(r_levels) > 1 else 0,
                "r3": round(r_levels[2], 2) if len(r_levels) > 2 else 0,
                "method": "Historical price-touch clustering with ATR",
            },
        }

        if (si + 1) % 50 == 0:
            print(f"  {si+1}/{len(stocks)} stocks processed...")

    print(f"  Done: {len(m_predictions)} stocks have M-Ensemble predictions")
    return m_predictions


def backtest_m(stocks, df_all, atr_per):
    print(f"\n[M-ENS] Backtesting on test period (last {100-M_TEST_FRAC*100:.0f}%, untouched OOS)...")
    trades = []

    for s in stocks:
        sd = df_all[df_all["symbol"] == s].sort_values("date").reset_index(drop=True)
        n = len(sd)
        if n < MIN_PRED_BARS + CG_HORIZON + 20:
            continue
        sp = int(n * M_TEST_FRAC)
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

            # Use only data up to bar t (no look-ahead) for touch detection
            s_levels, r_levels = find_touch_sr_levels(high_arr, low_arr, close_arr, atr_arr, t)
            signal, direction, sl, tp1, tp2, tp3, skip = compute_m_signal(
                cp, atr, support, resistance, (s_levels, r_levels)
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
        "method": "m_ensemble",
        "strategy": "Historical price-touch support/resistance with ATR clustering",
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
        "method": "m_ensemble",
    }


def save_to_json(m_predictions, m_bt):
    print(f"\n[M-ENS] Saving to {PRED_FILE}...")
    with open(PRED_FILE, "r") as f:
        existing = json.load(f)
    models_dict = existing.get("models", {})
    models_dict["M-Ensemble (M)"] = {
        "trained": True, "version": "1.0.0", "predictions": m_predictions,
    }
    existing["models"] = models_dict
    existing["m_ensemble_predictions"] = m_predictions
    ens_bt = existing.get("ensemble_backtesting", {})
    ens_bt["M_ENSEMBLE"] = m_bt
    existing["ensemble_backtesting"] = ens_bt
    existing["m_metadata"] = {
        "trained_at": pd.Timestamp.now().isoformat(),
        "strategy": "Historical price-touch support/resistance with ATR clustering",
        "method": "Scan all historical highs/lows, cluster within 1×ATR, count touches, pick top 3 supports + 3 resistances",
        "signal_rules": "BUY when price within 2% of support; SELL when within 2% of resistance",
        "sl_rule": "ATR-based (support/ATR combined, min 0.5×ATR) — same as CG/X/Gian",
        "tp_rule": f"TP1/2/3 = {CG_TP1_MULT}R/{CG_TP2_MULT}R/{CG_TP3_MULT}R",
        "horizon": f"{CG_HORIZON} trading days",
        "cost_model": {"round_trip_pct": COST_ROUND_TRIP * 100, "cgt_rate_pct": CGT_RATE * 100},
        "test_period": f"last {100-M_TEST_FRAC*100:.0f}% of bars (untouched OOS)",
        "entry_method": "next-bar-open (no look-ahead)",
        "lookback": "250 bars (or all available if less)",
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
    print("M-Ensemble: Historical price-touch S/R with ATR clustering")
    print("  Method: Scan all historical highs/lows, cluster within 1×ATR,")
    print("         pick top 3 supports + 3 resistances by touch count")
    print("  BUY near support, SELL near resistance (within 2%)")
    print(f"  SL/TP: ATR-based, TP1/2/3 = {CG_TP1_MULT}R/{CG_TP2_MULT}R/{CG_TP3_MULT}R")
    print(f"  Cost: {COST_ROUND_TRIP*100:.2f}% round-trip + {CGT_RATE*100:.0f}% CGT on gains")
    print(f"  Test: last {100-M_TEST_FRAC*100:.0f}% of bars, next-bar-open entries")
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
    m_predictions = predict_all_stocks(all_stocks, df_all, atr_per)

    print("\n  Example M-Ensemble levels:")
    for sym in ["ENGRO", "MARI", "LUCK", "PRL"]:
        p = m_predictions.get(sym, {})
        ml = p.get("m_levels", {})
        if ml:
            print(f"    {sym} (price={p.get('currentPrice')}): "
                  f"S1={ml.get('s1')}, S2={ml.get('s2')}, S3={ml.get('s3')}, "
                  f"R1={ml.get('r1')}, R2={ml.get('r2')}, R3={ml.get('r3')}, "
                  f"signal={p.get('signal')}")

    print("\n[3/3] Backtesting on test period (untouched OOS)...")
    m_bt = backtest_m(all_stocks, df_all, atr_per)

    save_to_json(m_predictions, m_bt)

    elapsed = time.time() - start
    print(f"\n{'='*70}")
    print(f"M-Ensemble complete in {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print(f"{'='*70}")
    print(f"  Stocks with predictions: {len(m_predictions)}")
    print(f"  Backtest: {m_bt['totalTrades']} trades, "
          f"winTrades={m_bt['winTrades']}, lossTrades={m_bt['lossTrades']}, "
          f"winRate={m_bt['winRate']}%, avgRet={m_bt['avgReturnPct']}%, "
          f"PF={m_bt['profitFactor']}, Sharpe={m_bt['sharpe']}, "
          f"MaxDD={m_bt['max_drawdown_pct']}%")


if __name__ == "__main__":
    main()
