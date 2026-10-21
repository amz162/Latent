#!/usr/bin/env python3
"""Single-process chunked bulk updater — runs all chunks in ONE Python
process (no subprocess calls). This avoids any subprocess overhead and
ensures the script keeps running even if some chunks return no-data stocks
(like the PIB/TFC bonds around positions 201-300).

Usage:
  python3 scripts/bulk_update_single.py
  python3 scripts/bulk_update_single.py --chunk-size 50 --start-chunk 5
"""
import sys, os, time, argparse
from datetime import datetime, timezone, timedelta

# Add scripts dir to path so we can import the bulk updater module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import update_daily_ohlcv as updater

PKT = timezone(timedelta(hours=5))
LOG_DIR = "data"
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE = os.path.join(LOG_DIR, f"bulk_update_single_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")

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
        except: pass
    return fresh, stale, empty, total

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--chunk-size", type=int, default=100)
    ap.add_argument("--start-chunk", type=int, default=1)
    args = ap.parse_args()

    TOTAL_STOCKS = 1048
    CHUNK_SIZE = args.chunk_size
    TOTAL_CHUNKS = (TOTAL_STOCKS + CHUNK_SIZE - 1) // CHUNK_SIZE

    log("=" * 60)
    log(f"PSX Bulk Update (single-process, chunked)")
    log(f"Chunk size: {CHUNK_SIZE} stocks")
    log(f"Total stocks: {TOTAL_STOCKS} → {TOTAL_CHUNKS} chunks")
    log(f"Log file: {LOG_FILE}")
    log(f"Start chunk: {args.start_chunk}")
    log(f"Memory: {mem_state()}")
    log("=" * 60)

    # Fetch all symbols ONCE (much faster than fetching per chunk)
    log("Fetching stock list from psxdata...")
    try:
        all_symbols = updater.fetch_all_symbols()
    except Exception as e:
        log(f"ERROR fetching stock list: {e}")
        sys.exit(1)
    log(f"Got {len(all_symbols)} stocks")

    start_ts = time.time()
    total_updated = 0
    total_new_bars = 0
    total_no_data = 0
    total_failed = 0

    for chunk_num in range(args.start_chunk, TOTAL_CHUNKS + 1):
        chunk_start = (chunk_num - 1) * CHUNK_SIZE
        chunk_end = min(chunk_num * CHUNK_SIZE, TOTAL_STOCKS)
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
                appended, status = updater.append_new_bars(sym, full_refresh=False)
                if appended > 0:
                    chunk_new_bars += appended
                    chunk_updated += 1
                    # Print first/last stock in chunk + stocks with >5 bars
                    if j == 1 or j == len(chunk_symbols) or appended > 5:
                        log(f"  [{chunk_start+j}/{TOTAL_STOCKS}] {sym}: +{appended} new bars")
                elif status == "OK":
                    pass  # up-to-date
                elif "no data" in status or "fetch error" in status:
                    chunk_no_data += 1
                time.sleep(0.1)  # gentle rate limit
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
    log("=== BULK UPDATE COMPLETE ===")
    elapsed = time.time() - start_ts
    log(f"Total duration: {elapsed:.0f}s ({elapsed/60:.1f} min)")
    log(f"Total stocks updated (new bars added): {total_updated}")
    log(f"Total new bars added: {total_new_bars}")
    log(f"Total stocks with no data (suspended/bonds): {total_no_data}")
    log(f"Total stocks failed: {total_failed}")
    log("")
    log("=== Freshness Summary ===")
    fresh, stale, empty, total = count_fresh_csvs()
    log(f"  Total CSV files: {total}")
    log(f"  FRESH (< 3 days old): {fresh}")
    log(f"  STALE (> 3 days old): {stale}")
    log(f"  EMPTY/SUSPENDED (empty close): {empty}")
    log("=" * 60)

if __name__ == "__main__":
    main()
