import { NextResponse } from "next/server";

// AskAnalyst.com.pk API proxy — fetches the list of all PSX-listed companies
// with their symbols. Used as the master list for search + symbol resolution.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch("https://api.askanalyst.com.pk/api/companylistwithsymbols", {
      headers: { "Accept": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `Upstream error: ${res.status}` },
        { status: res.status }
      );
    }
    const data = await res.json();
    return NextResponse.json({ companies: data });
  } catch (err) {
    console.error("[/api/psx/companies] error:", err);
    return NextResponse.json(
      { error: "Failed to fetch company list from upstream" },
      { status: 502 }
    );
  }
}
