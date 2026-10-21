import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { execSync } from "child_process";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "daily";
  const symbol = url.searchParams.get("symbol") || "";

  if (mode === "live") {
    if (!symbol) return NextResponse.json({ error: "Symbol required for live mode" }, { status: 400 });
    try {
      const price = await fetchLivePrice(symbol);
      return NextResponse.json({ symbol, ...price, mode: "live", timestamp: new Date().toISOString() });
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
  }

  // Daily mode: run the update script
  try {
    const scriptPath = path.join(process.cwd(), "scripts", "update_daily_ohlcv.py");
    const cmd = symbol ? `python3 ${scriptPath} --symbol ${symbol}` : `python3 ${scriptPath}`;
    const output = execSync(cmd, { timeout: 240000, maxBuffer: 1024 * 1024 * 10, encoding: "utf-8" });
    const ohlcvDir = path.join(process.cwd(), "data", "ohlcv_all");
    let totalStocks = 0;
    try { const files = await fs.readdir(ohlcvDir); totalStocks = files.filter(f => f.endsWith(".csv")).length; } catch {}
    return NextResponse.json({ mode: "daily", status: "success", timestamp: new Date().toISOString(), totalStocks, output: output.slice(-500) });
  } catch (e: any) {
    return NextResponse.json({ mode: "daily", status: "error", error: e.message }, { status: 500 });
  }
}

async function fetchLivePrice(symbol: string) {
  const url = `https://api.askanalyst.com.pk/api/technicalchart/day/0/${Date.now()}/${symbol}`;
  const res = await fetch(url, { headers: { "User-Agent": "LatentBot/1.0" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2) throw new Error("No data");
  const lastLine = lines[lines.length - 1].split(",");
  const header = lines[0].split(",");
  const gi = (n: string) => header.findIndex(h => h.trim() === n);
  const gv = (n: string) => { const i = gi(n); return i >= 0 ? parseFloat(lastLine[i]) || 0 : 0; };
  const close = gv("close"), open = gv("open"), high = gv("high"), low = gv("low"), volume = gv("volume");
  const dateMs = gi("date") >= 0 ? parseInt(lastLine[gi("date")]) : 0;
  return { close, open, high, low, volume, date: dateMs, dateStr: dateMs ? new Date(dateMs).toISOString().split("T")[0] : "", change: close && open ? ((close - open) / open * 100).toFixed(2) : "0", changePct: close && open ? (close - open) / open * 100 : 0 };
}
