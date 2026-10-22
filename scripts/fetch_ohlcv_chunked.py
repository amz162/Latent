#!/usr/bin/env python3
"""
Latent.pk — Chunked OHLCV fetcher for ALL DB stocks.

Fetches historical OHLCV data from psxdata-api.fastapicloud.dev for every
symbol in the local SQLite database, in chunks (parallel within chunk,
sleep between chunks) to avoid server overload.

Usage:
  python3 scripts/fetch_ohlcv_chunked.py                  # full fetch (all 1,240)
  python3 scripts/fetch_ohlcv_chunked.py --start 0 --end 100   # fetch first 100
  python3 scripts/fetch_ohlcv_chunked.py --chunk 0              # fetch chunk 0 of N
  python3 scripts/fetch_ohlcv_chunked.py --only-missing         # skip existing CSVs

Output: data/ohlcv_all/{SYMBOL}.csv (Unix-ms timestamp,open,high,low,close,volume)
"""
import sys, os, time, json, sqlite3, argparse
import urllib.request, urllib.error
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE_URL = "https://psxdata-api.fastapicloud.dev"
PROJECT = Path("/home/z/my-project")
OHLCV_DIR = PROJECT / "data" / "ohlcv_all"
DB_PATH = PROJECT / "db" / "custom.db"
OHLCV_DIR.mkdir(parents=True, exist_ok=True)

# Tunables — low server load
CHUNK_SIZE = 20         # symbols per chunk
CONCURRENCY = 5         # parallel fetches within a chunk
SLEEP_BETWEEN_CHUNKS = 0.5  # seconds
REQUEST_TIMEOUT = 20    # per fetch

def get_db_symbols():
    """All symbols from the DB (in stable alpha order)."""
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    cur.execute("SELECT symbol FROM Stock ORDER BY symbol")
    syms = [r[0] for r in cur.fetchall()]
    conn.close()
    return syms

def fetch_historical(sym):
    """Fetch OHLCV history for one symbol. Returns list of dicts or None."""
    url = f"{BASE_URL}/stocks/{urllib.parse.quote(str(sym))}/historical"
    try:
        req = urllib.request.Request(url, headers={
            "Accept": "application/json",
            "User-Agent": "LatentBot/1.0",
        })
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as r:
            data = json.loads(r.read().decode())
            return data.get("data") if isinstance(data, dict) else None
    except Exception as e:
        return {"__error__": str(e)}

def to_csv(rows):
    """Convert psxdata historical rows to CSV (date,open,high,low,close,volume).

    psxdata rows look like: {date: "2025-01-03", open, high, low, close, volume, is_anomaly}
    We convert the ISO date string to a Unix-ms timestamp and write the standard 6-column
    CSV format the training scripts expect.
    """
    import datetime as dt
    lines = ["date,open,high,low,close,volume"]
    valid = 0
    for row in rows:
        try:
            iso_date = row["date"]  # e.g. "2025-01-03"
            # Parse to UTC midnight, convert to Unix-ms
            d = dt.datetime.strptime(iso_date, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc)
            ts_ms = int(d.timestamp() * 1000)
            o, h, l, c, v = float(row["open"]), float(row["high"]), float(row["low"]), float(row["close"]), float(row["volume"])
            lines.append(f"{ts_ms},{o},{h},{l},{c},{int(v)}")
            valid += 1
        except (KeyError, ValueError, TypeError):
            continue
    return "\n".join(lines), valid

def save_csv(sym, rows):
    csv_text, valid = to_csv(rows)
    if valid < 30:
        return False, f"only {valid} valid rows"
    out = OHLCV_DIR / f"{sym}.csv"
    out.write_text(csv_text)
    return True, f"{valid} rows"

def process_chunk(symbols_chunk):
    """Process a chunk of symbols in parallel, return list of (sym, status, msg)."""
    results = []
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = {pool.submit(fetch_historical, s): s for s in symbols_chunk}
        for fut in as_completed(futures):
            sym = futures[fut]
            try:
                data = fut.result()
                if data is None:
                    results.append((sym, "fail", "no data"))
                elif isinstance(data, dict) and "__error__" in data:
                    results.append((sym, "fail", data["__error__"][:60]))
                elif not isinstance(data, list) or len(data) == 0:
                    results.append((sym, "fail", "empty"))
                else:
                    ok, msg = save_csv(sym, data)
                    results.append((sym, "ok" if ok else "fail", msg))
            except Exception as e:
                results.append((sym, "fail", str(e)[:60]))
    return results

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=int, default=0, help="Start index in symbol list")
    ap.add_argument("--end", type=int, default=0, help="End index (0 = all)")
    ap.add_argument("--chunk", type=int, default=0, help="Process only one chunk (0-indexed)")
    ap.add_argument("--only-missing", action="store_true", help="Skip symbols that already have CSVs")
    args = ap.parse_args()

    all_syms = get_db_symbols()
    print(f"DB has {len(all_syms)} symbols total")
    print(f"OHLCV dir: {OHLCV_DIR}")
    existing = set(f.stem for f in OHLCV_DIR.glob("*.csv"))
    print(f"Already have CSVs for {len(existing)} symbols")

    if args.only_missing:
        work = [s for s in all_syms if s not in existing]
        print(f"After filtering existing: {len(work)} to fetch")
    else:
        work = all_syms

    if args.end > 0:
        work = work[args.start:args.end]
        print(f"Sliced to [{args.start}:{args.end}]: {len(work)} symbols")
    elif args.start > 0:
        work = work[args.start:]
        print(f"Sliced from [{args.start}:]: {len(work)} symbols")

    if args.chunk:
        # Process only one chunk
        start_idx = args.chunk * CHUNK_SIZE
        end_idx = start_idx + CHUNK_SIZE
        work = work[start_idx:end_idx]
        print(f"Chunk {args.chunk}: symbols [{start_idx}:{end_idx}] = {len(work)} symbols")

    if not work:
        print("Nothing to do.")
        return

    # Process in chunks of CHUNK_SIZE
    total = len(work)
    n_chunks = (total + CHUNK_SIZE - 1) // CHUNK_SIZE
    ok_count = 0
    fail_count = 0
    t0 = time.time()
    print(f"Processing {total} symbols in {n_chunks} chunks (chunk_size={CHUNK_SIZE}, concurrency={CONCURRENCY})")
    print("=" * 70)

    for i in range(0, total, CHUNK_SIZE):
        chunk = work[i:i + CHUNK_SIZE]
        chunk_num = i // CHUNK_SIZE + 1
        results = process_chunk(chunk)
        for sym, status, msg in results:
            if status == "ok":
                ok_count += 1
            else:
                fail_count += 1
        # Print chunk summary
        chunk_ok = sum(1 for _, s, _ in results if s == "ok")
        chunk_fail = sum(1 for _, s, _ in results if s != "ok")
        elapsed = time.time() - t0
        eta = (elapsed / (i + len(chunk))) * (total - i - len(chunk)) if i + len(chunk) > 0 else 0
        print(f"[chunk {chunk_num}/{n_chunks}] OK={chunk_ok} FAIL={chunk_fail} | total: OK={ok_count} FAIL={fail_count} | elapsed={elapsed:.1f}s eta={eta:.1f}s")
        # Show a few failures
        for sym, status, msg in results:
            if status != "ok" and fail_count <= 10:
                print(f"    {sym}: {msg}")
        time.sleep(SLEEP_BETWEEN_CHUNKS)

    print("=" * 70)
    print(f"DONE: {ok_count} OK, {fail_count} FAIL, total time {time.time() - t0:.1f}s")
    print(f"OHLCV dir now has {len(list(OHLCV_DIR.glob('*.csv')))} CSVs")

if __name__ == "__main__":
    main()
