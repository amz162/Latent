#!/usr/bin/env python3
"""Chunked bulk updater — runs the per-stock update in chunks of 100,
sequentially, with progress logging between chunks. Designed to avoid
the OOM and pipe-buffering issues that the bash wrapper hit.

Usage:
  python3 scripts/bulk_update_chunks.py
  python3 scripts/bulk_update_chunks.py --chunk-size 50
  python3 scripts/bulk_update_chunks.py --start-chunk 3
"""
import sys, os, time, subprocess, argparse
from datetime import datetime, timezone, timedelta

PKT = timezone(timedelta(hours=5))
LOG_DIR = "data"
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, f"bulk_update_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")

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

def count_fresh_csvs():
    """Count CSV files in data/ohlcv_all/ with last bar < 3 days old."""
    import csv
    now = datetime.now(PKT)
    fresh = stale = empty = total = 0
    for fname in os.listdir("data/ohlcv_all"):
        if not fname.endswith(".csv"): continue
        total += 1
        try:
            with open(f"data/ohlcv_all/{fname}") as f:
                rows = list(csv.DictReader(f))
            if not rows: continue
            last = rows[-1]
            ts = int(last.get("date", 0))
            dt = datetime.fromtimestamp(ts/1000, tz=PKT)
            age = (now - dt).total_seconds() / 86400
            close = last.get("close", "")
            if not close or close == "0":
                empty += 1
            elif age < 3:
                fresh += 1
            else:
                stale += 1
        except:
            pass
    return fresh, stale, empty, total

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chunk-size", type=int, default=100)
    ap.add_argument("--start-chunk", type=int, default=1, help="1-indexed chunk number to start from")
    args = ap.parse_args()

    TOTAL_STOCKS = 1048
    CHUNK_SIZE = args.chunk_size
    TOTAL_CHUNKS = (TOTAL_STOCKS + CHUNK_SIZE - 1) // CHUNK_SIZE

    log("=" * 60)
    log(f"PSX Bulk Update (chunked) — chunk size = {CHUNK_SIZE}")
    log(f"Total stocks: {TOTAL_STOCKS} → {TOTAL_CHUNKS} chunks")
    log(f"Log file: {LOG_FILE}")
    log(f"Start chunk: {args.start_chunk}")
    log(f"Memory: {mem_state()}")
    log("=" * 60)

    start_ts = time.time()
    total_updated = 0
    total_new_bars = 0

    for chunk_num in range(args.start_chunk, TOTAL_CHUNKS + 1):
        chunk_start = (chunk_num - 1) * CHUNK_SIZE + 1
        chunk_end = min(chunk_num * CHUNK_SIZE, TOTAL_STOCKS)

        log("")
        log(f"--- Chunk {chunk_num}/{TOTAL_CHUNKS}: stocks {chunk_start}-{chunk_end} ---")
        chunk_start_ts = time.time()

        # Run the per-stock updater for this chunk
        result = subprocess.run(
            ["python3", "-u", "scripts/update_daily_ohlcv.py",
             "--start", str(chunk_start), "--end", str(chunk_end)],
            capture_output=True, text=True, timeout=600,  # 10 min max per chunk
        )

        # Print summary lines (lines starting with "  Stocks" or "Total")
        summary_lines = [l for l in result.stdout.split("\n")
                        if l.startswith("  Stocks") or l.startswith("  Total") or l.startswith("  Timestamp")]
        for line in summary_lines:
            log(f"  {line.strip()}")

        # Count stocks updated + new bars from the output
        for line in result.stdout.split("\n"):
            if "Stocks updated:" in line:
                try:
                    n = int(line.split(":")[1].strip())
                    total_updated += n
                except: pass
            if "Total new bars added:" in line:
                try:
                    n = int(line.split(":")[1].strip())
                    total_new_bars += n
                except: pass

        chunk_duration = time.time() - chunk_start_ts
        log(f"Chunk {chunk_num} took {chunk_duration:.1f}s")
        log(f"Memory: {mem_state()}")

        # Progress so far
        elapsed = time.time() - start_ts
        log(f"  Running total: {total_updated} stocks updated, {total_new_bars} new bars, {elapsed:.0f}s elapsed")

        # Brief pause between chunks
        time.sleep(1)

    log("")
    log("=" * 60)
    log("=== BULK UPDATE COMPLETE ===")
    elapsed = time.time() - start_ts
    log(f"Total duration: {elapsed:.0f}s ({elapsed/60:.1f} min)")
    log(f"Total stocks with new bars: {total_updated}")
    log(f"Total new bars added: {total_new_bars}")
    log("")

    # Final freshness summary
    log("=== Freshness Summary ===")
    fresh, stale, empty, total = count_fresh_csvs()
    log(f"  Total CSV files: {total}")
    log(f"  FRESH (last bar < 3 days old): {fresh}")
    log(f"  STALE (last bar > 3 days old):  {stale}")
    log(f"  EMPTY/SUSPENDED (empty close): {empty}")
    log("=" * 60)

if __name__ == "__main__":
    main()
