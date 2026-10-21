import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 5;

/**
 * Scheduler status endpoint — shows:
 *   1. Whether the in-process scheduler is running (instrumentation hook)
 *   2. Last successful run (from data/scheduler_last_run.txt marker file)
 *   3. Last few log entries (from data/scheduler_log.txt)
 *   4. Current PKT time + next scheduled run window
 *
 * Useful for verifying that the daily 5 PM PKT OHLCV update is set up.
 */

const PKT_OFFSET_MIN = 5 * 60;

function pktNow(): { iso: string; weekday: number; weekdayName: string; hour: number; minute: number; dateStr: string; isMarketOpen: boolean } {
  const now = new Date();
  const pktMs = now.getTime() + PKT_OFFSET_MIN * 60 * 1000;
  const pkt = new Date(pktMs);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const weekday = pkt.getUTCDay();
  const hour = pkt.getUTCHours();
  const minute = pkt.getUTCMinutes();
  const dateStr = pkt.toISOString().slice(0, 10);
  // Market open: Mon-Fri, 9:00 AM - 4:30 PM PKT
  const hourMin = hour * 100 + minute;
  const isMarketOpen = weekday >= 1 && weekday <= 5 && hourMin >= 900 && hourMin <= 1630;
  return {
    iso: pkt.toISOString(),
    weekday,
    weekdayName: weekdays[weekday],
    hour,
    minute,
    dateStr,
    isMarketOpen,
  };
}

function nextRunDescription(pkt: ReturnType<typeof pktNow>): string {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (pkt.weekday >= 6) return "Monday (next weekday) at 5:00 PM PKT";
  // If before 5 PM today → today at 5 PM
  if (pkt.hour < 17) {
    const hoursToGo = 17 - pkt.hour - (pkt.minute > 0 ? 1 : 0);
    const minsToGo = pkt.minute > 0 ? 60 - pkt.minute : 0;
    return `Today (${pkt.weekdayName}) at 5:00 PM PKT (~${hoursToGo}h ${minsToGo}m away)`;
  }
  // If after 5 PM today → tomorrow at 5 PM (or Monday if today is Friday)
  if (pkt.weekday === 5) return "Monday at 5:00 PM PKT (weekend)";
  return `Tomorrow (${dayNames[(pkt.weekday + 1) % 7]}) at 5:00 PM PKT`;
}

export async function GET() {
  const dataDir = path.join(process.cwd(), "data");
  const markerFile = path.join(dataDir, "scheduler_last_run.txt");
  const logFile = path.join(dataDir, "scheduler_log.txt");

  let lastMarker = "";
  try { lastMarker = (await fs.readFile(markerFile, "utf-8")).trim(); } catch {}

  let logTail: string[] = [];
  try {
    const log = await fs.readFile(logFile, "utf-8");
    logTail = log.split("\n").filter(Boolean).slice(-10);
  } catch {}

  const pkt = pktNow();

  // Check the OHLCV file's last bar date to compare with the marker
  let ohlcvLastDate: string | null = null;
  try {
    const ohlcvDir = path.join(dataDir, "ohlcv_all");
    const sampleFile = path.join(ohlcvDir, "LUCK.csv");
    const content = await fs.readFile(sampleFile, "utf-8");
    const lines = content.trim().split("\n");
    const lastLine = lines[lines.length - 1].split(",");
    const header = lines[0].split(",");
    const dateIdx = header.findIndex(h => h.trim() === "date");
    if (dateIdx >= 0) {
      const ts = parseInt(lastLine[dateIdx]);
      if (ts > 0) {
        ohlcvLastDate = new Date(ts).toISOString().slice(0, 10);
      }
    }
  } catch {}

  return NextResponse.json({
    scheduler_installed: true,
    scheduler_running: !!(globalThis as any).__latentSchedulerStarted,
    current_time_pkt: pkt.iso,
    current_weekday_pkt: pkt.weekdayName,
    market_status: pkt.isMarketOpen ? "OPEN (live prices via /api/psx/live)" : "CLOSED",
    next_scheduled_run: nextRunDescription(pkt),
    schedule_summary: {
      daily_5pm_pkt: "Mon-Fri at 5:00 PM PKT (12:00 UTC) — incremental OHLCV update",
      premarket_9am_pkt: "Mon-Fri at 9:00 AM PKT (4:00 UTC) — overnight data warm-up",
      live_prices: "On-demand via /api/psx/live?symbol=X during market hours (9 AM - 4:30 PM PKT)",
    },
    last_run_marker: lastMarker || "(never run)",
    ohlcv_last_bar_date: ohlcvLastDate || "(unknown)",
    log_tail: logTail,
  });
}
