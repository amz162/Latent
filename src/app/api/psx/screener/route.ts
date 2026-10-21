import { NextResponse } from "next/server";
import { getScreener } from "@/lib/latent/psxdata";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/psx/screener
 * Returns 750 stocks with full screener data in ONE call:
 *   symbol, sector, listed_in, market_cap, price, pe_ratio,
 *   dividend_yield, free_float, volume_avg_30d, change_1y_pct
 *
 * Use this for building dashboards that show PE ratio / dividend yield /
 * market cap across many stocks at once (vs N per-stock /quote calls).
 *
 * Response: { stocks: [{ symbol, sector, ... }], count, source }
 */
export async function GET() {
  try {
    const stocks = await getScreener();
    return NextResponse.json({
      stocks,
      count: stocks.length,
      source: "psxdata",
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
