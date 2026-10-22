import { NextResponse } from "next/server";

// AskAnalyst.com.pk news proxy for a specific symbol
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol } = await params;
  try {
    const res = await fetch(`https://api.askanalyst.com.pk/api/news/${encodeURIComponent(symbol)}`, {
      headers: { "Accept": "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Upstream error: ${res.status}` }, { status: res.status });
    }
    const data = await res.json();
    return NextResponse.json({ news: data });
  } catch (err) {
    console.error(`[/api/psx/news/${symbol}] error:`, err);
    return NextResponse.json({ error: "Failed to fetch news from upstream" }, { status: 502 });
  }
}
