import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Pakistan macro assumptions
const RF = 0.12, ERP = 0.08, TERMINAL_G = 0.06, MOS = 0.25, YEARS = 5;

const WEIGHTS: Record<string, Record<string, number>> = {
  bank: { residual_income: 0.35, ddm: 0.25, pb: 0.40 },
  fertilizer: { ddm: 0.40, dcf: 0.30, pe: 0.30 },
  power: { ddm: 0.40, dcf: 0.40, pe: 0.20 },
  cement: { dcf: 0.50, ev_ebitda: 0.30, pe: 0.20 },
  oilgas: { dcf: 0.40, pe: 0.40, ddm: 0.20 },
  default: { pe: 0.30, pb: 0.20, dcf: 0.20, ddm: 0.20, graham: 0.10 },
};

interface Fundamentals {
  symbol: string; sector: string; price: number; eps: number; bvps: number;
  dps: number; fcf: number; shares: number; net_debt: number; ebitda: number;
  growth: number; beta: number; roe: number; target_pe: number; target_pb: number;
  target_ev_ebitda: number; debt_ratio: number; cost_of_debt: number; tax: number;
}

function costOfEquity(beta: number): number { return RF + beta * ERP; }
function wacc(ke: number, kd: number, tax: number, dr: number): number {
  return (1 - dr) * ke + dr * kd * (1 - tax);
}
function fade(g1: number, gt: number, t: number, years: number): number {
  return g1 + (gt - g1) * (t - 1) / Math.max(years - 1, 1);
}

function ddm(dps: number, ke: number, g1: number, gt = TERMINAL_G, years = YEARS): number | null {
  if (!dps || dps <= 0 || ke <= gt) return null;
  let v = 0, d = dps;
  for (let t = 1; t <= years; t++) { d *= 1 + fade(g1, gt, t, years); v += d / Math.pow(1 + ke, t); }
  const tv = d * (1 + gt) / (ke - gt);
  return v + tv / Math.pow(1 + ke, years);
}

function dcf(fcf: number, shares: number, netDebt: number, w: number, g1: number, gt = TERMINAL_G, years = YEARS): number | null {
  if (!fcf || fcf <= 0 || !shares || w <= gt) return null;
  let v = 0, cf = fcf;
  for (let t = 1; t <= years; t++) { cf *= 1 + fade(g1, gt, t, years); v += cf / Math.pow(1 + w, t); }
  const tv = cf * (1 + gt) / (w - gt);
  const ev = v + tv / Math.pow(1 + w, years);
  return (ev - (netDebt || 0)) / shares;
}

function residualIncome(bvps: number, roe: number, ke: number, payout: number, years = YEARS): number | null {
  if (!bvps || bvps <= 0 || roe === null || roe === undefined) return null;
  payout = Math.min(Math.max(payout || 0, 0), 1);
  let bv = bvps, v = bvps;
  for (let t = 1; t <= years; t++) {
    const roeT = roe + (ke - roe) * t / years;
    v += (roeT - ke) * bv / Math.pow(1 + ke, t);
    bv *= 1 + roeT * (1 - payout);
  }
  return v;
}

function peValue(eps: number, targetPe: number): number | null {
  return (eps && eps > 0 && targetPe) ? eps * targetPe : null;
}
function pbValue(bvps: number, targetPb: number): number | null {
  return (bvps && bvps > 0 && targetPb) ? bvps * targetPb : null;
}
function evEbitdaValue(ebitda: number, mult: number, netDebt: number, shares: number): number | null {
  if (!(ebitda && ebitda > 0 && mult && shares)) return null;
  return (ebitda * mult - (netDebt || 0)) / shares;
}
function grahamNumber(eps: number, bvps: number): number | null {
  return (eps && bvps && eps > 0 && bvps > 0) ? Math.sqrt(22.5 * eps * bvps) : null;
}

function valueStock(f: Fundamentals) {
  const ke = costOfEquity(f.beta);
  const w = wacc(ke, f.cost_of_debt, f.tax, f.debt_ratio);
  const roe = f.roe ?? (f.eps && f.bvps ? f.eps / f.bvps : null);
  const payout = (f.dps && f.eps && f.eps > 0) ? f.dps / f.eps : 0;

  const vals: Record<string, number | null> = {
    ddm: ddm(f.dps, ke, f.growth),
    dcf: dcf(f.fcf, f.shares, f.net_debt, w, f.growth),
    residual_income: residualIncome(f.bvps, roe ?? 0, ke, payout),
    pe: peValue(f.eps, f.target_pe),
    pb: pbValue(f.bvps, f.target_pb),
    ev_ebitda: evEbitdaValue(f.ebitda, f.target_ev_ebitda, f.net_debt, f.shares),
    graham: grahamNumber(f.eps, f.bvps),
  };

  const valid: Record<string, number> = {};
  for (const [k, v] of Object.entries(vals)) { if (v && v > 0) valid[k] = v; }

  const wMap = WEIGHTS[f.sector] || WEIGHTS.default;
  const use: Record<string, number> = {};
  for (const k of Object.keys(valid)) { if (k in wMap) use[k] = wMap[k]; }
  if (Object.keys(use).length === 0) for (const k of Object.keys(valid)) use[k] = 1.0;
  if (Object.keys(use).length === 0) return { error: "Not enough data for any valuation method" };

  const tot = Object.values(use).reduce((a, b) => a + b, 0);
  let fv = 0;
  for (const [k, wt] of Object.entries(use)) fv += valid[k] * wt / tot;

  const usedValues = Object.entries(use).map(([k, wt]) => ({
    method: k, value: Math.round(valid[k] * 100) / 100, weight: Math.round(wt / tot * 100) / 100,
  }));

  const low = Math.min(...Object.values(use).map(k => valid[Object.keys(use).find(key => use[key] === k)!]!));
  const high = Math.max(...Object.values(use).map(k => valid[Object.keys(use).find(key => use[key] === k)!]!));

  const out: any = {
    symbol: f.symbol, sector: f.sector, price: f.price,
    fair_value: Math.round(fv * 100) / 100,
    low: Math.round(low * 100) / 100, high: Math.round(high * 100) / 100,
    ke: Math.round(ke * 10000) / 10000, wacc: Math.round(w * 10000) / 10000,
    methods: usedValues,
    all_values: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v ? Math.round(v * 100) / 100 : null])),
  };

  if (f.price) {
    out.upside_pct = Math.round((fv / f.price - 1) * 1000) / 10;
    out.buy_below = Math.round(fv * (1 - MOS) * 100) / 100;
    if (f.price <= fv * (1 - MOS)) out.verdict = "UNDERVALUED (margin of safety met)";
    else if (f.price <= fv) out.verdict = "SLIGHTLY UNDERVALUED";
    else if (f.price <= fv * 1.15) out.verdict = "FAIRLY VALUED";
    else out.verdict = "OVERVALUED";
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const f: Fundamentals = await req.json();
    const result = valueStock(f);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: "Failed to compute fair value" }, { status: 500 });
  }
}
