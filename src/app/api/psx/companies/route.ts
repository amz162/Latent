import { NextResponse } from "next/server";
import { getAllStocks, getScreener } from "@/lib/latent/psxdata";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Returns ALL 1,048 PSX-listed stocks (vs 361 from askanalyst previously).
 * Sources from psxdata — the new primary data provider.
 *
 * Two response shapes supported (for backwards compatibility with code
 * that expected the old askanalyst shape):
 *
 *   1. Default (no params): { companies: [{ value, label, sector }] }
 *      - Merges screener data (sector, listed_in) with the symbol list.
 *      - 750 of 1,048 stocks have full screener data; the other 298 come
 *        through with sector=null.
 *
 *   2. ?plain=1: { companies: ["AKBLTFC6", "BAFLTFC6", ...] }
 *      - Bare list of symbol strings (faster, no screener merge).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const plain = url.searchParams.get("plain") === "1";

  try {
    if (plain) {
      const symbols = await getAllStocks();
      return NextResponse.json({ companies: symbols, count: symbols.length });
    }

    const [symbols, screener] = await Promise.all([getAllStocks(), getScreener()]);
    // Build a map: symbol → screener row (for sector lookup)
    const screenerMap = new Map<string, any>();
    for (const row of screener) {
      if (row.symbol) screenerMap.set(row.symbol.toUpperCase(), row);
    }

    // Sector code → sector name mapping (from /sectors endpoint — but we
    // can just return the code as a string; the UI can decode it).
    const companies = symbols.map((sym: string) => {
      const sc = screenerMap.get(sym.toUpperCase());
      return {
        value: sym,
        label: sym, // psxdata doesn't provide company names — UI can resolve via fundamentals if needed
        sector: sc?.sector ?? null,
        listed_in: sc?.listed_in ?? null,
        market_cap: sc?.market_cap ?? null,
        price: sc?.price ?? null,
        pe_ratio: sc?.pe_ratio ?? null,
        dividend_yield: sc?.dividend_yield ?? null,
        change_1y_pct: sc?.change_1y_pct ?? null,
      };
    });

    return NextResponse.json({
      companies,
      count: companies.length,
      screener_count: screener.length,
      source: "psxdata",
    });
  } catch (err: any) {
    console.error("[/api/psx/companies] error:", err);
    return NextResponse.json(
      { error: "Failed to fetch company list from psxdata", details: err.message },
      { status: 502 }
    );
  }
}
