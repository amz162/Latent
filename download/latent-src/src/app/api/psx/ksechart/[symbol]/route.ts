import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  try {
    const res = await fetch(`https://api.askanalyst.com.pk/api/ksechartnew/${encodeURIComponent(symbol)}`, {
      headers: { "Accept": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ error: `Upstream error: ${res.status}` }, { status: res.status });
    const data = await res.json();
    return NextResponse.json({ ksechart: data });
  } catch (err) {
    console.error(`[/api/psx/ksechart/${symbol}] error:`, err);
    return NextResponse.json({ error: "Failed to fetch KSE chart data" }, { status: 502 });
  }
}
