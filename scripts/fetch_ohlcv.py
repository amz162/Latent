#!/usr/bin/env python3
"""
Latent.pk — OHLCV fetcher
Fetches 2 years of daily OHLCV data for all 8 covered PSX stocks
from askanalyst.com.pk and saves as CSV files.

Usage: python3 scripts/fetch_ohlcv.py
Output: data/ohlcv/{SYMBOL}.csv (8 files)
"""

import os
import sys
import time
import urllib.request
from pathlib import Path

STOCKS = ["ENGRO", "HUBC", "LUCK", "SYS", "MEBL", "PSO", "OGDC", "PPL"]
DATA_DIR = Path("data/ohlcv")
DATA_DIR.mkdir(parents=True, exist_ok=True)

# 2 years of data (in milliseconds)
TO_MS = int(time.time() * 1000)
FROM_MS = TO_MS - 730 * 24 * 60 * 60 * 1000

def fetch_ohlcv(symbol: str) -> str | None:
    """Fetch OHLCV for a symbol, return CSV string."""
    url = f"https://api.askanalyst.com.pk/api/technicalchart/day/{FROM_MS}/{TO_MS}/{symbol}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "LatentBot/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.read().decode("utf-8")
    except Exception as e:
        print(f"  ERROR fetching {symbol}: {e}", file=sys.stderr)
        return None

def main():
    print(f"Fetching OHLCV for {len(STOCKS)} stocks (2-year window)...")
    print(f"Time range: {FROM_MS} to {TO_MS}")
    total_rows = 0
    for symbol in STOCKS:
        print(f"  -> {symbol}...", end=" ")
        csv_data = fetch_ohlcv(symbol)
        if not csv_data:
            print("FAILED")
            continue
        out_path = DATA_DIR / f"{symbol}.csv"
        out_path.write_text(csv_data)
        # Count data rows
        lines = csv_data.strip().split("\n")
        data_rows = len(lines) - 1  # exclude header
        total_rows += data_rows
        print(f"OK ({data_rows} rows)")
        time.sleep(0.5)  # be polite to upstream
    print(f"\nDone. Total: {total_rows} OHLCV rows across {len(STOCKS)} stocks.")
    print(f"Files saved to: {DATA_DIR}/")

if __name__ == "__main__":
    main()
