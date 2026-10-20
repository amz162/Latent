import { NextResponse } from "next/server";
import { calculateFairValue, getDefaultFairValueInputs, type FairValueInput } from "@/lib/latent/fair-value";
import { MOCK_STOCKS } from "@/lib/latent/mock-stocks";

// GET /api/fair-value/[symbol]
// Fetches all financial data required + computes all 6 fair value methods + aggregates.
//
// Data flow:
//   1. Get current price from MOCK_STOCKS (or fetch latest from /api/psx/technical/[symbol])
//   2. Fetch financials from /api/psx/financials/[symbol] → EPS, BVPS, DPS, FCF, shares
//   3. Fetch sector comps from /api/psx/valuation/[symbol] → sector P/E + P/B
//   4. Fetch ratios from /api/psx/ratio/[symbol] → P/E, P/B, dividend yield
//   5. Build FairValueInput (with defaults — user can override in UI)
//   6. Calculate all 6 methods + aggregate
//   7. Return summary

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface FinancialData {
  eps?: number;
  bookValuePerShare?: number;
  dividendPerShare?: number;
  fcf?: number;
  sharesOutstanding?: number;
}

interface ValuationData {
  sectorPE?: number;
  sectorPB?: number;
}

interface RatioData {
  pe?: number;
  pb?: number;
  dividendYield?: number;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  const symbolUpper = symbol.toUpperCase();

  const stock = MOCK_STOCKS.find((s) => s.symbol === symbolUpper);
  if (!stock) {
    return NextResponse.json(
      { error: `Unknown symbol: ${symbolUpper}. Available: ${MOCK_STOCKS.map(s => s.symbol).join(", ")}` },
      { status: 404 }
    );
  }

  // Fetch financials, valuation, and ratios in parallel from AskAnalyst proxies
  const [financialsRes, valuationRes, ratioRes] = await Promise.allSettled([
    fetch(`http://localhost:3000/api/psx/financials/${symbolUpper}`).then(r => r.json()),
    fetch(`http://localhost:3000/api/psx/valuation/${symbolUpper}`).then(r => r.json()),
    fetch(`http://localhost:3000/api/psx/ratio/${symbolUpper}`).then(r => r.json()),
  ]);

  const financials: FinancialData = financialsRes.status === "fulfilled" ? parseFinancials(financialsRes.value) : {};
  const valuation: ValuationData = valuationRes.status === "fulfilled" ? parseValuation(valuationRes.value) : {};
  const ratiosParsed = ratioRes.status === "fulfilled" ? parseRatiosForFairValue(ratioRes.value) : { epsHistory: [] };

  // Build input with defaults from mock-stocks (EPS, dividend yield, etc. available there)
  const fallbackEps = stock.price / (stock.peRatio || 8); // EPS = price / P/E
  const fallbackBVPS = stock.price / (stock.pbRatio || 1.2); // BVPS = price / P/B
  const fallbackDPS = stock.price * (stock.dividendYield / 100);

  // Compute 3-year EPS CAGR from history (if available) for default growth rate
  let computedGrowthRate = 8; // conservative default
  if (ratiosParsed.epsHistory.length >= 4) {
    const last3 = ratiosParsed.epsHistory.slice(-4); // last 4 years (current + 3 prior)
    if (last3[0] > 0 && last3[last3.length - 1] > 0) {
      const yearsDelta = last3.length - 1;
      const cagr = (Math.pow(last3[last3.length - 1] / last3[0], 1 / yearsDelta) - 1) * 100;
      if (!isNaN(cagr) && isFinite(cagr) && cagr > -50 && cagr < 100) {
        computedGrowthRate = Math.max(-20, Math.min(40, cagr)); // clamp to sane range
      }
    }
  }

  // User can override any of these via query params
  const url = _req.url ? new URL(_req.url) : null;
  const overrides = url ? Object.fromEntries(url.searchParams) : {};

  const input: FairValueInput = {
    symbol: symbolUpper,
    currentPrice: Number(overrides.currentPrice) || stock.price,
    eps: Number(overrides.eps) || ratiosParsed.eps || financials.eps || fallbackEps,
    bookValuePerShare: Number(overrides.bookValuePerShare) || ratiosParsed.bvps || financials.bookValuePerShare || fallbackBVPS,
    dividendPerShare: Number(overrides.dividendPerShare) || ratiosParsed.dps || financials.dividendPerShare || fallbackDPS,
    sectorPE: Number(overrides.sectorPE) || ratiosParsed.per || valuation.sectorPE || stock.peRatio || 8,
    sectorPB: Number(overrides.sectorPB) || ratiosParsed.pbv || valuation.sectorPB || stock.pbRatio || 1.2,
    growthRate: Number(overrides.growthRate) || computedGrowthRate,
    dividendYield: Number(overrides.dividendYield) || ratiosParsed.divYield || stock.dividendYield,
    pakistanBondYield: Number(overrides.pakistanBondYield) || 15,
    fcf: Number(overrides.fcf) || (financials.fcf ?? (fallbackEps * 0.8) * 1_000_000),
    sharesOutstanding: Number(overrides.sharesOutstanding) || financials.sharesOutstanding || 1_000_000,
    shortTermGrowth: Number(overrides.shortTermGrowth) || Math.max(5, computedGrowthRate + 2),
    terminalGrowth: Number(overrides.terminalGrowth) || 3,
    wacc: Number(overrides.wacc) || 18,
    dividendGrowthRate: Number(overrides.dividendGrowthRate) || Math.max(0, computedGrowthRate - 3),
    requiredReturn: Number(overrides.requiredReturn) || 18,
  };

  const summary = calculateFairValue(input);

  return NextResponse.json({
    symbol: symbolUpper,
    stockName: stock.name,
    summary,
    inputs: input,
    dataSources: {
      financials: financialsRes.status === "fulfilled" ? "fetched" : "fallback",
      valuation: valuationRes.status === "fulfilled" ? "fetched" : "fallback",
      ratios: ratioRes.status === "fulfilled" ? "fetched" : "fallback",
    },
    meta: {
      epsHistoryLength: ratiosParsed.epsHistory.length,
      computedGrowthRate: computedGrowthRate.toFixed(2) + "%",
      note: "Growth rate auto-computed from 3-year EPS CAGR (if history available). Override via Advanced panel.",
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Upstream response parsers (best-effort — AskAnalyst may return various shapes)
// ────────────────────────────────────────────────────────────────────────────

function parseFinancials(raw: any): FinancialData {
  if (!raw || typeof raw !== "object") return {};
  const f = raw.financials || raw.data || raw;
  if (Array.isArray(f)) {
    // Take most recent entry
    const latest = f[0] || {};
    return {
      eps: Number(latest.eps || latest.EPS || latest.earningsPerShare) || undefined,
      bookValuePerShare: Number(latest.bvps || latest.bookValuePerShare || latest.book_value_per_share) || undefined,
      dividendPerShare: Number(latest.dps || latest.dividendPerShare || latest.dividend_per_share) || undefined,
      fcf: Number(latest.fcf || latest.freeCashFlow) || undefined,
      sharesOutstanding: Number(latest.sharesOutstanding || latest.shares_outstanding) || undefined,
    };
  }
  return {
    eps: Number(f.eps || f.EPS) || undefined,
    bookValuePerShare: Number(f.bvps || f.bookValuePerShare) || undefined,
    dividendPerShare: Number(f.dps || f.dividendPerShare) || undefined,
    fcf: Number(f.fcf || f.freeCashFlow) || undefined,
    sharesOutstanding: Number(f.sharesOutstanding || f.shares_outstanding) || undefined,
  };
}

/**
 * Parse AskAnalyst /api/rationew/[symbol] response.
 * Shape: [{ section: "Valuation", data: [{ label: "EPS", data: [{year, value}] }, { label: "DPS", ...}, ...] }, ...]
 *
 * We extract: latest EPS, latest DPS, latest BVPS. Also compute 3-year historical EPS CAGR
 * for default growth rate assumption.
 */
function parseRatiosForFairValue(raw: any): { eps?: number; dps?: number; bvps?: number; per?: number; pbv?: number; divYield?: number; epsHistory: number[] } {
  if (!raw || typeof raw !== "object") return { epsHistory: [] };
  const data = raw.ratios || raw;
  if (!Array.isArray(data)) return { epsHistory: [] };

  const valuationSection = data.find((s: any) => s?.section === "Valuation");
  if (!valuationSection || !Array.isArray(valuationSection.data)) return { epsHistory: [] };

  const getLatestValue = (label: string): number | undefined => {
    const item = valuationSection.data.find((d: any) => String(d?.label).toUpperCase() === label);
    if (!item || !Array.isArray(item.data) || item.data.length === 0) return undefined;
    // Sort by year descending, take most recent
    const sorted = [...item.data].sort((a: any, b: any) => String(b.year).localeCompare(String(a.year)));
    const v = Number(sorted[0]?.value);
    return isNaN(v) ? undefined : v;
  };

  const getSeries = (label: string): number[] => {
    const item = valuationSection.data.find((d: any) => String(d?.label).toUpperCase() === label);
    if (!item || !Array.isArray(item.data)) return [];
    return [...item.data]
      .sort((a: any, b: any) => String(a.year).localeCompare(String(b.year)))
      .map((p: any) => Number(p.value))
      .filter((v: number) => !isNaN(v));
  };

  const epsHistory = getSeries("EPS");

  return {
    eps: getLatestValue("EPS"),
    dps: getLatestValue("DPS"),
    bvps: getLatestValue("BVPS"),
    per: getLatestValue("PER"),
    pbv: getLatestValue("PBV"),
    divYield: getLatestValue("DIV YIELD"),
    epsHistory,
  };
}

function parseValuation(raw: any): ValuationData {
  if (!raw || typeof raw !== "object") return {};
  const v = raw.valuation || raw.data || raw;
  return {
    sectorPE: Number(v.sectorPE || v.sector_pe || v.industryPE || v.industry_pe) || undefined,
    sectorPB: Number(v.sectorPB || v.sector_pb || v.industryPB || v.industry_pb) || undefined,
  };
}

function parseRatios(raw: any): RatioData {
  if (!raw || typeof raw !== "object") return {};
  const r = raw.ratios || raw.data || raw;
  return {
    pe: Number(r.pe || r.PE || r.priceToEarnings) || undefined,
    pb: Number(r.pb || r.PB || r.priceToBook) || undefined,
    dividendYield: Number(r.dividendYield || r.dividend_yield || r.dy) || undefined,
  };
}
