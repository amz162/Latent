import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const r = await fetch("https://psxdata-api.fastapicloud.dev/stocks", { headers: { "User-Agent": "LatentBot/1.0" } });
    const j = await r.json();
    const stocks = j.data || j || [];
    return NextResponse.json({ companies: stocks, count: stocks.length });
  } catch { return NextResponse.json({ companies: [], count: 0 }, { status: 502 }); }
}
