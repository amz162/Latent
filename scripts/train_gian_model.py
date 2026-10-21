#!/usr/bin/env python3
"""Gian-Ensemble: Square-root support/resistance strategy with odd-number rule.

A rule-based strategy (no ML) that computes support/resistance levels from
the square root of the current stock price, using an odd-number rule.

=========================================================================
STRATEGY RULES (per user spec):

1. Take current price P.
2. X = floor(sqrt(P))  — integer part of square root, no decimals.
3. X must be ODD — if even, add 1. This is the main number.
4. Compute 6 levels using the "square and make odd" rule:

   Support 1 (S1) = make_odd(X²)
   Support 2 (S2) = make_odd((X-1)²)
   Support 3 (S3) = make_odd((X-2)²)
   Resistance 1 (R1) = make_odd((X+1)²)
   Resistance 2 (R2) = make_odd((X+2)²)
   Resistance 3 (R3) = make_odd((X+3)²)

   where make_odd(n) = if n is even, n+1 (always returns odd integer).

5. Trading rules:
   - When price approaches a support level → BUY
   - When price approaches a resistance level → SELL
   - Entry zone: within 2% of the support/resistance level
   - 15-min timeframe (we use daily — 15-min data not available)

6. SL/TP: same ATR-based rule as CG/X models:
   SL = support/ATR combined (whichever closer, min 0.5×ATR)
   TP1 = Entry + 1R, TP2 = Entry + 2R, TP3 = Entry + 3R
   (R = |Entry - SL|)

=========================================================================
COST MODEL (Pakistan PSX):
  Round-trip: 50 bps (brokerage 0.10% + fees 0.05% + slippage 0.10% + tax)
  CGT: 15% on gains (filer, <1 year hold)

=========================================================================
METHODOLOGY (no look-ahead):
  - Chronological split: test period = last 25% of bars (untouched)
  - Next-bar-OPEN entries (no look-ahead)
  - Conservative ambiguous-barrier (SL wins ties)
  - Multi-class labels: 0=SL, 1=TP1, 2=TP2, 3=TP3, 4=timeout
  - Full metrics: total trades, win trades, loss trades, win rate,
    avg return, PF, Sharpe, Sortino, MaxDD, TP1/TP2/TP3 hit rates
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

GIAN_TEST_FRAC = 0.75  # test period starts at 75% of bars


# ------------------------------------------------------------------
# Core: make_odd and Gian level computation
# ------------------------------------------------------------------
def make_odd(n: int) -> int:
    """If n is even, add 1 to make it odd. Always returns odd integer."""
    n = int(n)
    if n % 2 == 0:
        n += 1
    return n


def compute_gian_levels(cp: float) -> Tuple[int, int, int, int, int, int, int]:
    """Compute Gian support/resistance levels from current price.
    Returns (x, s1, s2, s3, r1, r2, r3).
    """
    if cp is None or (isinstance(cp, float) and (math.isnan(cp) or math.isinf(cp))) or cp <= 0:
        cp = 1.0  # fallback
    # X = floor(sqrt(P)), integer
    x = int(math.isqrt(int(cp)))
    # X must be odd — if even, add 1
    if x % 2 == 0:
        x += 1
    # S1 = make_odd(X²)
    s1 = make_odd(x * x)
    # R1 = make_odd((X+1)²)
    r1 = make_odd((x + 1) * (x + 1))
    # S2 = make_odd((X-1)²)
    s2 = make_odd((x - 1) * (x - 1))
    # R2 = make_odd((X+2)²)
    r2 = make_odd((x + 2) * (x + 2))
    # S3 = make_odd((X-2)²)
    s3 = make_odd((x - 2) * (x - 2))
    # R3 = make_odd((X+3)²)
    r3 = make_odd((x + 3) * (x + 3))
    return x, s1, s2, s3, r1, r2, r3


# ------------------------------------------------------------------
# Signal generation: BUY near support, SELL near resistance
# ------------------------------------------------------------------
def compute_gian_signal(cp: float, atr: float, support: float, resistance: float,
                        gian_levels: Tuple) -> Tuple[str, str, float, float, float, float, float]:
    """Returns (signal, direction, sl, tp1, tp2, tp3, _skip).
    Uses the ATR-based SL rule (same as CG/X) for SL/TP computation.
    """
    x, s1, s2, s3, r1, r2, r3 = gian_levels
    entry_zone_pct = 0.02  # within 2% of level = "near"

    # Check if price is near any support level
    near_support = False
    for s in [s1, s2, s3]:
        if s > 0 and abs(cp - s) / cp < entry_zone_pct:
            near_support = True
            break

    # Check if price is near any resistance level
    near_resistance = False
    for r in [r1, r2, r3]:
        if r > 0 and abs(cp - r) / cp < entry_zone_pct:
            near_resistance = True
            break

    if near_support and not near_resistance:
        signal = "BUY"
    elif near_resistance and not near_support:
        signal = "SELL"
    elif near_support and near_resistance:
        # Both — pick the closer one
        min_s_dist = min([abs(cp - s) / cp for s in [s1, s2, s3] if s > 0])
        min_r_dist = min([abs(cp - r) / cp for r in [r1, r2, r3] if r > 0])
        signal = "BUY" if min_s_dist < min_r_dist else "SELL"
    else:
        signal = "HOLD"

    # Compute SL/TP using the CG ATR-based rule
    sl, tp1, tp2, tp3, skip = compute_cg_sl_and_targets(
        cp, atr, support, resistance, signal if signal != "HOLD" else "BUY"
    )
    if signal == "HOLD":
        sl = cp; tp1 = cp; tp2 = cp; tp3 = cp
    return signal, "LONG" if signal != "SELL" else "SHORT", sl, tp1, tp2, tp3, skip


# ------------------------------------------------------------------
# Multi-class label (same as X/CG audit)
# ------------------------------------------------------------------
def compute_label(sd, t, direction, sl, tp1, tp2, tp3, horizon=CG_HORIZON,
                   high_arr=None, low_arr=None, open_arr=None, close_arr=None):
    """Returns (label, exit_price, exit_reason).
    Label: 0=SL, 1=TP1-only, 2=TP2-only, 3=TP3, 4=timeout.
    Entry = next-bar open. Conservative: SL wins ties.
    """
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


# ------------------------------------------------------------------
# Wilson CI
# ------------------------------------------------------------------
def wilson_ci(k, n, z=1.96):
    if n == 0: return 0.0, 0.0
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    spread = z * np.sqrt((p * (1 - p) + z * z / (4 * n)) / n) / denom
    return max(0, center - spread), min(1, center + spread)


# ------------------------------------------------------------------
# Generate per-stock predictions (Gian-Ensemble)
# ------------------------------------------------------------------
def predict_all_stocks(stocks, df_all, atr_per):
    """For each stock, compute Gian levels + signal at the latest bar."""
    print("\n[GIAN] Generating per-stock predictions...")
    gian_predictions = {}
    gian_per_stock_levels = {}  # for display

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

        # Compute Gian levels
        x, s1, s2, s3, r1, r2, r3 = compute_gian_levels(cp)

        # Generate signal
        signal, direction, sl, tp1, tp2, tp3, skip = compute_gian_signal(
            cp, atr, support, resistance, (x, s1, s2, s3, r1, r2, r3)
        )

        gian_predictions[s] = {
            "signal": signal,
            "direction": direction,
            "confidence": int(80 if signal != "HOLD" else 20),
            "currentPrice": round(cp, 2),
            "entry": round(cp, 2),
            "tp1": round(tp1, 2), "tp2": round(tp2, 2), "tp3": round(tp3, 2),
            "sl": round(sl, 2),
            "avgReturn": round(float(0.0), 4),
            "gian_levels": {
                "x": x,
                "s1": s1, "s2": s2, "s3": s3,
                "r1": r1, "r2": r2, "r3": r3,
            },
        }

        if (si + 1) % 50 == 0:
            print(f"  {si+1}/{len(stocks)} stocks processed...")

    print(f"  Done: {len(gian_predictions)} stocks have Gian-Ensemble predictions")
    return gian_predictions


# ------------------------------------------------------------------
# Backtest on test period (last 25%, untouched)
# ------------------------------------------------------------------
def backtest_gian(stocks, df_all, atr_per):
    """Walk-forward backtest on last 25% of each stock's bars."""
    print(f"\n[GIAN] Backtesting on test period (last {100-GIAN_TEST_FRAC*100:.0f}%, untouched OOS)...")
    trades = []

    for s in stocks:
        sd = df_all[df_all["symbol"] == s].sort_values("date").reset_index(drop=True)
        n = len(sd)
        if n < MIN_PRED_BARS + CG_HORIZON + 20:
            continue
        sp = int(n * GIAN_TEST_FRAC)
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

            # Compute Gian levels at bar t
            gian_levels = compute_gian_levels(cp)
            signal, direction, sl, tp1, tp2, tp3, skip = compute_gian_signal(
                cp, atr, support, resistance, gian_levels
            )
            if signal == "HOLD":
                continue

            # Compute label + net return
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
                "exit_reason": exit_reason,
                "gian_x": gian_levels[0],
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
    sigs = np.array([tr["signal"] for tr in trades])[valid]  # "BUY" or "SELL"

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
    # Use log-returns for MaxDD to avoid overflow with large trade counts
    log_rets = np.log1p(np.clip(rets, -0.99, None))  # prevent log(0) on -100%
    cum_log = np.cumsum(log_rets)
    peak_log = np.maximum.accumulate(cum_log)
    dd_log = cum_log - peak_log
    max_dd_pct = float((np.exp(dd_log.min()) - 1) * 100)

    # Count BUY vs SELL signals (using signal field, not direction)
    buy_count = int((sigs == "BUY").sum())
    sell_count = int((sigs == "SELL").sum())
    # correct_buys = winning BUY trades; correct_sells = winning SELL trades
    correct_buys = int(sum(1 for s, r in zip(sigs, rets) if s == "BUY" and r > 0))
    correct_sells = int(sum(1 for s, r in zip(sigs, rets) if s == "SELL" and r > 0))

    print(f"  Trades: {n} | Wins: {win_count} | Losses: {loss_count} | "
          f"Win rate: {win_rate*100:.1f}% | Avg: {avg_ret*100:.2f}% | "
          f"PF: {pf:.3f} | Sharpe: {sharpe:.2f}")

    return {
        # Modal-expected camelCase fields
        "totalTrades": n,
        "buySignals": buy_count, "sellSignals": sell_count,
        "correctBuys": correct_buys, "correctSells": correct_sells,
        "winRate": round(win_rate * 100, 1),
        "avgReturnPct": round(avg_ret * 100, 2),
        "maxReturnPct": round(float(rets.max() * 100), 2),
        "minReturnPct": round(float(rets.min() * 100), 2),
        "stars": int(min(5, max(1, int(win_rate * 100 / 20) + 1))),
        "profitFactor": round(pf, 3),
        "costBps": int(COST_ROUND_TRIP * 10000),
        # Gian-specific fields
        "winTrades": win_count,
        "lossTrades": loss_count,
        "tp1HitRate": round(tp1_count / n, 4),
        "tp2HitRate": round(tp2_count / n, 4),
        "tp3HitRate": round(tp3_count / n, 4),
        "tp1_count": tp1_count, "tp2_count": tp2_count, "tp3_count": tp3_count,
        "sl_count": sl_count, "timeout_count": timeout_count,
        "precision": round(precision, 4),
        "precision_ci_low": round(ci_low, 4),
        "precision_ci_high": round(ci_high, 4),
        "net_expectancy_pct": round(avg_ret * 100, 3),
        "median_return_pct": round(median_ret * 100, 3),
        "sharpe": round(sharpe, 3),
        "sortino": round(sortino, 3),
        "max_drawdown_pct": round(max_dd_pct, 2),
        "method": "gian_ensemble",
        "strategy": "square_root_support_resistance_with_odd_rule",
        "horizon": CG_HORIZON,
        "tps": f"{CG_TP1_MULT}R/{CG_TP2_MULT}R/{CG_TP3_MULT}R",
        "entry_zone_pct": 0.02,
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
        "max_drawdown_pct": 0,
        "method": "gian_ensemble",
    }


# ------------------------------------------------------------------
# Save
# ------------------------------------------------------------------
def save_to_json(gian_predictions, gian_bt):
    print(f"\n[GIAN] Saving to {PRED_FILE}...")
    with open(PRED_FILE, "r") as f:
        existing = json.load(f)
    # Add Gian-Ensemble as a model
    models_dict = existing.get("models", {})
    models_dict["Gian-Ensemble (GIAN)"] = {
        "trained": True,
        "version": "1.0.0",
        "predictions": gian_predictions,
    }
    existing["models"] = models_dict
    # Gian predictions
    existing["gian_ensemble_predictions"] = gian_predictions
    # Backtest entry
    ens_bt = existing.get("ensemble_backtesting", {})
    ens_bt["GIAN_ENSEMBLE"] = gian_bt
    existing["ensemble_backtesting"] = ens_bt
    # Metadata
    existing["gian_metadata"] = {
        "trained_at": pd.Timestamp.now().isoformat(),
        "strategy": "Square-root support/resistance with odd-number rule",
        "formula": "X=floor(sqrt(P)); make odd; S1=odd(X²), S2=odd((X-1)²), S3=odd((X-2)²), R1=odd((X+1)²), R2=odd((X+2)²), R3=odd((X+3)²)",
        "signal_rules": "BUY when price within 2% of support; SELL when within 2% of resistance",
        "sl_rule": "ATR-based (support/ATR combined, min 0.5×ATR) — same as CG/X",
        "tp_rule": f"TP1/2/3 = {CG_TP1_MULT}R/{CG_TP2_MULT}R/{CG_TP3_MULT}R",
        "horizon": f"{CG_HORIZON} trading days",
        "cost_model": {"round_trip_pct": COST_ROUND_TRIP * 100, "cgt_rate_pct": CGT_RATE * 100},
        "test_period": f"last {100-GIAN_TEST_FRAC*100:.0f}% of bars (untouched OOS)",
        "entry_method": "next-bar-open (no look-ahead)",
        "note": "15-min timeframe requested but not available — daily used instead",
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


# ------------------------------------------------------------------
# Main
# ------------------------------------------------------------------
def main():
    start = time.time()
    print("=" * 70)
    print("Gian-Ensemble: Square-root support/resistance with odd-number rule")
    print("=" * 70)
    print("\nSTRATEGY:")
    print("  1. X = floor(sqrt(price)), make odd")
    print("  2. S1=odd(X²), S2=odd((X-1)²), S3=odd((X-2)²)")
    print("  3. R1=odd((X+1)²), R2=odd((X+2)²), R3=odd((X+3)²)")
    print("  4. BUY when price near support (within 2%)")
    print("  5. SELL when price near resistance (within 2%)")
    print(f"  6. SL/TP: ATR-based, TP1/2/3 = {CG_TP1_MULT}R/{CG_TP2_MULT}R/{CG_TP3_MULT}R")
    print(f"  7. Cost: {COST_ROUND_TRIP*100:.2f}% round-trip + {CGT_RATE*100:.0f}% CGT on gains")
    print(f"  8. Test: last {100-GIAN_TEST_FRAC*100:.0f}% of bars, next-bar-open entries")
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
    gian_predictions = predict_all_stocks(all_stocks, df_all, atr_per)

    # Show example levels for a few stocks
    print("\n  Example Gian levels:")
    for sym in ["ENGRO", "MARI", "LUCK", "PRL"]:
        p = gian_predictions.get(sym, {})
        gl = p.get("gian_levels", {})
        if gl:
            print(f"    {sym} (price={p.get('currentPrice')}): "
                  f"X={gl.get('x')}, S1={gl.get('s1')}, S2={gl.get('s2')}, S3={gl.get('s3')}, "
                  f"R1={gl.get('r1')}, R2={gl.get('r2')}, R3={gl.get('r3')}, "
                  f"signal={p.get('signal')}")

    print("\n[3/3] Backtesting on test period (untouched OOS)...")
    gian_bt = backtest_gian(all_stocks, df_all, atr_per)

    save_to_json(gian_predictions, gian_bt)

    elapsed = time.time() - start
    print(f"\n{'='*70}")
    print(f"Gian-Ensemble complete in {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print(f"{'='*70}")
    print(f"  Stocks with predictions: {len(gian_predictions)}")
    print(f"  Backtest: {gian_bt['totalTrades']} trades, "
          f"winTrades={gian_bt['winTrades']}, lossTrades={gian_bt['lossTrades']}, "
          f"winRate={gian_bt['winRate']}%, avgRet={gian_bt['avgReturnPct']}%, "
          f"PF={gian_bt['profitFactor']}, Sharpe={gian_bt['sharpe']}, "
          f"MaxDD={gian_bt['max_drawdown_pct']}%")


if __name__ == "__main__":
    main()
