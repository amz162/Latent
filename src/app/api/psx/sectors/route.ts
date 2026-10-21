import { NextResponse } from "next/server";
import { getSectors } from "@/lib/latent/psxdata";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * GET /api/psx/sectors
 * Returns all 38 PSX sectors with advance/decline/turnover/market_cap.
 * Cached server-side for 1 hour by the psxdata client.
 *
 * Response: { sectors: [{ sector_code, sector_name, advance, decline,
 *   unchanged, turnover, market_cap_b }] }
 */
export async function GET() {
  try {
    const sectors = await getSectors();
    return NextResponse.json({
      sectors,
      count: sectors.length,
      source: "psxdata",
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
