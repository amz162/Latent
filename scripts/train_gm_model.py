#!/usr/bin/env python3
"""GM-Model Ensembler — 4-Pillar Weighted Signal Framework for PSX.

A rule-based signal generator (not a trained ML model) that synthesizes
4 distinct analytical pillars, each evaluated on CPU and assigned a
strict percentage weight in calculating the final signal score.

=========================================================================
TOTAL SIGNAL FORMULA (per user spec):
  S_total = 0.35 * S_tech + 0.30 * S_anno + 0.20 * S_fund + 0.15 * S_macro
  S_total ∈ [-1.0, +1.0]

Signal thresholds:
  BUY  if S_total >= +0.45 (confidence > 75%)
  SELL if S_total <= -0.45 (confidence > 75%)
  HOLD if -0.45 < S_total < +0.45

Confidence formula (per user spec):
  confidence = min(100, int(abs(S_total) * 100 + 15))

=========================================================================
4 PILLARS:

Pillar 1 — Technical Analysis Engine (Weight: 35%)
  Components (sub-weighted within pillar):
    - 10% MA Trend: price vs 20-EMA, 50-EMA, 200-SMA
    - 10% Momentum: RSI(14), MACD crossover state
    -  8% Volatility: Bollinger Bands bandwidth expansion/squeeze
    -  7% Volume: OBV slope, 10-day avg volume ratio
  Score range: [-1.0, +1.0]

Pillar 2 — Company Announcements & Earnings (Weight: 30%)
  Components:
    - 15% YoY EPS growth (annual EPS - Basic)
    -  8% Dividend yield (DPS / current price)
    -  7% EPS surprise proxy (latest EPS vs trailing-4Q EPS)
  Score range: [-1.0, +1.0]
  Source: data/financials/<SYM>.json (annual + quarter)

Pillar 3 — Fundamental Financials (Weight: 20%)
  Components:
    -  8% Valuation: P/E ratio vs sector historical; P/B approximation
    -  6% Profitability: gross margin %, net margin %, ROE proxy
    -  6% Leverage: interest coverage (EBIT / finance cost)
  Score range: [-1.0, +1.0]

Pillar 4 — Macro & Market Context (Weight: 15%)
  Components:
    -  5% KIBOR / SBP policy rate (constant — we don't have a feed)
    -  4% USD/PKR exchange rate (constant)
    -  3% Brent crude (constant)
    -  3% KSE-100 trend (computed from aggregated PSX OHLCV close prices)
  Score range: [-1.0, +1.0]

=========================================================================
ATR-Based Risk Management (per user spec, DIFFERENT from CL-2/PI):
  Risk Unit R = 1.5 × ATR(14)
  SL  = Entry ∓ 1.5 × ATR       (exit 100%, hard stop)
  TP1 = Entry ± 1.5 × ATR       (sell 50%, move SL to BE)
  TP2 = Entry ± 3.0 × ATR       (sell 30%)
  TP3 = Entry ± 4.5 × ATR       (trail 20% using 20-EMA as dynamic stop)

Exit simulation:
  - Walk forward bar-by-bar
  - Check SL first: if hit before TP1 → exit 100% at SL
  - After TP1 hit: SL → BE; remaining 50%
  - After TP2 hit: remaining 20% uses 20-EMA as trailing stop
  - Max holding horizon: 21 days

Usage:
  python scripts/train_gm_model.py             # full training + backtest
  python scripts/train_gm_model.py --quick 20  # quick test on 20 stocks
"""
from __future__ import annotations
import json
import os
import sys
import time
import argparse
import warnings
from pathlib import Path
from typing import Dict, List, Tuple, Optional

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# Import shared OHLCV loading + feature engineering from CL-2 trainer
sys.path.insert(0, str(Path(__file__).parent))
from train_cl2_tier import (
    OHLCV_DIR, PRED_FILE, FC,
    add_features, load_ohlcv, get_atr_per_stock,
    catr, cobv, crsi, cmacd, cbb,
    MIN_PRED_BARS, COST,
)

FIN_DIR = Path("/home/z/my-project") / "data" / "financials"

# ------------------------------------------------------------------
# Constants (per user spec)
# ------------------------------------------------------------------
GM_SL_MULT = 1.5
GM_TP1_MULT = 1.5
GM_TP2_MULT = 3.0
GM_TP3_MULT = 4.5
GM_BUY_THRESHOLD = 0.45
GM_SELL_THRESHOLD = -0.45

# Pillar weights (per user spec)
W_TECH = 0.35
W_ANNO = 0.30
W_FUND = 0.20
W_MACRO = 0.15

# Within-pillar sub-weights (per user spec)
TECH_W = {"ma_trend": 0.10, "momentum": 0.10, "volatility": 0.08, "volume": 0.07}
ANNO_W = {"eps_growth": 0.15, "payout": 0.08, "eps_surprise": 0.07}
FUND_W = {"valuation": 0.08, "profitability": 0.06, "leverage": 0.06}
MACRO_W = {"kibor": 0.05, "usdpkr": 0.04, "brent": 0.03, "kse100": 0.03}


# ------------------------------------------------------------------
# Fundamentals loader
# ------------------------------------------------------------------
def load_financials(symbol: str) -> Optional[dict]:
    """Load annual + quarter income statement data for a stock."""
    p = FIN_DIR / f"{symbol}.json"
    if not p.exists():
        return None
    try:
        with open(p) as f:
            d = json.load(f)
        return d
    except Exception:
        return None


def get_annual_value(fin: dict, label: str, year: str = None) -> Optional[float]:
    """Get a specific annual income statement value by label."""
    for entry in fin.get("annual", []):
        if entry.get("label") == label:
            data = entry.get("data", [])
            if year is None:
                # Latest value
                if data:
                    try:
                        return float(data[-1].get("value", 0))
                    except (ValueError, TypeError):
                        return None
            else:
                for d in data:
                    if d.get("year") == year:
                        try:
                            return float(d.get("value", 0))
                        except (ValueError, TypeError):
                            return None
            return None
    return None


def get_annual_series(fin: dict, label: str) -> Dict[str, float]:
    """Get all annual values for a label, as {year: value} dict."""
    for entry in fin.get("annual", []):
        if entry.get("label") == label:
            out = {}
            for d in entry.get("data", []):
                try:
                    out[d["year"]] = float(d.get("value", 0))
                except (ValueError, TypeError):
                    continue
            return out
    return {}


def get_quarter_series(fin: dict, label: str) -> List[float]:
    """Get quarter values for a label, in chronological order."""
    for entry in fin.get("quarter", []):
        if entry.get("label") == label:
            data = entry.get("data", [])
            out = []
            for d in data:
                try:
                    out.append(float(d.get("value", 0)))
                except (ValueError, TypeError):
                    continue
            return out
    return []


# ------------------------------------------------------------------
# Pillar 1: Technical Analysis Engine
# ------------------------------------------------------------------
def compute_tech_score(sd: pd.DataFrame, t: int) -> Tuple[float, dict]:
    """Pillar 1 — Technical Analysis Engine.
    Sub-components (per user spec):
      - 10% MA Trend (price vs 20-EMA, 50-EMA, 200-SMA)
      - 10% Momentum (RSI 14-day + MACD crossover)
      -  8% Volatility (Bollinger Bands width expansion/squeeze)
      -  7% Volume (OBV slope + 10-day avg vol ratio)

    Returns: (score ∈ [-1.0, +1.0], components dict for transparency)
    """
    if t < 50:  # need 200-SMA ideally, but min 50 bars
        return 0.0, {}

    c = sd["close"].iloc[:t + 1]
    h = sd["high"].iloc[:t + 1]
    l = sd["low"].iloc[:t + 1]
    v = sd["volume"].iloc[:t + 1]

    # 20-EMA, 50-EMA, 200-SMA
    ema20 = c.ewm(span=20, adjust=False).mean().iloc[-1]
    ema50 = c.ewm(span=50, adjust=False).mean().iloc[-1]
    sma200 = c.rolling(200, min_periods=20).mean().iloc[-1] if len(c) >= 20 else c.mean()
    cp = float(c.iloc[-1])

    # 10% MA Trend: align price above EMA20 above EMA50 above SMA200 → +1
    if cp > ema20 > ema50 and (np.isnan(sma200) or cp > sma200):
        ma_score = +1.0
    elif cp < ema20 < ema50:
        ma_score = -1.0
    elif cp > ema50:  # partial bullish
        ma_score = +0.5
    elif cp < ema50:
        ma_score = -0.5
    else:
        ma_score = 0.0

    # 10% Momentum: RSI(14) + MACD crossover
    rsi = crsi(c).iloc[-1]
    macd_line, macd_signal, macd_hist = cmacd(c)
    macd_now = float(macd_line.iloc[-1])
    macd_sig = float(macd_signal.iloc[-1])
    if rsi > 70:  # Overbought
        rsi_score = -0.5  # bearish reversal risk
    elif rsi < 30:  # Oversold
        rsi_score = +0.5  # bounce potential
    elif 45 <= rsi <= 65:  # healthy bullish range
        rsi_score = +1.0
    elif 35 <= rsi < 45:
        rsi_score = +0.3
    else:
        rsi_score = 0.0
    if macd_now > macd_sig:  # bullish crossover
        macd_score = +1.0
    else:  # bearish crossover
        macd_score = -1.0
    momentum_score = (rsi_score * 0.5 + macd_score * 0.5)

    # 8% Volatility: Bollinger Bands width
    bb_width, bb_pct_b = cbb(c)
    bb_width_now = float(bb_width.iloc[-1])
    bb_width_mean = float(bb_width.rolling(50, min_periods=10).mean().iloc[-1]) if len(bb_width) >= 10 else bb_width_now
    if bb_width_now > bb_width_mean * 1.5:  # expansion — trend strength
        vol_score = +0.5 if macd_now > macd_sig else -0.5
    elif bb_width_now < bb_width_mean * 0.7:  # squeeze — pending move
        vol_score = 0.0  # neutral (could go either way)
    else:
        vol_score = 0.0

    # 7% Volume: OBV slope + 10-day avg vol ratio
    obv = cobv(c, v)
    obv_now = float(obv.iloc[-1])
    obv_10 = float(obv.iloc[-10]) if len(obv) >= 10 else obv_now
    vol_now = float(v.iloc[-1])
    vol_avg_10 = float(v.iloc[-10:].mean()) if len(v) >= 10 else vol_now
    vol_ratio = vol_now / max(vol_avg_10, 1)
    if obv_now > obv_10 and vol_ratio > 1.2:  # rising OBV + above-average volume
        vol_score = +1.0
    elif obv_now < obv_10 and vol_ratio > 1.2:  # falling OBV + above-average volume
        vol_score = -1.0
    elif vol_ratio < 0.7:  # low volume — weak conviction
        vol_score = 0.0
    else:
        vol_score = +0.3 if obv_now > obv_10 else -0.3

    # Weighted sum within pillar — scales sub-weights (sum = 0.35) so we
    # divide by 0.35 to get a normalized pillar score in [-1, +1]
    raw = (TECH_W["ma_trend"] * ma_score +
           TECH_W["momentum"] * momentum_score +
           TECH_W["volatility"] * vol_score +
           TECH_W["volume"] * vol_score)
    score = raw / sum(TECH_W.values())  # normalize to [-1, +1]
    score = float(np.clip(score, -1.0, 1.0))
    return score, {
        "ma_trend": round(float(ma_score), 3),
        "momentum": round(float(momentum_score), 3),
        "rsi": round(float(rsi), 2) if not np.isnan(rsi) else 50.0,
        "macd_hist": round(float(macd_hist.iloc[-1]), 4),
        "volatility": round(float(vol_score), 3),
        "bb_width": round(float(bb_width_now), 4),
        "volume": round(float(vol_score), 3),
        "vol_ratio": round(float(vol_ratio), 3),
        "score": round(score, 3),
    }


# ------------------------------------------------------------------
# Pillar 2: Company Announcements & Earnings
# ------------------------------------------------------------------
def compute_anno_score(fin: dict, cp: float) -> Tuple[float, dict]:
    """Pillar 2 — Company Announcements & Earnings Results.
    Sub-components:
      - 15% YoY EPS growth (annual EPS - Basic)
      -  8% Payout (DPS / current price)
      -  7% EPS surprise proxy (annual EPS vs trailing 4Q EPS, when available)

    Returns: (score ∈ [-1.0, +1.0], components dict)
    """
    if fin is None:
        return 0.0, {}

    # 15% YoY EPS growth
    eps_series = get_annual_series(fin, "EPS - Basic")
    if len(eps_series) >= 2:
        years_sorted = sorted(eps_series.keys())
        eps_latest = eps_series[years_sorted[-1]]
        eps_prev = eps_series[years_sorted[-2]]
        if eps_prev > 0 and eps_latest > 0:
            yoy_growth = (eps_latest - eps_prev) / abs(eps_prev)
        else:
            yoy_growth = 0.0
        # Score: >+20% growth → +1.0; <-20% growth → -1.0; linear in between
        if yoy_growth >= 0.20:
            eps_growth_score = +1.0
        elif yoy_growth <= -0.20:
            eps_growth_score = -1.0
        else:
            eps_growth_score = yoy_growth / 0.20  # ±1.0 at ±20%
    else:
        yoy_growth = 0.0
        eps_growth_score = 0.0

    # 8% Payout: DPS / price
    dps_series = get_annual_series(fin, "DPS")
    if len(dps_series) >= 1 and cp > 0:
        years_sorted = sorted(dps_series.keys())
        dps_latest = dps_series[years_sorted[-1]]
        if dps_latest > 0:
            yield_pct = dps_latest / cp
            # Score: 5%+ yield → +1.0; 0% → 0.0; (linear)
            payout_score = min(1.0, yield_pct / 0.05)
        else:
            payout_score = 0.0
            yield_pct = 0.0
    else:
        payout_score = 0.0
        yield_pct = 0.0
        dps_latest = 0.0

    # 7% EPS surprise proxy: annual EPS vs trailing 4Q EPS sum (if quarter data)
    eps_q = get_quarter_series(fin, "EPS - Basic")
    if len(eps_q) >= 4 and len(eps_series) >= 1:
        trailing_4q_eps = sum(eps_q[-4:])
        years_sorted = sorted(eps_series.keys())
        annual_eps = eps_series[years_sorted[-1]]
        if trailing_4q_eps > 0 and annual_eps > 0:
            surprise = (trailing_4q_eps - annual_eps) / annual_eps
            if surprise >= 0.10:
                surprise_score = +1.0
            elif surprise <= -0.10:
                surprise_score = -1.0
            else:
                surprise_score = surprise / 0.10
        else:
            surprise_score = 0.0
            surprise = 0.0
    else:
        surprise_score = 0.0
        surprise = 0.0

    raw = (ANNO_W["eps_growth"] * eps_growth_score +
           ANNO_W["payout"] * payout_score +
           ANNO_W["eps_surprise"] * surprise_score)
    score = raw / sum(ANNO_W.values())  # normalize to [-1, +1]
    score = float(np.clip(score, -1.0, 1.0))
    return score, {
        "eps_yoy_growth": round(float(yoy_growth), 4),
        "eps_growth_score": round(float(eps_growth_score), 3),
        "dps_latest": float(dps_latest),
        "yield_pct": round(float(yield_pct), 4),
        "payout_score": round(float(payout_score), 3),
        "eps_surprise": round(float(surprise), 4),
        "surprise_score": round(float(surprise_score), 3),
        "score": round(score, 3),
    }


# ------------------------------------------------------------------
# Pillar 3: Fundamental Financials
# ------------------------------------------------------------------
def compute_fund_score(fin: dict, cp: float) -> Tuple[float, dict]:
    """Pillar 3 — Fundamental Financials.
    Sub-components:
      - 8% Valuation: P/E ratio (price / EPS) — undervalued if P/E < 5
      - 6% Profitability: gross margin, net margin, ROE proxy
      - 6% Leverage: interest coverage (Operating profit / Financial charges)

    Returns: (score ∈ [-1.0, +1.0], components dict)
    """
    if fin is None or cp <= 0:
        return 0.0, {}

    # Get latest annual values
    net_sales = get_annual_value(fin, "Net sales")
    gross_profit = get_annual_value(fin, "Gross profit")
    op_profit = get_annual_value(fin, "Operating profit")
    fin_charges = get_annual_value(fin, "Financial charges")
    pat = get_annual_value(fin, "Profit after tax")
    eps_basic = get_annual_value(fin, "EPS - Basic")

    # 8% Valuation: P/E
    if eps_basic and eps_basic > 0 and cp > 0:
        pe = cp / eps_basic
        # PSX typical P/E range: 4 to 15. <5 = undervalued; >15 = overvalued
        if pe < 5:
            pe_score = +1.0
        elif pe < 8:
            pe_score = +0.5
        elif pe < 12:
            pe_score = 0.0
        elif pe < 18:
            pe_score = -0.5
        else:
            pe_score = -1.0
    else:
        pe = None
        pe_score = 0.0

    # 6% Profitability: gross margin, net margin
    if net_sales and net_sales > 0:
        gm = gross_profit / net_sales if gross_profit else 0.0
        nm = pat / net_sales if pat else 0.0
        # Score: high gross margin (>30%) + positive net margin → +1.0
        if gm > 0.30 and nm > 0.05:
            prof_score = +1.0
        elif gm > 0.20 and nm > 0.0:
            prof_score = +0.5
        elif nm < 0:
            prof_score = -1.0
        elif gm < 0.10:
            prof_score = -0.5
        else:
            prof_score = 0.0
    else:
        gm = 0.0
        nm = 0.0
        prof_score = 0.0

    # 6% Leverage: interest coverage (Operating profit / Financial charges)
    if op_profit is not None and fin_charges and fin_charges > 0:
        int_cov = op_profit / fin_charges
        if int_cov > 5.0:
            lev_score = +1.0
        elif int_cov > 3.0:
            lev_score = +0.5
        elif int_cov > 1.5:
            lev_score = 0.0
        elif int_cov > 1.0:
            lev_score = -0.5
        else:
            lev_score = -1.0  # distress
    else:
        int_cov = None
        lev_score = 0.0

    raw = (FUND_W["valuation"] * pe_score +
           FUND_W["profitability"] * prof_score +
           FUND_W["leverage"] * lev_score)
    score = raw / sum(FUND_W.values())
    score = float(np.clip(score, -1.0, 1.0))
    return score, {
        "pe_ratio": round(float(pe), 2) if pe is not None else None,
        "pe_score": round(float(pe_score), 3),
        "gross_margin": round(float(gm), 4),
        "net_margin": round(float(nm), 4),
        "prof_score": round(float(prof_score), 3),
        "interest_coverage": round(float(int_cov), 2) if int_cov is not None else None,
        "lev_score": round(float(lev_score), 3),
        "score": round(score, 3),
    }


# ------------------------------------------------------------------
# Pillar 4: Macro & Market Context
# ------------------------------------------------------------------
def compute_macro_score(kse100_return: float) -> Tuple[float, dict]:
    """Pillar 4 — Macro & Market Context.
    Sub-components (we use constants for KIBOR/USD-PKR/Brent since we don't
    have a live feed; KSE-100 trend is computed from aggregated PSX data):
      - 5% KIBOR (constant: 0.0 = neutral, since we don't know the rate)
      - 4% USD/PKR (constant: 0.0)
      - 3% Brent crude (constant: 0.0)
      - 3% KSE-100 50-day return → score: +1.0 if >+5%, -1.0 if <-5%, linear

    Returns: (score ∈ [-1.0, +1.0], components dict)
    """
    # KSE-100 trend score (the only signal-driven macro component)
    if kse100_return >= 0.05:
        kse100_score = +1.0
    elif kse100_return <= -0.05:
        kse100_score = -1.0
    else:
        kse100_score = kse100_return / 0.05

    raw = (MACRO_W["kibor"] * 0.0 +       # constant — would require SBP data feed
           MACRO_W["usdpkr"] * 0.0 +      # constant — would require SBP data feed
           MACRO_W["brent"] * 0.0 +       # constant — would require commodity feed
           MACRO_W["kse100"] * kse100_score)
    score = raw / sum(MACRO_W.values())  # normalize; KSE-100 dominates if others=0
    score = float(np.clip(score, -1.0, 1.0))
    return score, {
        "kibor_score": 0.0,  # placeholder (no feed)
        "usdpkr_score": 0.0,
        "brent_score": 0.0,
        "kse100_50d_return": round(float(kse100_return), 4),
        "kse100_score": round(float(kse100_score), 3),
        "score": round(score, 3),
    }


# ------------------------------------------------------------------
# KSE-100 proxy: average of all stocks' normalized close prices
# ------------------------------------------------------------------
def compute_kse100_index(df_all: pd.DataFrame) -> pd.DataFrame:
    """Build a KSE-100 proxy index by averaging normalized close prices
    across all stocks. Returns a DataFrame with date + index_value columns.

    This isn't the real KSE-100 (which is cap-weighted), but it captures
    broad market trend for the Pillar 4 macro score.
    """
    # Normalize each stock's close to its first value, then average across stocks
    df_all = df_all.copy().sort_values(["symbol", "date"]).reset_index(drop=True)
    # Pivot: date × symbol → close
    pivot = df_all.pivot_table(index="date", columns="symbol", values="close")
    # Normalize each column to its first non-NaN value
    norm = pivot / pivot.bfill().iloc[0]
    # Average across stocks per date
    idx = norm.mean(axis=1).reset_index()
    idx.columns = ["date", "index_value"]
    return idx


# ------------------------------------------------------------------
# GM ATR rules + exit simulation (DIFFERENT from CL-2/PI)
# ------------------------------------------------------------------
def gm_atr_rules(signal: str, cp: float, atr: float) -> Tuple[float, float, float, float, float]:
    """Returns (entry, sl, tp1, tp2, tp3) using the user spec:
       SL  = Entry ∓ 1.5×ATR
       TP1 = Entry ± 1.5×ATR
       TP2 = Entry ± 3.0×ATR
       TP3 = Entry ± 4.5×ATR
    """
    if signal == "BUY":
        return cp, cp - GM_SL_MULT * atr, cp + GM_TP1_MULT * atr, cp + GM_TP2_MULT * atr, cp + GM_TP3_MULT * atr
    if signal == "SELL":
        return cp, cp + GM_SL_MULT * atr, cp - GM_TP1_MULT * atr, cp - GM_TP2_MULT * atr, cp - GM_TP3_MULT * atr
    return cp, cp, cp, cp, cp


def simulate_gm_exit(
    sd: pd.DataFrame,
    t: int,
    direction: str,
    entry: float,
    sl: float,
    tp1: float,
    tp2: float,
    tp3: float,
    horizon: int = 21,
    cost: float = COST,
    high_arr: Optional[np.ndarray] = None,
    low_arr: Optional[np.ndarray] = None,
    close_arr: Optional[np.ndarray] = None,
    ema20_arr: Optional[np.ndarray] = None,
) -> float:
    """Simulate GM exit ladder:
       - 100% at SL (if hit before TP1) or at BE (if hit after TP1)
       - 50% at TP1, then SL → BE
       - 30% at TP2
       - 20% trailing 20-EMA — exit at close if close < 20-EMA (BUY) / > 20-EMA (SELL)
       - Max holding: 21 days. Any remaining position is closed at last close.
    """
    if high_arr is not None and low_arr is not None and close_arr is not None:
        n = len(close_arr)
        end = min(t + 1 + horizon, n)
        remaining = 1.0
        realized_ret = 0.0
        cur_sl = sl
        tp1_hit = False
        tp2_hit = False
        for j in range(t + 1, end):
            h = float(high_arr[j])
            l = float(low_arr[j])
            cl = float(close_arr[j])
            # Check SL first
            if direction == "BUY":
                if l <= cur_sl:
                    realized_ret += remaining * (cur_sl - entry) / entry
                    remaining = 0
                    break
            else:
                if h >= cur_sl:
                    realized_ret += remaining * (entry - cur_sl) / entry
                    remaining = 0
                    break
            # Check TPs (in order)
            if direction == "BUY":
                if not tp1_hit and h >= tp1:
                    close_frac = min(0.50, remaining)
                    realized_ret += close_frac * (tp1 - entry) / entry
                    remaining -= close_frac
                    tp1_hit = True
                    cur_sl = entry  # move to breakeven
                    continue  # don't check TP2/TP3 same bar
                if not tp2_hit and h >= tp2:
                    close_frac = min(0.30, remaining) if remaining > 0 else 0
                    close_frac = min(close_frac, remaining)
                    realized_ret += close_frac * (tp2 - entry) / entry
                    remaining -= close_frac
                    tp2_hit = True
                    continue
                if tp2_hit and remaining > 0 and ema20_arr is not None:
                    # Trail 20-EMA — exit if close < 20-EMA
                    if cl < float(ema20_arr[j]):
                        realized_ret += remaining * (cl - entry) / entry
                        remaining = 0
                        break
                if tp2_hit and remaining > 0 and h >= tp3:
                    # Optional: exit at TP3 if hit during trail
                    realized_ret += remaining * (tp3 - entry) / entry
                    remaining = 0
                    break
            else:  # SELL — mirror
                if not tp1_hit and l <= tp1:
                    close_frac = min(0.50, remaining)
                    realized_ret += close_frac * (entry - tp1) / entry
                    remaining -= close_frac
                    tp1_hit = True
                    cur_sl = entry
                    continue
                if not tp2_hit and l <= tp2:
                    close_frac = min(0.30, remaining) if remaining > 0 else 0
                    close_frac = min(close_frac, remaining)
                    realized_ret += close_frac * (entry - tp2) / entry
                    remaining -= close_frac
                    tp2_hit = True
                    continue
                if tp2_hit and remaining > 0 and ema20_arr is not None:
                    if cl > float(ema20_arr[j]):
                        realized_ret += remaining * (entry - cl) / entry
                        remaining = 0
                        break
                if tp2_hit and remaining > 0 and l <= tp3:
                    realized_ret += remaining * (entry - tp3) / entry
                    remaining = 0
                    break
        # Close remaining at last close
        if remaining > 0:
            last_close = float(close_arr[end - 1])
            if direction == "BUY":
                realized_ret += remaining * (last_close - entry) / entry
            else:
                realized_ret += remaining * (entry - last_close) / entry
        realized_ret -= 2 * cost
        return float(realized_ret)
    # Slow fallback — using iloc
    future = sd.iloc[t + 1:t + 1 + horizon]
    if len(future) == 0:
        return 0.0
    remaining = 1.0
    realized_ret = 0.0
    cur_sl = sl
    tp1_hit = False
    tp2_hit = False
    for _, r in future.iterrows():
        h = float(r["high"])
        l = float(r["low"])
        cl = float(r["close"])
        if direction == "BUY":
            if l <= cur_sl:
                realized_ret += remaining * (cur_sl - entry) / entry
                remaining = 0
                break
            if not tp1_hit and h >= tp1:
                close_frac = min(0.50, remaining)
                realized_ret += close_frac * (tp1 - entry) / entry
                remaining -= close_frac
                tp1_hit = True
                cur_sl = entry
                continue
            if not tp2_hit and h >= tp2:
                close_frac = min(0.30, remaining)
                realized_ret += close_frac * (tp2 - entry) / entry
                remaining -= close_frac
                tp2_hit = True
                continue
            if tp2_hit and remaining > 0:
                ema20_val = float(sd["close"].iloc[:t + 1 + (r.name - t)].ewm(span=20, adjust=False).mean().iloc[-1]) if r.name > 0 else cl
                if cl < ema20_val:
                    realized_ret += remaining * (cl - entry) / entry
                    remaining = 0
                    break
        else:
            if h >= cur_sl:
                realized_ret += remaining * (entry - cur_sl) / entry
                remaining = 0
                break
            if not tp1_hit and l <= tp1:
                close_frac = min(0.50, remaining)
                realized_ret += close_frac * (entry - tp1) / entry
                remaining -= close_frac
                tp1_hit = True
                cur_sl = entry
                continue
            if not tp2_hit and l <= tp2:
                close_frac = min(0.30, remaining)
                realized_ret += close_frac * (entry - tp2) / entry
                remaining -= close_frac
                tp2_hit = True
                continue
            if tp2_hit and remaining > 0:
                ema20_val = float(sd["close"].iloc[:t + 1 + (r.name - t)].ewm(span=20, adjust=False).mean().iloc[-1]) if r.name > 0 else cl
                if cl > ema20_val:
                    realized_ret += remaining * (entry - cl) / entry
                    remaining = 0
                    break
    if remaining > 0:
        last_close = float(future.iloc[-1]["close"])
        if direction == "BUY":
            realized_ret += remaining * (last_close - entry) / entry
        else:
            realized_ret += remaining * (entry - last_close) / entry
    realized_ret -= 2 * cost
    return float(realized_ret)


# ------------------------------------------------------------------
# GM signal computation per bar
# ------------------------------------------------------------------
def compute_gm_signal(
    sd: pd.DataFrame,
    t: int,
    fin: Optional[dict],
    kse100_ret: float,
) -> Tuple[str, float, float, dict]:
    """Compute GM-Model signal at bar t.
    Returns: (signal, total_score, confidence, components_dict)
    """
    cp = float(sd.iloc[t]["close"])
    s_tech, tech_comp = compute_tech_score(sd, t)
    s_anno, anno_comp = compute_anno_score(fin, cp)
    s_fund, fund_comp = compute_fund_score(fin, cp)
    s_macro, macro_comp = compute_macro_score(kse100_ret)

    s_total = (W_TECH * s_tech +
               W_ANNO * s_anno +
               W_FUND * s_fund +
               W_MACRO * s_macro)
    s_total = float(np.clip(s_total, -1.0, 1.0))

    if s_total >= GM_BUY_THRESHOLD:
        signal = "BUY"
    elif s_total <= GM_SELL_THRESHOLD:
        signal = "SELL"
    else:
        signal = "HOLD"

    # Confidence formula (per user spec): min(100, |S_total| * 100 + 15)
    confidence = min(100, int(abs(s_total) * 100 + 15))

    components = {
        "tech_score": round(s_tech, 3),
        "anno_score": round(s_anno, 3),
        "fund_score": round(s_fund, 3),
        "macro_score": round(s_macro, 3),
        "total_score": round(s_total, 3),
        "weights": {"tech": W_TECH, "anno": W_ANNO, "fund": W_FUND, "macro": W_MACRO},
        "tech_components": tech_comp,
        "anno_components": anno_comp,
        "fund_components": fund_comp,
        "macro_components": macro_comp,
    }
    return signal, s_total, confidence, components


# ------------------------------------------------------------------
# Generate per-stock predictions
# ------------------------------------------------------------------
def predict_all_stocks(
    stocks: List[str],
    df_all: pd.DataFrame,
    atr_per: Dict[str, Dict[str, float]],
    kse100_idx: pd.DataFrame,
) -> Tuple[Dict[str, dict], Dict[str, Dict[str, dict]]]:
    """For each stock, compute the GM-Model prediction at the latest bar.
    Also compute per-pillar "model" predictions for the AI Models tab.
    """
    print("\n[GM] Generating per-stock predictions...")
    gm_predictions = {}
    pillar_predictions = {
        "Technical Engine (GM)": {},
        "Announcements Engine (GM)": {},
        "Fundamental Engine (GM)": {},
        "Macro Engine (GM)": {},
    }

    # Latest KSE-100 50-day return
    if len(kse100_idx) >= 50:
        idx_now = float(kse100_idx["index_value"].iloc[-1])
        idx_50 = float(kse100_idx["index_value"].iloc[-50])
        kse100_ret_latest = (idx_now - idx_50) / idx_50 if idx_50 > 0 else 0.0
    else:
        kse100_ret_latest = 0.0
    print(f"  KSE-100 proxy 50-day return: {kse100_ret_latest*100:.2f}%")

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

        # Lookup KSE-100 return at bar t (closest date in the index)
        try:
            date_t = sd.iloc[t]["date"]
            # Find closest index date <= t
            mask = kse100_idx["date"] <= date_t
            if mask.sum() >= 50:
                idx_now_t = float(kse100_idx.loc[mask, "index_value"].iloc[-1])
                idx_50_t = float(kse100_idx.loc[mask, "index_value"].iloc[-50])
                kse100_ret_t = (idx_now_t - idx_50_t) / idx_50_t if idx_50_t > 0 else 0.0
            else:
                kse100_ret_t = kse100_ret_latest
        except Exception:
            kse100_ret_t = kse100_ret_latest

        fin = load_financials(s)
        signal, total_score, confidence, components = compute_gm_signal(sd, t, fin, kse100_ret_t)
        entry, sl, tp1, tp2, tp3 = gm_atr_rules(signal if signal != "HOLD" else "BUY", cp, atr)

        if signal == "HOLD":
            sl = cp; tp1 = cp; tp2 = cp; tp3 = cp

        gm_predictions[s] = {
            "signal": signal,
            "direction": "LONG" if signal != "SELL" else "SHORT",
            "confidence": confidence,
            "currentPrice": round(cp, 2),
            "entry": round(entry, 2),
            "tp1": round(tp1, 2),
            "tp2": round(tp2, 2),
            "tp3": round(tp3, 2),
            "sl": round(sl, 2),
            "avgReturn": round(float(total_score), 4),
            "total_score": round(float(total_score), 3),
            "pillars": components,
        }

        # Per-pillar predictions (for AI Models tab — show as 4 separate "model" cards)
        # Each pillar's score → BUY/SELL/HOLD using same ±0.45 threshold
        pillar_scores = {
            "Technical Engine (GM)": (components["tech_score"], components.get("tech_components", {})),
            "Announcements Engine (GM)": (components["anno_score"], components.get("anno_components", {})),
            "Fundamental Engine (GM)": (components["fund_score"], components.get("fund_components", {})),
            "Macro Engine (GM)": (components["macro_score"], components.get("macro_components", {})),
        }
        for pname, (pscore, pcomp) in pillar_scores.items():
            psig = "BUY" if pscore >= GM_BUY_THRESHOLD else ("SELL" if pscore <= GM_SELL_THRESHOLD else "HOLD")
            p_sl, p_tp1, p_tp2, p_tp3, _ = gm_atr_rules(psig if psig != "HOLD" else "BUY", cp, atr)
            if psig == "HOLD":
                p_sl = cp; p_tp1 = cp; p_tp2 = cp; p_tp3 = cp
            p_conf = min(100, int(abs(pscore) * 100 + 15))
            pillar_predictions[pname][s] = {
                "signal": psig,
                "direction": "LONG" if psig != "SELL" else "SHORT",
                "confidence": p_conf,
                "currentPrice": round(cp, 2),
                "entry": round(cp, 2),
                "tp1": round(p_tp1, 2),
                "tp2": round(p_tp2, 2),
                "tp3": round(p_tp3, 2),
                "sl": round(p_sl, 2),
                "avgReturn": round(float(pscore), 4),
            }

        if (si + 1) % 50 == 0:
            print(f"  {si+1}/{len(stocks)} stocks processed...")

    print(f"  Done: {len(gm_predictions)} stocks have GM-Model predictions")
    return gm_predictions, pillar_predictions


# ------------------------------------------------------------------
# Backtest
# ------------------------------------------------------------------
def backtest_gm(
    stocks: List[str],
    df_all: pd.DataFrame,
    atr_per: Dict[str, Dict[str, float]],
    kse100_idx: pd.DataFrame,
    threshold: float = GM_BUY_THRESHOLD,
) -> dict:
    """Walk-forward backtest on last 20% of each stock's bars."""
    print(f"\n[GM] Backtesting on 20% holdout per stock (threshold=±{threshold})...")
    trades = []

    for s in stocks:
        sd = df_all[df_all["symbol"] == s].sort_values("date").reset_index(drop=True)
        n = len(sd)
        if n < 60 + 20:
            continue
        sp = int(n * 0.8)
        if sp >= n - 5:
            continue
        # Precompute arrays
        close_arr = sd["close"].values.astype(np.float64)
        high_arr = sd["high"].values.astype(np.float64)
        low_arr = sd["low"].values.astype(np.float64)
        atr_arr = sd["atr_14"].values.astype(np.float64)
        # Precompute 20-EMA array for trailing stop
        ema20_arr = pd.Series(close_arr).ewm(span=20, adjust=False).mean().values
        fin = load_financials(s)

        # Walk holdout at 5-bar step
        for t in range(sp, n - 5, 5):
            cp = float(close_arr[t])
            atr = float(atr_arr[t])
            if atr <= 0 or cp <= 0:
                continue
            # KSE-100 return at time t
            try:
                date_t = sd.iloc[t]["date"]
                mask = kse100_idx["date"] <= date_t
                if mask.sum() >= 50:
                    idx_now_t = float(kse100_idx.loc[mask, "index_value"].iloc[-1])
                    idx_50_t = float(kse100_idx.loc[mask, "index_value"].iloc[-50])
                    kse100_ret_t = (idx_now_t - idx_50_t) / idx_50_t if idx_50_t > 0 else 0.0
                else:
                    kse100_ret_t = 0.0
            except Exception:
                kse100_ret_t = 0.0

            signal, total_score, confidence, _ = compute_gm_signal(sd, t, fin, kse100_ret_t)
            # Use threshold override (for sweep)
            if threshold != GM_BUY_THRESHOLD:
                if total_score >= threshold:
                    signal = "BUY"
                elif total_score <= -threshold:
                    signal = "SELL"
                else:
                    signal = "HOLD"
            if signal == "HOLD":
                continue

            entry, sl, tp1, tp2, tp3, _ = (*gm_atr_rules(signal, cp, atr), None)
            ret = simulate_gm_exit(
                sd, t, signal, cp, sl, tp1, tp2, tp3, horizon=21,
                high_arr=high_arr, low_arr=low_arr, close_arr=close_arr,
                ema20_arr=ema20_arr,
            )
            trades.append({
                "symbol": s, "t": t, "direction": signal,
                "score": total_score, "confidence": confidence, "ret": ret,
            })

    if not trades:
        print("  ! No trades generated in backtest")
        return {
            "totalTrades": 0, "winRate": 0, "avgReturnPct": 0,
            "maxReturnPct": 0, "minReturnPct": 0, "stars": 0,
            "profitFactor": 0, "reliabilityTable": [],
            "threshold": threshold,
        }

    rets = np.array([tr["ret"] for tr in trades], dtype=float)
    valid_mask = np.isfinite(rets)
    if not valid_mask.all():
        n_bad = int((~valid_mask).sum())
        print(f"  ! Dropping {n_bad} trades with non-finite returns")
    rets = rets[valid_mask]
    trade_dir = np.array([tr["direction"] for tr in trades])[valid_mask]
    if len(rets) == 0:
        return {
            "totalTrades": 0, "winRate": 0, "avgReturnPct": 0,
            "maxReturnPct": 0, "minReturnPct": 0, "stars": 0,
            "profitFactor": 0, "reliabilityTable": [],
            "threshold": threshold,
        }
    wins = rets > 0
    win_rate = float(wins.mean())
    avg_ret = float(rets.mean())
    gross_profit = float(rets[rets > 0].sum()) if wins.any() else 0
    gross_loss = float(-rets[rets < 0].sum()) if (~wins).any() else 0
    profit_factor = gross_profit / max(gross_loss, 1e-9)
    print(f"  Trades: {len(rets)} | Win rate: {win_rate*100:.1f}% | "
          f"Avg ret: {avg_ret*100:.2f}% | PF: {profit_factor:.3f}")

    # Reliability table: score buckets vs actual hit rate
    scores = np.array([tr["score"] for tr in trades])[valid_mask]
    bins = np.linspace(-1, 1, 11)
    bin_inds = np.clip(np.digitize(scores, bins) - 1, 0, 9)
    reliability = []
    for bi in range(10):
        mask = bin_inds == bi
        if mask.sum() > 0:
            reliability.append({
                "bin": bi + 1,
                "bin_center": round(float((bins[bi] + bins[bi+1]) / 2), 2),
                "count": int(mask.sum()),
                "avg_score": round(float(scores[mask].mean()), 3),
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
        "reliabilityTable": reliability,
        "costBps": int(COST * 10000),
        "threshold": threshold,
    }


# ------------------------------------------------------------------
# Save to ml_predictions_multi.json
# ------------------------------------------------------------------
def save_to_json(
    gm_predictions: Dict[str, dict],
    pillar_predictions: Dict[str, Dict[str, dict]],
    gm_backtest: dict,
    threshold_sweep: List[dict],
):
    print(f"\n[GM] Saving to {PRED_FILE}...")
    if PRED_FILE.exists():
        with open(PRED_FILE, "r") as f:
            existing = json.load(f)
    else:
        existing = {}

    # Add 4 pillar "models" to the models dict
    models_dict = existing.get("models", {})
    for pname, preds in pillar_predictions.items():
        models_dict[pname] = {
            "trained": True,
            "version": "1.0.0",
            "predictions": preds,
        }
    existing["models"] = models_dict

    # GM-Model predictions (per-stock)
    existing["gm_model_predictions"] = gm_predictions

    # Add GM_MODEL to ensemble_backtesting
    ens_bt = existing.get("ensemble_backtesting", {})
    ens_bt["GM_MODEL"] = gm_backtest
    existing["ensemble_backtesting"] = ens_bt

    # GM metadata
    existing["gm_metadata"] = {
        "trained_at": pd.Timestamp.now().isoformat(),
        "formula": "S_total = 0.35*S_tech + 0.30*S_anno + 0.20*S_fund + 0.15*S_macro",
        "weights": {"tech": W_TECH, "anno": W_ANNO, "fund": W_FUND, "macro": W_MACRO},
        "thresholds": {"BUY": GM_BUY_THRESHOLD, "SELL": -GM_SELL_THRESHOLD},
        "confidence_formula": "min(100, int(abs(S_total) * 100 + 15))",
        "sl_rule": f"Entry ∓ {GM_SL_MULT}×ATR(14)",
        "tp_rule": f"TP1/2/3 = ±{GM_TP1_MULT}/±{GM_TP2_MULT}/±{GM_TP3_MULT}×ATR",
        "exits": "50%@TP1 (SL→BE), 30%@TP2, 20% trailing 20-EMA",
        "risk_unit_R": f"{GM_SL_MULT}×ATR(14)",
        "pillar_components": {
            "tech": TECH_W,
            "anno": ANNO_W,
            "fund": FUND_W,
            "macro": MACRO_W,
        },
        "pillar_models": list(pillar_predictions.keys()),
        "threshold_sweep": threshold_sweep,
        "cost_bps": int(COST * 10000),
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
                        help="Skip threshold sweep (saves time)")
    args = parser.parse_args()

    start = time.time()
    print("=" * 60)
    print("GM-Model Ensembler — 4-Pillar Weighted Signal Framework")
    print(f"  Formula: S_total = {W_TECH}*S_tech + {W_ANNO}*S_anno + {W_FUND}*S_fund + {W_MACRO}*S_macro")
    print(f"  Thresholds: BUY ≥ +{GM_BUY_THRESHOLD}, SELL ≤ -{GM_SELL_THRESHOLD}")
    print(f"  SL/TP: Entry ∓ {GM_SL_MULT}×ATR, TP1/2/3 = ±{GM_TP1_MULT}/±{GM_TP2_MULT}/±{GM_TP3_MULT}×ATR")
    print("  Exits: 50%@TP1 (SL→BE), 30%@TP2, 20% trail 20-EMA")
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

    print("\n[2/4] Computing ATR per stock + KSE-100 proxy index...")
    atr_per = get_atr_per_stock(df_all)
    kse100_idx = compute_kse100_index(df_all)
    print(f"  {len(atr_per)} stocks have ATR; KSE-100 proxy has {len(kse100_idx)} bars")

    print("\n[3/4] Generating per-stock GM-Model predictions...")
    gm_predictions, pillar_predictions = predict_all_stocks(
        stocks, df_all, atr_per, kse100_idx
    )

    print("\n[4/4] Backtesting GM-Model (with threshold sweep)...")
    # Primary backtest at user-spec threshold (0.45)
    gm_bt = backtest_gm(stocks, df_all, atr_per, kse100_idx, threshold=0.45)

    # Threshold sweep
    threshold_sweep = []
    if not args.no_sweep:
        print("\n  Sweep: trying thresholds 0.30/0.40/0.45/0.50/0.60")
        for thresh in [0.30, 0.40, 0.50, 0.60]:
            bt_t = backtest_gm(stocks, df_all, atr_per, kse100_idx, threshold=thresh)
            threshold_sweep.append({
                "threshold": thresh,
                "totalTrades": bt_t["totalTrades"],
                "winRate": bt_t["winRate"],
                "avgReturnPct": bt_t["avgReturnPct"],
                "profitFactor": bt_t["profitFactor"],
            })
        print("\n  Sweep summary:")
        print(f"  {'Threshold':>10} {'Trades':>8} {'WinRate':>8} {'AvgRet':>8} {'PF':>8}")
        for r in threshold_sweep:
            print(f"  {r['threshold']:>10.2f} {r['totalTrades']:>8} {r['winRate']:>7.1f}% {r['avgReturnPct']:>7.2f}% {r['profitFactor']:>8.3f}")

    save_to_json(gm_predictions, pillar_predictions, gm_bt, threshold_sweep)

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"GM-Model training complete in {elapsed:.0f}s ({elapsed/60:.1f} min)")
    print(f"{'='*60}")
    print(f"  Stocks with predictions: {len(gm_predictions)}")
    print(f"  Backtest (threshold=0.45): {gm_bt['totalTrades']} trades, "
          f"WR={gm_bt['winRate']}%, PF={gm_bt['profitFactor']}")


if __name__ == "__main__":
    main()
