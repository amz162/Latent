import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// technicalchart/day/{from_ts}/{to_ts}/{symbol}
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  // Default to last 1 year window if not provided
  const to = Date.now();
  const from = to - 365 * 24 * 60 * 60 * 1000;
  try {
    const url = `https://api.askanalyst.com.pk/api/technicalchart/day/${from}/${to}/${encodeURIComponent(symbol)}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" }, cache: "no-store" });
    if (!res.ok) return NextResponse.json({ error: `Upstream error: ${res.status}` }, { status: res.status });
    const data = await res.json();
    return NextResponse.json({ technical: data });
  } catch (err) {
    console.error(`[/api/psx/technical/${symbol}] error:`, err);
    return NextResponse.json({ error: "Failed to fetch technical chart data" }, { status: 502 });
  }
}
