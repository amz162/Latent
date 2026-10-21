import { NextResponse } from "next/server";
import { getSectorStocks } from "@/lib/latent/psxdata";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * GET /api/psx/sectors/[name]/stocks
 * Returns all stocks in a given sector.
 *
 * Use the FULL sector name from /api/psx/sectors (e.g. "OIL & GAS EXPLORATION COMPANIES",
 * not "OIL & GAS EXPLORATION" — note the "COMPANIES" suffix).
 *
 * URL-encode spaces and special characters when calling:
 *   /api/psx/sectors/OIL%20%26%20GAS%20EXPLORATION%20COMPANIES/stocks
 *
 * Response: { sectorName, stocks: ["MARI", "OGDC", "POL", "PPL"], count }
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const sectorName = decodeURIComponent(name);
  try {
    const stocks = await getSectorStocks(sectorName);
    return NextResponse.json({
      sectorName,
      stocks,
      count: stocks.length,
      source: "psxdata",
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
