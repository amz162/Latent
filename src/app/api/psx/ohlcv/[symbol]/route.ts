import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getHistorical } from "@/lib/latent/psxdata";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * OHLCV endpoint — now backed by psxdata (https://psxdata-api.fastapicloud.dev)
 * REPLACED askanalyst which had only 361 stocks and was broken for ENGRO.
 *
 * psxdata returns bars sorted NEWEST FIRST (date 2026-10-20 at index 0).
 * We convert to oldest-first (matching our local CSV format) and convert
 * the ISO date strings to epoch ms (for backwards compatibility with the
 * existing CSV format and Chart.js consumption).
 *
 * Strategy:
 *   1. Read local CSV first (fastest, no network call) — return if it
 *      has data and the last bar is recent (< 1 day old).
 *   2. Otherwise, fetch fresh history from psxdata and return it.
 *      (Also append the new bars to the local CSV for next time.)
 *   3. As a final fallback, return whatever local CSV has (even if stale)
 *      so the chart doesn't go blank.
 */

function dateStrToEpochMs(dateStr: string): number {
  // psxdata returns dates like "2026-10-20" — convert to epoch ms (PKT midnight).
  // Use Date.UTC to get a deterministic timestamp that's TZ-independent.
  const [yyyy, mm, dd] = dateStr.split("-").map(Number);
  if (!yyyy || !mm || !dd) return 0;
  return Date.UTC(yyyy, mm - 1, dd); // 2026-10-20 → epoch ms at 00:00 UTC
}

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = symbol.toUpperCase();
  const start = Date.now();
  const url = new URL(req.url);
  const forceFresh = url.searchParams.get("live") === "1";

  // ─── 1. Try local CSV cache first ───
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
        const daysOld = Math.floor((Date.now() - lastDate) / (24 * 60 * 60 * 1000));

        // If CSV is fresh (< 1 day old) or we're not forcing a fresh fetch,
        // return the cached data immediately.
        if (!forceFresh && daysOld < 1) {
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
        // Otherwise fall through to psxdata fetch + append new bars.
        break;
      }
    } catch {
      // CSV doesn't exist or couldn't be parsed — try next dir
    }
  }

  // ─── 2. Fetch fresh history from psxdata ───
  try {
    const bars = await getHistorical(sym);
    if (bars && bars.length > 0) {
      // psxdata returns bars newest-first; convert to oldest-first for our format.
      const rows = bars.slice().reverse().map(b => ({
        date: dateStrToEpochMs(b.date),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })).filter(r => !isNaN(r.date) && r.date > 0);

      if (rows.length > 0) {
        // Persist to local CSV for future fast lookups (append-only — preserve
        // any existing rows, add only new dates).
        try {
          const csvPath = path.join(process.cwd(), "data", "ohlcv_all", `${sym}.csv`);
          await fs.mkdir(path.dirname(csvPath), { recursive: true });
          let existingDates = new Set<string>();
          let existingLines: string[] = [];
          try {
            const existingText = await fs.readFile(csvPath, "utf-8");
            existingLines = existingText.trim().split("\n").slice(1);
            for (const line of existingLines) {
              const parts = line.split(",");
              if (parts.length >= 6) existingDates.add(parts[0]);
            }
          } catch {
            // file doesn't exist — start fresh
          }
          const header = "date,open,high,low,close,volume\n";
          const newLines: string[] = [];
          for (const r of rows) {
            const dateStr = String(r.date);
            if (!existingDates.has(dateStr)) {
              newLines.push(`${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume}`);
              existingDates.add(dateStr);
            }
          }
          if (newLines.length > 0) {
            if (existingLines.length === 0) {
              await fs.writeFile(csvPath, header + newLines.join("\n") + "\n", "utf-8");
            } else {
              await fs.appendFile(csvPath, newLines.join("\n") + "\n", "utf-8");
            }
          }
        } catch (e) {
          // CSV write failed — don't fail the request, just log
          console.warn(`[/api/psx/ohlcv] CSV persist failed for ${sym}:`, e);
        }

        return NextResponse.json({
          symbol: sym,
          source: "psxdata-api.fastapicloud.dev",
          rowsCount: rows.length,
          firstDate: rows[0].date,
          lastDate: rows[rows.length - 1].date,
          ohlcv: rows,
          latencyMs: Date.now() - start,
          cached: false,
        });
      }
    }
  } catch (e: any) {
    // psxdata fetch failed — fall through to stale CSV return below
    console.warn(`[/api/psx/ohlcv] psxdata fetch failed for ${sym}:`, e.message);
  }

  // ─── 3. Final fallback: return stale CSV if we have one ───
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
        return NextResponse.json({
          symbol: sym,
          source: `local-cache-fallback (${dir}) — psxdata unavailable`,
          rowsCount: rows.length,
          firstDate: rows[0].date,
          lastDate: rows[rows.length - 1].date,
          ohlcv: rows,
          latencyMs: Date.now() - start,
          cached: true,
          stale: true,
        });
      }
    } catch {}
  }

  return NextResponse.json({ error: `No OHLCV data for ${sym}`, symbol: sym }, { status: 404 });
}
