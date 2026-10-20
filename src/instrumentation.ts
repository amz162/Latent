/**
 * Next.js instrumentation hook — runs ONCE when the server starts up.
 *
 * This file starts an IN-PROCESS background scheduler that:
 *   1. At 5:00 PM PKT (12:00 UTC) Mon–Fri → runs `update_daily_ohlcv.py`
 *      which appends new daily OHLCV bars to every stock's CSV file in
 *      /data/ohlcv_all/. Existing bars are NEVER modified — only new bars
 *      are appended (incremental update).
 *   2. At 9:00 AM PKT (4:00 UTC) Mon–Fri → runs the same script in
 *      pre-market warm-up mode to fetch any overnight data that landed
 *      before market open.
 *
 * The scheduler is idempotent — it uses a marker file
 * (data/scheduler_last_run.txt) to remember the last successful run date,
 * so multiple server instances won't all try to update at the same minute
 * and we won't re-run the same day's update twice.
 *
 * For serverless deployments (Vercel etc.), this in-process scheduler
 * WILL NOT WORK because each request is a fresh process. In that case,
 * set up an external cron (cron-job.org, GitHub Actions, Vercel Cron)
 * that hits:  GET /api/cron/update-data?mode=daily
 * at 5 PM PKT = 12:00 UTC daily.
 *
 * Live prices (9 AM – 4:30 PM PKT during market hours) are fetched
 * ON-DEMAND by the UI via /api/psx/live?symbol=X — no scheduler needed
 * for that.
 */

// Global guard prevents multiple intervals if the server module re-loads
// during HMR in dev mode.
const G = globalThis as unknown as {
  __latentSchedulerStarted?: boolean;
  __latentSchedulerInterval?: NodeJS.Timeout;
};

export async function register() {
  // Only run on the server (not in edge / browser bundles)
  if (typeof window !== "undefined") return;
  if (G.__latentSchedulerStarted) {
    console.log("[latent-scheduler] already started — skipping re-registration");
    return;
  }
  G.__latentSchedulerStarted = true;

  // Dynamically import so this doesn't get bundled into the browser build
  const { promises: fs, existsSync, mkdirSync } = await import("fs");
  const path = (await import("path")).default;
  const { execSync } = await import("child_process");

  const PKT_OFFSET_MIN = 5 * 60; // PKT = UTC+5
  const DATA_DIR = path.join(process.cwd(), "data");
  const MARKER_FILE = path.join(DATA_DIR, "scheduler_last_run.txt");
  const LOG_FILE = path.join(DATA_DIR, "scheduler_log.txt");

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  function pktNow(): { date: Date; weekday: number; hour: number; minute: number; dateStr: string } {
    const now = new Date();
    // Convert to PKT (UTC+5)
    const pktMs = now.getTime() + PKT_OFFSET_MIN * 60 * 1000;
    const pkt = new Date(pktMs);
    // weekday: 0=Sun, 6=Sat (Date.getDay())
    const weekday = pkt.getUTCDay();
    const hour = pkt.getUTCHours();
    const minute = pkt.getUTCMinutes();
    const dateStr = pkt.toISOString().slice(0, 10); // YYYY-MM-DD (PKT)
    return { date: pkt, weekday, hour, minute, dateStr };
  }

  function isWeekday(weekday: number): boolean {
    return weekday >= 1 && weekday <= 5; // Mon=1 .. Fri=5
  }

  async function readMarker(): Promise<string> {
    try {
      const content = await fs.readFile(MARKER_FILE, "utf-8");
      return content.trim();
    } catch {
      return "";
    }
  }

  async function writeMarker(key: string, status: string): Promise<void> {
    const ts = new Date().toISOString();
    const line = `${key}|${status}|${ts}\n`;
    await fs.writeFile(MARKER_FILE, line, "utf-8");
    // Also append to the rolling log file
    try {
      const logLine = `[${ts}] ${key} → ${status}\n`;
      await fs.appendFile(LOG_FILE, logLine, "utf-8");
      // Keep log file under 1MB
      try {
        const stat = await fs.stat(LOG_FILE);
        if (stat.size > 1_000_000) {
          const content = await fs.readFile(LOG_FILE, "utf-8");
          const lines = content.split("\n");
          const keep = lines.slice(-5000).join("\n");
          await fs.writeFile(LOG_FILE, keep, "utf-8");
        }
      } catch {}
    } catch {}
  }

  async function runUpdate(job: "daily_5pm" | "premarket_9am", fullRefresh: boolean = false): Promise<void> {
    const scriptPath = path.join(process.cwd(), "scripts", "update_daily_ohlcv.py");
    const args = fullRefresh ? "--full-refresh" : "";
    const cmd = `python3 ${scriptPath}${args ? " " + args : ""}`;
    const startedAt = new Date().toISOString();
    console.log(`[latent-scheduler] ${job} starting → ${cmd}`);
    try {
      const output = execSync(cmd, {
        timeout: 600_000, // 10 min max
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf-8",
      });
      const tail = output.slice(-500);
      await writeMarker(job, `success: ${tail.replace(/\n/g, " | ")}`);
      console.log(`[latent-scheduler] ${job} done — output tail: ${tail.slice(0, 200)}`);
    } catch (e: any) {
      const errMsg = e.message || String(e);
      await writeMarker(job, `error: ${errMsg.slice(0, 500)}`);
      console.error(`[latent-scheduler] ${job} FAILED:`, errMsg);
    }
  }

  /**
   * Tick function — runs every minute. Decides if it's time to trigger
   * a daily update based on PKT time + marker file state.
   *
   * Triggers:
   *   - daily_5pm: 17:00–17:04 PKT, Mon–Fri, if not already run today
   *   - premarket_9am: 09:00–09:04 PKT, Mon–Fri, if not already run today
   *     (pre-market warm-up — fetches any overnight data that landed
   *     before market open)
   */
  async function tick(): Promise<void> {
    const { weekday, hour, minute, dateStr } = pktNow();
    if (!isWeekday(weekday)) return; // skip weekends

    const marker = await readMarker();
    // marker format: "<job>|<status>|<ISO timestamp>"
    const markerParts = marker.split("|");
    const lastJobKey = markerParts[0];
    const lastDateStr = markerParts[2] ? markerParts[2].slice(0, 10) : "";

    // Daily 5 PM update window
    if (hour === 17 && minute <= 4) {
      const todayKey = `daily_5pm_${dateStr}`;
      if (lastJobKey === `daily_5pm_${lastDateStr}` && lastDateStr === dateStr) {
        // Already ran today — skip
        return;
      }
      await runUpdate("daily_5pm", false);
    }
    // Pre-market 9 AM warm-up window
    else if (hour === 9 && minute <= 4) {
      const todayKey = `premarket_9am_${dateStr}`;
      if (lastJobKey === `premarket_9am_${lastDateStr}` && lastDateStr === dateStr) {
        return;
      }
      // Only run pre-market if not already done today (even by daily 5pm)
      if (lastDateStr === dateStr) return;
      await runUpdate("premarket_9am", false);
    }
  }

  // Start the scheduler — check every 60 seconds
  console.log("[latent-scheduler] starting — will run daily OHLCV update at 5 PM PKT Mon–Fri");
  console.log("[latent-scheduler] live prices during 9 AM–4:30 PM PKT handled on-demand by /api/psx/live");
  G.__latentSchedulerInterval = setInterval(() => {
    tick().catch((e) => {
      console.error("[latent-scheduler] tick error:", e);
    });
  }, 60_000);

  // Run an immediate tick on startup so we don't miss the window if the
  // server boots at 5:01 PM PKT (the 5-minute window might still be open).
  setTimeout(() => {
    tick().catch(() => {});
  }, 5_000);
}
