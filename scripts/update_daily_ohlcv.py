#!/usr/bin/env python3
"""Daily incremental OHLCV updater for PSX stocks.

Uses psxdata API (https://psxdata-api.fastapicloud.dev) — the new primary
data source. psxdata has 1,048 stocks (vs 361 from askanalyst previously),
returns bars sorted NEWEST FIRST (we reverse to oldest-first for our CSV
format), and works for ENGRO (askanalyst has been broken for ENGRO for 348+ days).

Appends NEW daily candles to existing CSV files without modifying historical
data. Existing rows are never changed — only new bars are appended.

Usage:
  python scripts/update_daily_ohlcv.py              # update all stocks
  python scripts/update_daily_ohlcv.py --symbol ENGRO  # single stock
  python scripts/update_daily_ohlcv.py --full-refresh  # overwrite (re-download all)
"""
import json, time, sys, urllib.request, urllib.error, urllib.parse, csv, io
from pathlib import Path
from datetime import datetime, timezone, timedelta

OUT = Path("data/ohlcv_all")
OUT.mkdir(parents=True, exist_ok=True)

# Pakistan Standard Time = UTC+5
PKT = timezone(timedelta(hours=5))

# psxdata API base URL
PSXDATA_BASE = "https://psxdata-api.fastapicloud.dev"


def is_market_hours():
    """Check if current time is 9:00 AM - 4:30 PM Pakistan time (Mon-Fri)."""
    now_pkt = datetime.now(PKT)
    if now_pkt.weekday() >= 5:  # Sat/Sun
        return False
    hour_min = now_pkt.hour * 100 + now_pkt.minute
    return 900 <= hour_min <= 1630


def is_after_close():
    """Check if it's after 5:00 PM Pakistan time (daily fetch window)."""
    now_pkt = datetime.now(PKT)
    return now_pkt.hour >= 17  # 5 PM onwards


def fetch_json(path, timeout=30):
    """Fetch JSON from psxdata API. Returns the 'data' field directly."""
    url = f"{PSXDATA_BASE}{path}"
    req = urllib.request.Request(url, headers={"User-Agent": "LatentBot/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read().decode("utf-8")
    json_obj = json.loads(body)
    # psxdata wraps everything in { data: ..., meta: ... } — return data
    return json_obj.get("data") if isinstance(json_obj, dict) else json_obj


def fetch_all_symbols():
    """Fetch the list of all 1,048 PSX stock symbols from psxdata."""
    data = fetch_json("/stocks")
    if not isinstance(data, list):
        raise RuntimeError(f"Expected list of symbols, got: {type(data)}")
    return data


def fetch_historical(sym):
    """Fetch full OHLCV history for a symbol from psxdata.
    Returns list of bars sorted NEWEST FIRST (we'll reverse for our CSV).
    Each bar: { date, open, high, low, close, volume, is_anomaly }
    """
    path = f"/stocks/{urllib.parse.quote(sym)}/historical"
    data = fetch_json(path, timeout=60)
    if not isinstance(data, list):
        return []
    return data


def date_str_to_epoch_ms(date_str):
    """Convert 'YYYY-MM-DD' to epoch ms (UTC midnight — TZ-independent)."""
    try:
        yyyy, mm, dd = date_str.split("-")
        return Date_UTC_ms(int(yyyy), int(mm), int(dd))
    except Exception:
        return 0


def Date_UTC_ms(yyyy, mm, dd):
    """Compute epoch ms for a date at UTC midnight (no DST/timezone issues)."""
    # Python's datetime.timestamp() is affected by local TZ, so we compute manually.
    # Days since 1970-01-01 (epoch):
    # Use calendar.timegm to get the UTC timestamp.
    import calendar
    return calendar.timegm((yyyy, mm, dd, 0, 0, 0, 0, 0, 0)) * 1000


def append_new_bars(sym, full_refresh=False):
    """Fetch latest OHLCV from psxdata and append only NEW bars to existing CSV.
    Previous data is never modified — only new bars are appended.
    """
    p = OUT / f"{sym}.csv"

    # Read existing dates to know what we already have
    existing_dates = set()
    if p.exists() and not full_refresh:
        with open(p, "r") as f:
            content = f.read()
        lines = content.strip().split("\n")
        if len(lines) > 1:
            for line in lines[1:]:  # skip header
                parts = line.split(",")
                if len(parts) >= 6:
                    existing_dates.add(parts[0])

    # Fetch latest data from psxdata API
    try:
        bars = fetch_historical(sym)
    except Exception as e:
        return 0, f"fetch error: {e}"

    if not bars:
        return 0, "no data returned"

    # psxdata returns bars NEWEST FIRST — reverse to oldest-first (our CSV format)
    bars_oldest_first = list(reversed(bars))

    # Find bars not in existing data
    appended = 0
    new_lines = []
    for bar in bars_oldest_first:
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
        if full_refresh or not p.exists():
            # Full refresh: write all from API
            with open(p, "w") as f:
                f.write("date,open,high,low,close,volume\n")
                for line in new_lines:
                    f.write(line + "\n")
        else:
            # Incremental: keep existing + append new
            with open(p, "a") as f:
                for line in new_lines:
                    f.write(line + "\n")

    return appended, "OK"


def main():
    full_refresh = "--full-refresh" in sys.argv
    single_sym = None
    if "--symbol" in sys.argv:
        idx = sys.argv.index("--symbol")
        if idx + 1 < len(sys.argv):
            single_sym = sys.argv[idx + 1].upper()

    # NEW: chunking support — `--start N --end M` processes stocks at
    # indices N..M (1-based). Useful when running the full bulk update
    # keeps getting killed by OOM on memory-constrained systems. Split
    # the 1,048 stocks into chunks of ~100 and run them sequentially:
    #   python3 scripts/update_daily_ohlcv.py --start 1   --end 100
    #   python3 scripts/update_daily_ohlcv.py --start 101 --end 200
    #   ...
    chunk_start = None
    chunk_end = None
    if "--start" in sys.argv:
        idx = sys.argv.index("--start")
        if idx + 1 < len(sys.argv):
            chunk_start = int(sys.argv[idx + 1])
    if "--end" in sys.argv:
        idx = sys.argv.index("--end")
        if idx + 1 < len(sys.argv):
            chunk_end = int(sys.argv[idx + 1])

    now_pkt = datetime.now(PKT)
    print(f"=== PSX Daily OHLCV Update (psxdata source) ===")
    print(f"  Pakistan time: {now_pkt.strftime('%Y-%m-%d %H:%M %A')}")
    print(f"  Market hours (9AM-4:30PM): {is_market_hours()}")
    print(f"  After close (5PM+): {is_after_close()}")
    print(f"  Mode: {'full refresh' if full_refresh else 'incremental (append only)'}")
    print(f"  Single symbol: {single_sym or 'ALL'}")
    if chunk_start is not None or chunk_end is not None:
        print(f"  Chunk: {chunk_start or 1}..{chunk_end or 'end'}")
    print(f"  Source: {PSXDATA_BASE}")
    print()

    if single_sym:
        appended, status = append_new_bars(single_sym, full_refresh)
        print(f"  {single_sym}: {appended} new bars appended ({status})")
        return

    # Fetch all 1,048 stock symbols
    print("  Fetching stock list from psxdata...")
    try:
        symbols = fetch_all_symbols()
    except Exception as e:
        print(f"  ERROR fetching stock list: {e}")
        sys.exit(1)

    # Apply chunk slicing if --start/--end were provided
    if chunk_start is not None or chunk_end is not None:
        start_idx = (chunk_start or 1) - 1  # 0-based slice
        end_idx = chunk_end  # 0-based slice (exclusive)
        symbols = symbols[start_idx:end_idx]
        print(f"  Chunk sliced to: {len(symbols)} symbols")
    else:
        print(f"  Symbols: {len(symbols)}")
    print()

    success = 0
    failed = 0
    total_new_bars = 0
    skipped_no_data = 0

    for i, sym in enumerate(symbols, 1):
        if not sym:
            continue
        try:
            appended, status = append_new_bars(sym, full_refresh)
            if appended > 0:
                total_new_bars += appended
                success += 1
                # Print every 50th success + all stocks up to 10
                if i <= 10 or i % 50 == 0 or appended > 5:
                    print(f"  [{i}/{len(symbols)}] {sym}: +{appended} new bars")
            elif status == "OK":
                # No new bars (already up to date)
                pass
            elif "no data returned" in status or "fetch error" in status:
                skipped_no_data += 1
            # Rate limit — psxdata handles ~10 req/sec comfortably, but be gentle
            time.sleep(0.1)
        except Exception as e:
            failed += 1
            if i <= 20 or failed <= 5:
                print(f"  [{i}/{len(symbols)}] {sym}: FAILED - {e}")

    print()
    print(f"=== Update Complete ===")
    print(f"  Stocks updated: {success}")
    print(f"  Stocks failed: {failed}")
    print(f"  Stocks with no data (suspended?): {skipped_no_data}")
    print(f"  Total new bars added: {total_new_bars}")
    print(f"  Total CSV files: {len(list(OUT.glob('*.csv')))}")
    print(f"  Timestamp: {datetime.now(PKT).strftime('%Y-%m-%d %H:%M %Z')}")


if __name__ == "__main__":
    main()
