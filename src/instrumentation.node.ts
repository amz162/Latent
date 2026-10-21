/**
 * NEXT.JS INSTRUMENTATION HOOK (Node.js runtime only)
 *
 * Starts an in-process background scheduler that triggers the daily 5 PM PKT
 * incremental OHLCV update automatically. Uses `instrumentation.node.ts`
 * (Next.js 16 naming convention) so this file is ONLY compiled for the
 * Node.js runtime — it's NOT bundled into Edge runtime chunks (which is
 * what broke our previous attempt with `instrumentation.ts`).
 *
 * Schedule (Pakistan Standard Time = UTC+5):
 *   - 5:00 PM PKT (12:00 UTC) Mon-Fri → run daily_5pm_update.py
 *     (fetches only the last 7 days per stock, appends new bars only,
 *     processes in chunks of 100 stocks to keep memory low)
 *
 * The script is idempotent — it skips stocks that are already up-to-date
 * and only appends NEW daily bars. So if it runs twice in a day, the
 * second run is a no-op for stocks that already have today's bar.
 *
 * IMPORTANT: For serverless deployments (Vercel, etc.), this in-process
 * scheduler WILL NOT WORK because each request is a fresh process that
 * dies after responding. For production, set up an external cron:
 *
 *   # cron-job.org / GitHub Actions / Vercel Cron → hits this URL daily:
 *   curl https://your-domain.com/api/cron/update-data?mode=daily
 *
 * The /api/cron/update-data endpoint runs the same daily_5pm_update.py
 * script — so both approaches produce identical results.
 */

const G = globalThis as unknown as {
  __latentSchedulerStarted?: boolean;
  __latentSchedulerInterval?: NodeJS.Timeout;
};

export async function register() {
  // Only run on the server (not in edge / browser bundles)
  if (typeof window !== "undefined") return;
  if (G.__latentSchedulerStarted) {
    console.log("[latent-scheduler] already started — skipping");
    return;
  }
  G.__latentSchedulerStarted = true;

  // Use dynamic import + child_process (Node.js only — works because this
  // file is `instrumentation.node.ts`, never bundled for Edge runtime).
  const { execFile } = await import("child_process");
  const { promises: fs } = await import("fs");
  const path = await import("path");

  const PKT_OFFSET_MIN = 5 * 60; // PKT = UTC+5
  const DATA_DIR = path.join(process.cwd(), "data");
  const MARKER_FILE = path.join(DATA_DIR, "scheduler_last_run.txt");
  const LOG_FILE = path.join(DATA_DIR, "scheduler_log.txt");

  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch {}

  function pktNow(): { weekday: number; hour: number; minute: number; dateStr: string } {
    const now = new Date();
    const pktMs = now.getTime() + PKT_OFFSET_MIN * 60 * 1000;
    const pkt = new Date(pktMs);
    return {
      weekday: pkt.getUTCDay(), // 0=Sun..6=Sat
      hour: pkt.getUTCHours(),
      minute: pkt.getUTCMinutes(),
      dateStr: pkt.toISOString().slice(0, 10),
    };
  }

  function isWeekday(weekday: number): boolean {
    return weekday >= 1 && weekday <= 5; // Mon-Fri
  }

  async function readMarker(): Promise<string> {
    try {
      return (await fs.readFile(MARKER_FILE, "utf-8")).trim();
    } catch {
      return "";
    }
  }

  async function writeMarker(key: string, status: string): Promise<void> {
    const ts = new Date().toISOString();
    const line = `${key}|${status}|${ts}\n`;
    try { await fs.writeFile(MARKER_FILE, line, "utf-8"); } catch {}
    try {
      await fs.appendFile(LOG_FILE, `[${ts}] ${key} → ${status}\n`, "utf-8");
      // Keep log under 1MB
      try {
        const stat = await fs.stat(LOG_FILE);
        if (stat.size > 1_000_000) {
          const content = await fs.readFile(LOG_FILE, "utf-8");
          const lines = content.split("\n");
          await fs.writeFile(LOG_FILE, lines.slice(-5000).join("\n"), "utf-8");
        }
      } catch {}
    } catch {}
  }

  async function runDailyUpdate(job: "daily_5pm"): Promise<void> {
    const scriptPath = path.join(process.cwd(), "scripts", "daily_5pm_update.py");
    const startedAt = new Date().toISOString();
    console.log(`[latent-scheduler] ${job} starting → python3 ${scriptPath}`);
    try {
      // Run the Python script — chunked, incremental, fetches recent bars only.
      // 10-minute timeout (chunked update of 1,048 stocks with recent-only
      // fetch should take ~3-5 minutes).
      await new Promise<void>((resolve, reject) => {
        execFile("python3", ["-u", scriptPath], {
          timeout: 10 * 60 * 1000,
          maxBuffer: 10 * 1024 * 1024,
          cwd: process.cwd(),
        }, (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`${err.message} | stderr: ${(stderr || "").slice(-300)}`));
          } else {
            // Log the last 500 chars of stdout for visibility
            const tail = (stdout || "").slice(-500).replace(/\n/g, " | ");
            console.log(`[latent-scheduler] ${job} done — output tail: ${tail.slice(0, 200)}`);
            resolve();
          }
        });
      });
      await writeMarker(job, `success: completed at ${new Date().toISOString()}`);
    } catch (e: any) {
      const errMsg = (e.message || String(e)).slice(0, 500);
      await writeMarker(job, `error: ${errMsg}`);
      console.error(`[latent-scheduler] ${job} FAILED:`, errMsg);
    }
  }

  /**
   * Tick function — runs every minute. Triggers the daily update at 5 PM PKT
   * Mon-Fri if it hasn't already run today (per the marker file).
   */
  async function tick(): Promise<void> {
    const { weekday, hour, minute, dateStr } = pktNow();
    if (!isWeekday(weekday)) return; // skip weekends

    // Daily 5 PM PKT update window (17:00-17:04)
    if (hour === 17 && minute <= 4) {
      const marker = await readMarker();
      const markerDate = marker.split("|")[2]?.slice(0, 10) || "";
      if (markerDate === dateStr) {
        // Already ran today
        return;
      }
      await runDailyUpdate("daily_5pm");
    }
  }

  // Start the scheduler — check every 60 seconds
  console.log("[latent-scheduler] starting — daily OHLCV update at 5 PM PKT Mon-Fri");
  console.log("[latent-scheduler] uses /api/psx/live for real-time prices (on-demand)");
  console.log("[latent-scheduler] daily 5 PM: incremental recent-bars fetch (last 7 days)");
  G.__latentSchedulerInterval = setInterval(() => {
    tick().catch((e) => {
      console.error("[latent-scheduler] tick error:", e);
    });
  }, 60_000);

  // Run an immediate tick on startup (so we don't miss the window if the
  // server boots at 5:01 PM PKT — the 5-minute window might still be open)
  setTimeout(() => {
    tick().catch(() => {});
  }, 5_000);
}
