import { NextResponse } from "next/server";
import { getQuote, getIndexConstituents } from "@/lib/latent/psxdata";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * Live price endpoint — now backed by psxdata (https://psxdata-api.fastapicloud.dev)
 * REPLACED askanalyst (which had only 361 stocks and was broken for ENGRO).
 * psxdata returns:
 *   - 1,048 stocks (vs 361 from askanalyst)
 *   - Rich quote fields: price, market_cap, pe_ratio, dividend_yield,
 *     free_float, volume_avg_30d, change_1y_pct, ldcp, change, change_pct
 *
 * For KSE100 index (no per-stock quote), we aggregate the index constituents
 * and compute total market_cap from the constituents list.
 */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") || "KSE100";

  // For KSE100 index — return the index constituent summary
  if (symbol === "KSE100") {
    try {
      const constituents = await getIndexConstituents("KSE100");
      if (!constituents || constituents.length === 0) {
        return NextResponse.json({ error: "KSE100 constituents unavailable", symbol }, { status: 502 });
      }
      // Aggregate total market cap & weighted average change
      const totalMktCap = constituents.reduce((s, c) => s + (c.market_cap_m || 0), 0);
      const totalWeight = constituents.reduce((s, c) => s + (c.idx_weight || 0), 0);
      return NextResponse.json({
        symbol: "KSE100",
        constituentsCount: constituents.length,
        total_market_cap_m: Math.round(totalMktCap),
        total_weight: Math.round(totalWeight * 100) / 100,
        constituents: constituents.slice(0, 10), // top 10 by weight (already sorted)
        mode: "live",
        timestamp: new Date().toISOString(),
      });
    } catch (e: any) {
      return NextResponse.json({ error: e.message, symbol }, { status: 502 });
    }
  }

  // For individual stocks — fetch the full quote from psxdata
  try {
    const quote = await getQuote(symbol);
    if (!quote || typeof quote.price !== "number" || quote.price === 0) {
      return NextResponse.json({
        error: `No quote available for ${symbol}`,
        symbol,
      }, { status: 404 });
    }
    // Return a unified shape that's backwards-compatible with the old
    // askanalyst-based response (close, change, changePct, etc.) PLUS the
    // new rich fields from psxdata (pe_ratio, dividend_yield, market_cap,
    // volume_avg_30d, change_1y_pct).
    const change = quote.change ?? 0;
    const changePct = quote.change_pct ?? 0;
    return NextResponse.json({
      symbol: quote.symbol,
      // Backwards-compatible fields (old consumers expected these):
      close: quote.price,
      open: 0, // psxdata quote doesn't include intraday OHLC — use historical for that
      high: 0,
      low: 0,
      volume: 0,
      prevClose: quote.ldcp ?? 0,
      change,
      changePct,
      dateStr: new Date().toISOString().split("T")[0],
      // New rich fields from psxdata:
      price: quote.price,
      market_cap: quote.market_cap,
      pe_ratio: quote.pe_ratio,
      dividend_yield: quote.dividend_yield,
      free_float: quote.free_float,
      volume_avg_30d: quote.volume_avg_30d,
      change_1y_pct: quote.change_1y_pct,
      ldcp: quote.ldcp,
      mode: "live",
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, symbol }, { status: 502 });
  }
}
