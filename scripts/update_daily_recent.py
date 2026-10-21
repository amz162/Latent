#!/usr/bin/env python3
"""Incremental daily updater — fetches only RECENT bars from psxdata
(last 7 days by default) instead of the full history. Much faster and
lighter than the full bulk updater.

Design:
  - For stocks WITHOUT a local CSV: fetch full history (one-time setup)
  - For stocks WITH a local CSV: fetch only the last N days (default 7)
    using psxdata's `?start=YYYY-MM-DD` parameter
  - Only NEW bars are appended (existing bars are never modified)

This is the script that should run automatically at 5 PM PKT daily to
keep the backup database fresh. The app uses live API data primarily;
this database is for backup / historical charting.

Usage:
  python3 scripts/update_daily_recent.py                    # all 1,048 stocks
  python3 scripts/update_daily_recent.py --symbol LUCK       # single stock
  python3 scripts/update_daily_recent.py --days 7           # last 7 days (default)
  python3 scripts/update_daily_recent.py --chunk-size 50     # chunked
  python3 scripts/update_daily_recent.py --start-chunk 5     # resume from chunk 5
"""
import json, time, sys, urllib.request, urllib.parse, csv, io, os, argparse
from pathlib import Path
from datetime import datetime, timezone, timedelta
import calendar

OUT = Path("data/ohlcv_all")
OUT.mkdir(parents=True, exist_ok=True)

PKT = timezone(timedelta(hours=5))
PSXDATA_BASE = "https://psxdata-api.fastapicloud.dev"


def fetch_json(path, timeout=30):
    url = f"{PSXDATA_BASE}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "LatentBot/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read().decode("utf-8")
    json_obj = json.loads(body)
    return json_obj.get("data") if isinstance(json_obj, dict) else json_obj


def fetch_all_symbols():
    data = fetch_json("/stocks")
    if not isinstance(data, list):
        raise RuntimeError(f"Expected list, got: {type(data)}")
    return data


def fetch_recent_bars(sym, days_back=7):
    """Fetch only the last N days of OHLCV bars from psxdata.
    Uses the ?start=YYYY-MM-DD query parameter.
    Returns bars sorted OLDEST FIRST (psxdata returns newest-first, we reverse).
    """
    end_date = datetime.now(PKT)
    start_date = end_date - timedelta(days=days_back)
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")
    path = f"/stocks/{urllib.parse.quote(sym)}/historical?start={start_str}&end={end_str}"
    data = fetch_json(path, timeout=30)
    if not isinstance(data, list):
        return []
    # psxdata returns bars newest-first — reverse for our CSV format (oldest-first)
    return list(reversed(data))


def fetch_full_history(sym):
    """Fetch the full OHLCV history (one-time setup for stocks without CSV)."""
    path = f"/stocks/{urllib.parse.quote(sym)}/historical"
    data = fetch_json(path, timeout=60)
    if not isinstance(data, list):
        return []
    return list(reversed(data))  # oldest-first


def date_str_to_epoch_ms(date_str):
    try:
        yyyy, mm, dd = date_str.split("-")
        return calendar.timegm((int(yyyy), int(mm), int(dd), 0, 0, 0, 0, 0, 0)) * 1000
    except Exception:
        return 0


def append_new_bars(sym, days_back=7, csv_exists=None):
    """Append only NEW bars to the stock's CSV.
    - If CSV doesn't exist → fetch full history (one-time setup)
    - If CSV exists → fetch only recent bars (last N days) — much faster
    """
    p = OUT / f"{sym}.csv"
    if csv_exists is None:
        csv_exists = p.exists()

    # Read existing dates
    existing_dates = set()
    if csv_exists:
        try:
            with open(p, "r") as f:
                content = f.read()
            lines = content.strip().split("\n")
            if len(lines) > 1:
                for line in lines[1:]:
                    parts = line.split(",")
                    if len(parts) >= 6:
                        existing_dates.add(parts[0])
        except Exception:
            pass

    # Fetch bars (recent only if CSV exists, else full history)
    try:
        if csv_exists:
            bars = fetch_recent_bars(sym, days_back=days_back)
            fetch_mode = "recent"
        else:
            bars = fetch_full_history(sym)
            fetch_mode = "full"
    except Exception as e:
        return 0, f"fetch error: {e}", "error"

    if not bars:
        return 0, "no data returned", fetch_mode

    # Append only NEW bars
    appended = 0
    new_lines = []
    for bar in bars:
        date_str = str(bar.get("date", ""))
        if not date_str:
            continue
        epoch_ms = date_str_to_epoch_ms(date_str)
        if epoch_ms == 0:
            continue
        date_key = str(epoch_ms)
        if date_key not in existing_dates:
            open_v = bar.get("open", 0) or 0
            high_v = bar.get("high", 0) or 0
            low_v = bar.get("low", 0) or 0
            close_v = bar.get("close", 0) or 0
            volume_v = bar.get("volume", 0) or 0
            new_lines.append(f"{epoch_ms},{open_v},{high_v},{low_v},{close_v},{volume_v}")
            existing_dates.add(date_key)
            appended += 1

    if appended > 0:
        if not csv_exists:
            # Create new CSV with header
            with open(p, "w") as f:
                f.write("date,open,high,low,close,volume\n")
                for line in new_lines:
                    f.write(line + "\n")
        else:
            # Append to existing CSV
            with open(p, "a") as f:
                for line in new_lines:
                    f.write(line + "\n")

    return appended, "OK", fetch_mode


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", type=str, help="Single stock symbol")
    ap.add_argument("--days", type=int, default=7, help="Days back for recent fetch (default 7)")
    ap.add_argument("--chunk-size", type=int, default=100, help="Stocks per chunk (default 100)")
    ap.add_argument("--start-chunk", type=int, default=1, help="Resume from chunk N")
    args = ap.parse_args()

    now_pkt = datetime.now(PKT)
    print(f"=== PSX Daily Recent Update (incremental) ===")
    print(f"  Pakistan time: {now_pkt.strftime('%Y-%m-%d %H:%M %A')}")
    print(f"  Recent days back: {args.days}")
    print(f"  Chunk size: {args.chunk_size} stocks")
    print(f"  Start chunk: {args.start_chunk}")
    print(f"  Source: {PSXDATA_BASE}")
    print()

    if args.symbol:
        sym = args.symbol.upper()
        appended, status, mode = append_new_bars(sym, days_back=args.days)
        print(f"  {sym}: +{appended} new bars ({status}, mode={mode})")
        return

    # Fetch all 1,048 stock symbols
    print("  Fetching stock list from psxdata...")
    try:
        symbols = fetch_all_symbols()
    except Exception as e:
        print(f"  ERROR fetching stock list: {e}")
        sys.exit(1)
    print(f"  Symbols: {len(symbols)}")

    # Apply chunk slicing
    TOTAL_STOCKS = len(symbols)
    TOTAL_CHUNKS = (TOTAL_STOCKS + args.chunk_size - 1) // args.chunk_size
    start_idx = (args.start_chunk - 1) * args.chunk_size
    end_idx = min(args.start_chunk * args.chunk_size, TOTAL_STOCKS)
    chunk_symbols = symbols[start_idx:end_idx]
    print(f"  Chunk {args.start_chunk}/{TOTAL_CHUNKS}: stocks {start_idx+1}-{end_idx} ({len(chunk_symbols)} symbols)")
    print()

    success = 0
    failed = 0
    total_new_bars = 0
    no_data = 0
    full_fetches = 0
    recent_fetches = 0

    for j, sym in enumerate(chunk_symbols, 1):
        if not sym:
            continue
        try:
            csv_path = OUT / f"{sym}.csv"
            csv_exists = csv_path.exists()
            appended, status, mode = append_new_bars(sym, days_back=args.days, csv_exists=csv_exists)
            if appended > 0:
                total_new_bars += appended
                success += 1
                if j <= 10 or appended > 5:
                    print(f"  [{start_idx+j}/{TOTAL_STOCKS}] {sym}: +{appended} new bars ({mode})")
            elif "no data" in status or "fetch error" in status:
                no_data += 1
            if mode == "full":
                full_fetches += 1
            elif mode == "recent":
                recent_fetches += 1
            time.sleep(0.05)  # gentle rate limit (psxdata handles 20 req/sec)
        except Exception as e:
            failed += 1
            if failed <= 5:
                print(f"  [{start_idx+j}/{TOTAL_STOCKS}] {sym}: FAILED - {e}")

    print()
    print(f"=== Chunk {args.start_chunk} Complete ===")
    print(f"  Stocks updated (new bars added): {success}")
    print(f"  Stocks with no data: {no_data}")
    print(f"  Stocks failed: {failed}")
    print(f"  Total new bars added: {total_new_bars}")
    print(f"  Full-history fetches (new CSVs created): {full_fetches}")
    print(f"  Recent-only fetches (existing CSVs updated): {recent_fetches}")
    print(f"  Total CSV files: {len(list(OUT.glob('*.csv')))}")
    print(f"  Timestamp: {datetime.now(PKT).strftime('%Y-%m-%d %H:%M %Z')}")


if __name__ == "__main__":
    main()
