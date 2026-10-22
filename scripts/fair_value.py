#!/usr/bin/env python3
"""
Fair value calculator for PSX stocks (DDM, DCF, Residual Income, P/E, P/B, EV/EBITDA, Graham),
sector-weighted blend, margin-of-safety verdict, and r-vs-g sensitivity table.
"""
import argparse, json, math, os, sys
from dataclasses import dataclass, asdict
from typing import Optional
import numpy as np
import pandas as pd

RF = 0.12; ERP = 0.08; TERMINAL_G = 0.06; MOS = 0.25; YEARS = 5

WEIGHTS = {
    "bank":       {"residual_income": .35, "ddm": .25, "pb": .40},
    "fertilizer": {"ddm": .40, "dcf": .30, "pe": .30},
    "power":      {"ddm": .40, "dcf": .40, "pe": .20},
    "cement":     {"dcf": .50, "ev_ebitda": .30, "pe": .20},
    "oilgas":     {"dcf": .40, "pe": .40, "ddm": .20},
    "default":    {"pe": .30, "pb": .20, "dcf": .20, "ddm": .20, "graham": .10},
}

@dataclass
class Fundamentals:
    symbol: str
    sector: str = "default"
    price: Optional[float] = None
    eps: Optional[float] = None
    bvps: Optional[float] = None
    dps: Optional[float] = None
    fcf: Optional[float] = None
    shares: Optional[float] = None
    net_debt: Optional[float] = 0.0
    ebitda: Optional[float] = None
    growth: float = 0.08
    beta: float = 1.0
    roe: Optional[float] = None
    target_pe: Optional[float] = None
    target_pb: Optional[float] = None
    target_ev_ebitda: Optional[float] = None
    debt_ratio: float = 0.30
    cost_of_debt: float = 0.15
    tax: float = 0.29

def cost_of_equity(beta, rf=RF, erp=ERP): return rf + beta * erp
def wacc(ke, kd, tax, debt_ratio): return (1 - debt_ratio) * ke + debt_ratio * kd * (1 - tax)
def _fade(g1, gt, t, years): return g1 + (gt - g1) * (t - 1) / max(years - 1, 1)

def ddm(dps, ke, g1, gt=TERMINAL_G, years=YEARS):
    if not dps or dps <= 0 or ke <= gt: return None
    v, d = 0.0, dps
    for t in range(1, years + 1): d *= 1 + _fade(g1, gt, t, years); v += d / (1 + ke) ** t
    tv = d * (1 + gt) / (ke - gt); return v + tv / (1 + ke) ** years

def dcf(fcf, shares, net_debt, w, g1, gt=TERMINAL_G, years=YEARS):
    if not fcf or fcf <= 0 or not shares or w <= gt: return None
    v, cf = 0.0, fcf
    for t in range(1, years + 1): cf *= 1 + _fade(g1, gt, t, years); v += cf / (1 + w) ** t
    tv = cf * (1 + gt) / (w - gt); ev = v + tv / (1 + w) ** years
    return (ev - (net_debt or 0.0)) / shares

def residual_income(bvps, roe, ke, payout, years=YEARS):
    if not bvps or bvps <= 0 or roe is None: return None
    payout = min(max(payout or 0.0, 0.0), 1.0); bv, v = bvps, bvps
    for t in range(1, years + 1):
        roe_t = roe + (ke - roe) * t / years
        v += (roe_t - ke) * bv / (1 + ke) ** t; bv *= 1 + roe_t * (1 - payout)
    return v

def pe_value(eps, target_pe): return eps * target_pe if eps and eps > 0 and target_pe else None
def pb_value(bvps, target_pb): return bvps * target_pb if bvps and bvps > 0 and target_pb else None
def ev_ebitda_value(ebitda, mult, net_debt, shares):
    if not (ebitda and ebitda > 0 and mult and shares): return None
    return (ebitda * mult - (net_debt or 0.0)) / shares
def graham_number(eps, bvps):
    return math.sqrt(22.5 * eps * bvps) if eps and bvps and eps > 0 and bvps > 0 else None

def _core(f, ke_shift=0.0, g_shift=0.0):
    ke = cost_of_equity(f.beta) + ke_shift
    w = wacc(ke, f.cost_of_debt, f.tax, f.debt_ratio)
    gt = TERMINAL_G + g_shift
    v = dcf(f.fcf, f.shares, f.net_debt, w, f.growth, gt)
    return v if v is not None else ddm(f.dps, ke, f.growth, gt)

def value_stock(f):
    ke = cost_of_equity(f.beta); w = wacc(ke, f.cost_of_debt, f.tax, f.debt_ratio)
    roe = f.roe if f.roe is not None else (f.eps / f.bvps if f.eps and f.bvps else None)
    payout = (f.dps / f.eps) if f.dps and f.eps and f.eps > 0 else 0.0
    vals = {
        "ddm": ddm(f.dps, ke, f.growth),
        "dcf": dcf(f.fcf, f.shares, f.net_debt, w, f.growth),
        "residual_income": residual_income(f.bvps, roe, ke, payout),
        "pe": pe_value(f.eps, f.target_pe),
        "pb": pb_value(f.bvps, f.target_pb),
        "ev_ebitda": ev_ebitda_value(f.ebitda, f.target_ev_ebitda, f.net_debt, f.shares),
        "graham": graham_number(f.eps, f.bvps),
    }
    valid = {k: v for k, v in vals.items() if v and v > 0}
    w_map = WEIGHTS.get(f.sector, WEIGHTS["default"])
    use = {k: w_map[k] for k in valid if k in w_map} or {k: 1.0 for k in valid}
    if not use: return {"symbol": f.symbol, "error": "not enough data for any method"}
    tot = sum(use.values()); fv = sum(valid[k] * wt / tot for k, wt in use.items())
    price = f.price
    out = {"symbol": f.symbol, "sector": f.sector, "price": price,
           "fair_value": round(fv, 2), "low": round(min(valid[k] for k in use), 2),
           "high": round(max(valid[k] for k in use), 2), "ke": round(ke, 4), "wacc": round(w, 4)}
    out.update({k: (round(v, 2) if v else None) for k, v in vals.items()})
    if price:
        out["upside_pct"] = round((fv / price - 1) * 100, 1)
        out["buy_below"] = round(fv * (1 - MOS), 2)
        if price <= fv * (1 - MOS): out["verdict"] = "UNDERVALUED (margin of safety met)"
        elif price <= fv: out["verdict"] = "SLIGHTLY UNDERVALUED"
        elif price <= fv * 1.15: out["verdict"] = "FAIRLY VALUED"
        else: out["verdict"] = "OVERVALUED"
    return out

def sensitivity(f):
    shifts = [-0.02, -0.01, 0.0, 0.01, 0.02]
    base_ke, base_g = cost_of_equity(f.beta), TERMINAL_G
    rows = {}
    for dk in shifts:
        rows[f"r={base_ke + dk:.1%}"] = {f"g={base_g + dg:.1%}": (round(v, 1) if (v := _core(f, dk, dg)) else None) for dg in shifts}
    return rows

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol"); ap.add_argument("--file", default="fundamentals.json")
    a = ap.parse_args()
    with open(a.file) as fh: stocks = [Fundamentals(**r) for r in json.load(fh)]
    if a.symbol: stocks = [s for s in stocks if s.symbol == a.symbol]
    rows = [value_stock(s) for s in stocks]
    df = pd.DataFrame(rows)
    show = [c for c in ["symbol","price","fair_value","low","high","upside_pct","buy_below","verdict"] if c in df.columns]
    print(df[show].to_string(index=False)); df.to_csv("fair_values.csv", index=False)
    if a.symbol and stocks: print("\nSensitivity:", json.dumps(sensitivity(stocks[0]), indent=2))

if __name__ == "__main__": main()
