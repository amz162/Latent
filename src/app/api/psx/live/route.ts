import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sym = (url.searchParams.get("symbol") || "KSE100").toUpperCase();
  try {
    const r = await fetch(`https://psxdata-api.fastapicloud.dev/stocks/${encodeURIComponent(sym)}/quote`, { headers: { "User-Agent": "LatentBot/1.0" } });
    if (!r.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const j = await r.json();
    const d = j.data || j;
    if (d.symbol?.toUpperCase().endsWith("XD")) d.symbol = d.symbol.slice(0, -2);
    return NextResponse.json({ ...d, close: d.price, mode: "live" });
  } catch { return NextResponse.json({ error: "API failed" }, { status: 502 }); }
}
