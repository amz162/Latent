#!/usr/bin/env python3
"""Daily 5 PM PKT incremental updater — runs update_daily_recent.py in
chunks of N stocks to save memory. Designed to be called by the in-process
scheduler (instrumentation.node.ts) OR an external cron service.

Usage:
  python3 scripts/daily_5pm_update.py
  python3 scripts/daily_5pm_update.py --chunk-size 50
  python3 scripts/daily_5pm_update.py --start-chunk 3  # resume from chunk 3

The script:
  1. Fetches the 1,048-stock list from psxdata (one call)
  2. For each chunk of N stocks:
     - For each stock in the chunk, calls update_daily_recent's append_new_bars
     - If CSV exists → fetches only last 7 days (FAST)
     - If CSV doesn't exist → fetches full history (one-time setup, slower)
     - Appends only NEW bars (existing data never modified)
  3. Logs progress + memory state between chunks
  4. Can be safely killed and resumed from any chunk via --start-chunk
"""
import sys, os, time, argparse
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Add scripts dir to path so we can import update_daily_recent as a module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import update_daily_recent as updater

PKT = timezone(timedelta(hours=5))
LOG_DIR = Path("data")
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / f"daily_update_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"

def log(msg):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")
        f.flush()

def mem_state():
    try:
        with open("/proc/meminfo") as f:
            mem = {}
            for line in f:
                parts = line.split()
                if len(parts) >= 2:
                    mem[parts[0].rstrip(":")] = int(parts[1])
        used_mb = (mem.get("MemTotal", 0) - mem.get("MemAvailable", 0)) // 1024
        avail_mb = mem.get("MemAvailable", 0) // 1024
        return f"{used_mb}MB used / {avail_mb}MB available"
    except:
        return "(meminfo unavailable)"

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chunk-size", type=int, default=100)
    ap.add_argument("--start-chunk", type=int, default=1)
    ap.add_argument("--days", type=int, default=7, help="Days back for recent fetch (default 7)")
    args = ap.parse_args()

    log("=" * 60)
    log(f"Daily 5PM Update (incremental, chunked)")
    log(f"Chunk size: {args.chunk_size} stocks")
    log(f"Days back (recent fetch): {args.days}")
    log(f"Start chunk: {args.start_chunk}")
    log(f"Memory: {mem_state()}")
    log("=" * 60)

    # Fetch all symbols ONCE (much faster than per-chunk)
    log("Fetching stock list from psxdata...")
    try:
        all_symbols = updater.fetch_all_symbols()
    except Exception as e:
        log(f"ERROR fetching stock list: {e}")
        sys.exit(1)
    log(f"Got {len(all_symbols)} stocks")

    TOTAL_STOCKS = len(all_symbols)
    TOTAL_CHUNKS = (TOTAL_STOCKS + args.chunk_size - 1) // args.chunk_size

    start_ts = time.time()
    total_updated = 0
    total_new_bars = 0
    total_no_data = 0
    total_failed = 0

    for chunk_num in range(args.start_chunk, TOTAL_CHUNKS + 1):
        chunk_start = (chunk_num - 1) * args.chunk_size
        chunk_end = min(chunk_num * args.chunk_size, TOTAL_STOCKS)
        chunk_symbols = all_symbols[chunk_start:chunk_end]

        log("")
        log(f"--- Chunk {chunk_num}/{TOTAL_CHUNKS}: stocks {chunk_start+1}-{chunk_end} ({len(chunk_symbols)} symbols) ---")
        chunk_start_ts = time.time()

        chunk_updated = 0
        chunk_new_bars = 0
        chunk_no_data = 0
        chunk_failed = 0

        for j, sym in enumerate(chunk_symbols, 1):
            if not sym:
                continue
            try:
                csv_path = updater.OUT / f"{sym}.csv"
                csv_exists = csv_path.exists()
                appended, status, mode = updater.append_new_bars(
                    sym, days_back=args.days, csv_exists=csv_exists
                )
                if appended > 0:
                    chunk_new_bars += appended
                    chunk_updated += 1
                    if j == 1 or j == len(chunk_symbols) or appended > 5:
                        log(f"  [{chunk_start+j}/{TOTAL_STOCKS}] {sym}: +{appended} new bars ({mode})")
                elif "no data" in status or "fetch error" in status:
                    chunk_no_data += 1
                # Gentle rate limit
                time.sleep(0.05)
            except Exception as e:
                chunk_failed += 1
                if chunk_failed <= 3:
                    log(f"  [{chunk_start+j}/{TOTAL_STOCKS}] {sym}: FAILED - {e}")

        chunk_duration = time.time() - chunk_start_ts
        total_updated += chunk_updated
        total_new_bars += chunk_new_bars
        total_no_data += chunk_no_data
        total_failed += chunk_failed

        log(f"Chunk {chunk_num} done in {chunk_duration:.1f}s — "
            f"+{chunk_new_bars} new bars / {chunk_updated} updated / "
            f"{chunk_no_data} no-data / {chunk_failed} failed")
        log(f"Memory: {mem_state()}")
        elapsed = time.time() - start_ts
        log(f"Running total: {total_updated} stocks updated, "
            f"{total_new_bars} new bars, {elapsed:.0f}s elapsed")

        # Brief pause between chunks
        time.sleep(1)

    log("")
    log("=" * 60)
    log("=== DAILY UPDATE COMPLETE ===")
    elapsed = time.time() - start_ts
    log(f"Total duration: {elapsed:.0f}s ({elapsed/60:.1f} min)")
    log(f"Total stocks updated (new bars): {total_updated}")
    log(f"Total new bars added: {total_new_bars}")
    log(f"Total stocks with no data (TFCs/bonds): {total_no_data}")
    log(f"Total stocks failed: {total_failed}")
    log("=" * 60)

if __name__ == "__main__":
    main()
