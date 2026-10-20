import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Pakistan Standard Time = UTC+5
function isMarketOpen(): boolean {
  const now = new Date();
  const pktHour = (now.getUTCHours() + 5) % 24;
  const pktDay = new Date(now.getTime() + 5 * 3600 * 1000).getUTCDay();
  if (pktDay === 0 || pktDay === 6) return false; // Sun/Sat
  const hourMin = pktHour * 100 + now.getUTCMinutes();
  return hourMin >= 900 && hourMin <= 1630; // 9:00 AM - 4:30 PM PKT
}

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  const start = Date.now();
  const url = new URL(req.url);
  const useLive = url.searchParams.get("live") === "1";

  // Try local cache first
  for (const dir of ["data/ohlcv_all", "data/ohlcv"]) {
    try {
      const p = path.join(process.cwd(), dir, `${sym}.csv`);
      const text = await fs.readFile(p, "utf-8");
      const rows = text.trim().split("\n").slice(1).map(l => {
        const parts = l.split(",");
        return {
          date: parseInt(parts[0]),
          open: parseFloat(parts[1]),
          high: parseFloat(parts[2]),
          low: parseFloat(parts[3]),
          close: parseFloat(parts[4]),
          volume: parseFloat(parts[5]),
        };
      }).filter(r => !isNaN(r.date));

      if (rows.length > 0) {
        const lastDate = rows[rows.length - 1].date;
        const lastDateObj = new Date(lastDate);
        const daysOld = Math.floor((Date.now() - lastDate) / (24 * 60 * 60 * 1000));

        // If market is open AND data is stale (>1 day old), try to fetch live data
        if ((useLive || isMarketOpen()) && daysOld > 0) {
          try {
            const liveRes = await fetch(
              `https://api.askanalyst.com.pk/api/technicalchart/day/0/${Date.now()}/${sym}`,
              { headers: { "User-Agent": "LatentBot/1.0" }, signal: AbortSignal.timeout(5000) }
            );
            if (liveRes.ok) {
              const liveText = await liveRes.text();
              const liveLines = liveText.trim().split("\n").slice(1);
              // Find new bars not in existing data
              const existingDates = new Set(rows.map(r => r.date));
              let newBars = 0;
              for (const line of liveLines) {
                const parts = line.split(",");
                if (parts.length < 6) continue;
                const date = parseInt(parts[0]);
                if (!existingDates.has(date)) {
                  rows.push({
                    date,
                    open: parseFloat(parts[1]),
                    high: parseFloat(parts[2]),
                    low: parseFloat(parts[3]),
                    close: parseFloat(parts[4]),
                    volume: parseFloat(parts[5]),
                  });
                  newBars++;
                }
              }
              return NextResponse.json({
                symbol: sym,
                source: `local-cache + live (${newBars} new bars)`,
                rowsCount: rows.length,
                firstDate: rows[0].date,
                lastDate: rows[rows.length - 1].date,
                ohlcv: rows,
                latencyMs: Date.now() - start,
                cached: false,
                liveUpdate: true,
                newBars,
              });
            }
          } catch {}
        }

        return NextResponse.json({
          symbol: sym,
          source: `local-cache (${dir})`,
          rowsCount: rows.length,
          firstDate: rows[0].date,
          lastDate: rows[rows.length - 1].date,
          ohlcv: rows,
          latencyMs: Date.now() - start,
          cached: true,
        });
      }
    } catch {}
  }

  // Fallback: fetch from askanalyst API directly
  try {
    const TO = Date.now();
    const FROM = TO - 10 * 365 * 24 * 60 * 60 * 1000;
    const r = await fetch(
      `https://api.askanalyst.com.pk/api/technicalchart/day/${FROM}/${TO}/${sym}`,
      { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) }
    );
    if (r.ok) {
      const text = await r.text();
      const rows = text.trim().split("\n").slice(1).map(l => {
        const parts = l.split(",");
        return {
          date: parseInt(parts[0]),
          open: parseFloat(parts[1]),
          high: parseFloat(parts[2]),
          low: parseFloat(parts[3]),
          close: parseFloat(parts[4]),
          volume: parseFloat(parts[5]),
        };
      }).filter(x => !isNaN(x.date));
      if (rows.length > 0) {
        return NextResponse.json({
          symbol: sym,
          source: "askanalyst.com.pk",
          rowsCount: rows.length,
          firstDate: rows[0].date,
          lastDate: rows[rows.length - 1].date,
          ohlcv: rows,
          latencyMs: Date.now() - start,
          cached: false,
        });
      }
    }
  } catch {}

  return NextResponse.json({ error: `No OHLCV data for ${sym}`, symbol: sym }, { status: 404 });
}
