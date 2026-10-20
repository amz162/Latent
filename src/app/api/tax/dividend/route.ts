import { NextResponse } from "next/server";
import { calculateDividendTax, type FilerStatus } from "@/lib/latent/tax";
import { MOCK_STOCKS } from "@/lib/latent/mock-stocks";

// GET /api/tax/dividend?symbol=HUBC&shares=1000&filerStatus=filer
// Fetches latest declared dividend for the symbol, then computes tax.
//
// Sources for dividend per share:
//   1. Mock dividends baked into the project (DIVIDENDS list in Dividends.tsx)
//   2. In production: scrape investify.pk/announcements?type=dividend
//   3. Or fetch from AskAnalyst /api/psx/news/{symbol} and parse for dividend announcements

interface DividendInfo {
  symbol: string;
  dividendPerShare: number;     // PKR
  type: "Interim" | "Final" | "Special";
  exDate: string;
  announcementDate: string;
  source: string;
}

// Mock dividend data (matches Dividends.tsx)
const DIVIDEND_DB: Record<string, DividendInfo> = {
  HUBC: { symbol: "HUBC", dividendPerShare: 7, type: "Interim", exDate: "2026-01-15", announcementDate: "2025-12-20", source: "PSX announcement" },
  OGDC: { symbol: "OGDC", dividendPerShare: 4.5, type: "Interim", exDate: "2026-01-20", announcementDate: "2025-12-22", source: "PSX announcement" },
  PPL:  { symbol: "PPL",  dividendPerShare: 3.5, type: "Interim", exDate: "2026-01-22", announcementDate: "2025-12-23", source: "PSX announcement" },
  ENGRO:{ symbol: "ENGRO",dividendPerShare: 12,  type: "Final",   exDate: "2026-01-25", announcementDate: "2025-12-25", source: "PSX announcement" },
  LUCK: { symbol: "LUCK", dividendPerShare: 25,  type: "Final",   exDate: "2026-02-01", announcementDate: "2025-12-28", source: "PSX announcement" },
  MEBL: { symbol: "MEBL", dividendPerShare: 6,   type: "Interim", exDate: "2026-02-05", announcementDate: "2025-12-28", source: "PSX announcement" },
  PSO:  { symbol: "PSO",  dividendPerShare: 5,   type: "Interim", exDate: "2026-02-08", announcementDate: "2025-12-30", source: "PSX announcement" },
  SYS:  { symbol: "SYS",  dividendPerShare: 5,   type: "Final",   exDate: "2026-02-10", announcementDate: "2025-12-30", source: "PSX announcement" },
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get("symbol") || "").toUpperCase();
  const shares = Number(searchParams.get("shares") || 0);
  const filerStatus = (searchParams.get("filerStatus") || "filer") as FilerStatus;

  if (!symbol) {
    return NextResponse.json({ error: "symbol parameter required" }, { status: 400 });
  }
  if (!shares || shares <= 0) {
    return NextResponse.json({ error: "shares must be a positive number" }, { status: 400 });
  }
  if (filerStatus !== "filer" && filerStatus !== "non-filer") {
    return NextResponse.json({ error: "filerStatus must be 'filer' or 'non-filer'" }, { status: 400 });
  }

  const stock = MOCK_STOCKS.find((s) => s.symbol === symbol);
  const dividendInfo = DIVIDEND_DB[symbol];

  if (!dividendInfo) {
    return NextResponse.json({
      error: `No dividend data for ${symbol}. Available: ${Object.keys(DIVIDEND_DB).join(", ")}`,
    }, { status: 404 });
  }

  const tax = calculateDividendTax({
    shares,
    dividendPerShare: dividendInfo.dividendPerShare,
    filerStatus,
  });

  return NextResponse.json({
    symbol,
    stockName: stock?.name || symbol,
    shares,
    filerStatus,
    dividendInfo,
    ...tax,
  });
}
