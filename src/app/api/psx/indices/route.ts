import { NextResponse } from "next/server";
import { getIndices } from "@/lib/latent/psxdata";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

/**
 * GET /api/psx/indices
 * Returns the list of all 18 PSX indices:
 *   KSE100, KSE100PR, ALLSHR, KSE30, MII30, BKTI, OGTI, KMIALLSHR,
 *   PSXDIV20, UPP9, NITPGI, NBPPGI, MZNPI, JSMFI, ACI, JSGBKTI,
 *   HBLTTI, KMI30
 *
 * Response: { indices: ["KSE100", "KMI30", ...] }
 */
export async function GET() {
  try {
    const indices = await getIndices();
    return NextResponse.json({
      indices,
      count: indices.length,
      source: "psxdata",
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 502 });
  }
}
