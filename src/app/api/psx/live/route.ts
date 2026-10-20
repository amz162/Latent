import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

// Live price endpoint for market hours (9AM - 4:30PM Pakistan time)
// Fetches real-time price from askanalyst API

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") || "KSE100";
  
  // For KSE100 index, fetch the index data
  if (symbol === "KSE100") {
    try {
      const res = await fetch("https://api.askanalyst.com.pk/api/marketstats", {
        headers: { "User-Agent": "LatentBot/1.0" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Find KSE100 in the response
      const kse100 = Array.isArray(data) 
        ? data.find((d: any) => d.symbol === "KSE100" || d.SYMBOL === "KSE100")
        : data?.KSE100 || data;
      return NextResponse.json({ symbol: "KSE100", ...kse100, mode: "live", timestamp: new Date().toISOString() });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
  }

  // For individual stocks, fetch live OHLCV
  try {
    const apiUrl = `https://api.askanalyst.com.pk/api/technicalchart/day/0/${Date.now()}/${symbol}`;
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": "LatentBot/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    
    const lines = text.trim().split("\n");
    if (lines.length < 2) throw new Error("No data returned");
    
    const header = lines[0].split(",");
    const lastLine = lines[lines.length - 1].split(",");
    const prevLine = lines.length > 1 ? lines[lines.length - 2].split(",") : lastLine;
    
    const gi = (n: string) => header.findIndex(h => h.trim() === n);
    const gv = (n: string, line: string[]) => { const i = gi(n); return i >= 0 ? parseFloat(line[i]) || 0 : 0; };
    
    const close = gv("close", lastLine);
    const open = gv("open", lastLine);
    const high = gv("high", lastLine);
    const low = gv("low", lastLine);
    const volume = gv("volume", lastLine);
    const dateMs = gi("date") >= 0 ? parseInt(lastLine[gi("date")]) : 0;
    const prevClose = gv("close", prevLine);
    
    const change = close - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
    
    return NextResponse.json({
      symbol,
      close,
      open,
      high,
      low,
      volume,
      prevClose,
      change: parseFloat(change.toFixed(2)),
      changePct: parseFloat(changePct.toFixed(2)),
      date: dateMs,
      dateStr: dateMs ? new Date(dateMs).toISOString().split("T")[0] : "",
      mode: "live",
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message, symbol }, { status: 502 });
  }
}
