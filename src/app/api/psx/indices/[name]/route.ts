import { NextResponse } from "next/server";
import { getIndexConstituents } from "@/lib/latent/psxdata";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * GET /api/psx/indices/[name]
 * Returns constituents of a given index (e.g. KSE100 → 100 stocks with weights).
 *
 * Response: {
 *   indexName,
 *   constituents: [{ symbol, current_index, idx_weight, idx_point,
 *                    market_cap_m, freefloat_m, shares_m }],
 *   count
 * }
 *
 * Use the index name without spaces: "KSE100" (not "KSE 100").
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const indexName = decodeURIComponent(name);
  try {
    const constituents = await getIndexConstituents(indexName);
    return NextResponse.json({
      indexName,
      constituents,
      count: constituents.length,
      source: "psxdata",
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
