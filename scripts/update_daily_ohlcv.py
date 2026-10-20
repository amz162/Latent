#!/usr/bin/env python3
"""Daily incremental OHLCV updater for PSX stocks.

Appends NEW daily candles to existing CSV files without modifying
historical data. Existing rows are never changed — only new bars
are appended.

Usage:
  python scripts/update_daily_ohlcv.py              # update all stocks
  python scripts/update_daily_ohlcv.py --symbol ENGRO  # single stock
  python scripts/update_daily_ohlcv.py --full-refresh  # full re-download
"""
import json, time, sys, urllib.request, urllib.error, csv, io
from pathlib import Path
from datetime import datetime, timezone, timedelta

OUT = Path("data/ohlcv_all")
OUT.mkdir(parents=True, exist_ok=True)

# Pakistan Standard Time = UTC+5
PKT = timezone(timedelta(hours=5))

def is_market_hours():
    """Check if current time is 9:00 AM - 4:30 PM Pakistan time (Mon-Fri)."""
    now_pkt = datetime.now(PKT)
    # Monday=0, Sunday=6
    if now_pkt.weekday() >= 5:  # Sat/Sun
        return False
    hour_min = now_pkt.hour * 100 + now_pkt.minute
    return 900 <= hour_min <= 1630

def is_after_close():
    """Check if it's after 5:00 PM Pakistan time (daily fetch window)."""
    now_pkt = datetime.now(PKT)
    return now_pkt.hour >= 17  # 5 PM onwards

def fetch_companies():
    req = urllib.request.Request(
        "https://api.askanalyst.com.pk/api/companylistwithsymbols",
        headers={"User-Agent": "Mozilla/5.0"}
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

def fetch_ohlcv_raw(sym):
    """Fetch OHLCV from askanalyst API."""
    url = f"https://api.askanalyst.com.pk/api/technicalchart/day/0/{int(time.time()*1000)}/{sym}"
    req = urllib.request.Request(url, headers={"User-Agent": "LatentBot/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")

def parse_csv_rows(raw_csv):
    """Parse CSV text into list of dicts with date, open, high, low, close, volume."""
    reader = csv.DictReader(io.StringIO(raw_csv))
    rows = []
    for r in reader:
        try:
            row = {
                "date": r.get("date", ""),
                "open": r.get("open", "0"),
                "high": r.get("high", "0"),
                "low": r.get("low", "0"),
                "close": r.get("close", "0"),
                "volume": r.get("volume", "0"),
            }
            rows.append(row)
        except Exception:
            continue
    return rows

def append_new_bars(sym, full_refresh=False):
    """Fetch latest OHLCV and append only NEW bars to existing CSV.
    Previous data is never modified — only new bars are appended.
    """
    p = OUT / f"{sym}.csv"
    
    # Read existing dates to know what we already have
    existing_dates = set()
    existing_rows = []
    header = "date,open,high,low,close,volume\n"
    if p.exists() and not full_refresh:
        with open(p, "r") as f:
            content = f.read()
        lines = content.strip().split("\n")
        if lines:
            header = lines[0] + "\n"
            for line in lines[1:]:
                parts = line.split(",")
                if len(parts) >= 6:
                    existing_dates.add(parts[0])
                    existing_rows.append(line)
    
    # Fetch latest data from API
    try:
        raw = fetch_ohlcv_raw(sym)
    except Exception as e:
        return 0, f"fetch error: {e}"
    
    new_rows = parse_csv_rows(raw)
    if not new_rows:
        return 0, "no data returned"
    
    # Find bars not in existing data
    appended = 0
    new_lines = []
    for row in new_rows:
        date_str = str(row["date"])
        if date_str not in existing_dates:
            # New bar — append it
            line = f"{row['date']},{row['open']},{row['high']},{row['low']},{row['close']},{row['volume']}"
            new_lines.append(line)
            existing_dates.add(date_str)
            appended += 1
    
    if appended > 0:
        # Write: keep existing data + append new
        if full_refresh:
            # Full refresh: write all from API
            with open(p, "w") as f:
                f.write(header)
                for row in new_rows:
                    f.write(f"{row['date']},{row['open']},{row['high']},{row['low']},{row['close']},{row['volume']}\n")
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
    
    now_pkt = datetime.now(PKT)
    print(f"=== PSX Daily OHLCV Update ===")
    print(f"  Pakistan time: {now_pkt.strftime('%Y-%m-%d %H:%M %A')}")
    print(f"  Market hours (9AM-4:30PM): {is_market_hours()}")
    print(f"  After close (5PM+): {is_after_close()}")
    print(f"  Mode: {'full refresh' if full_refresh else 'incremental (append only)'}")
    print(f"  Single symbol: {single_sym or 'ALL'}")
    print()
    
    if single_sym:
        appended, status = append_new_bars(single_sym, full_refresh)
        print(f"  {single_sym}: {appended} new bars appended ({status})")
        return
    
    # Fetch all companies
    print("  Fetching company list...")
    try:
        companies = fetch_companies()
    except Exception as e:
        print(f"  ERROR fetching company list: {e}")
        sys.exit(1)
    
    print(f"  Companies: {len(companies)}")
    print()
    
    success = 0
    failed = 0
    total_new_bars = 0
    
    for i, c in enumerate(companies, 1):
        sym = (c.get("value") or c.get("symbol") or "").strip()
        if not sym:
            continue
        
        # Skip if file was updated in last 12 hours (unless full refresh)
        p = OUT / f"{sym}.csv"
        if p.exists() and not full_refresh:
            age_hours = (time.time() - p.stat().st_mtime) / 3600
            if age_hours < 12:
                continue  # Already updated recently
        
        try:
            appended, status = append_new_bars(sym, full_refresh)
            if appended > 0:
                total_new_bars += appended
                success += 1
                print(f"  [{i}/{len(companies)}] {sym}: +{appended} new bars")
            elif status == "OK":
                # No new bars (already up to date)
                pass
            time.sleep(0.3)  # Rate limit
        except Exception as e:
            failed += 1
            if i <= 20 or failed <= 5:
                print(f"  [{i}/{len(companies)}] {sym}: FAILED - {e}")
    
    print()
    print(f"=== Update Complete ===")
    print(f"  Stocks updated: {success}")
    print(f"  Stocks failed: {failed}")
    print(f"  Total new bars added: {total_new_bars}")
    print(f"  Total CSV files: {len(list(OUT.glob('*.csv')))}")
    print(f"  Timestamp: {datetime.now(PKT).strftime('%Y-%m-%d %H:%M PKT')}")

if __name__ == "__main__":
    main()
