#!/usr/bin/env bash
# Bulk update all 1,048 PSX stocks from psxdata, in chunks of 100.
# Designed for low-memory systems where running the full update in one
# shot gets killed by the OOM killer.
#
# Usage: bash scripts/bulk_update_all.sh
#
# Logs to: data/bulk_update_YYYYMMDD_HHMMSS.log

set -u  # exit on undefined variable
cd "$(dirname "$0")/.."

CHUNK_SIZE=100
TOTAL=1048
LOG_DIR="data"
LOG_FILE="$LOG_DIR/bulk_update_$(date +%Y%m%d_%H%M%S).log"
mkdir -p "$LOG_DIR"

echo "=== PSX Bulk Update (chunked) ===" | tee -a "$LOG_FILE"
echo "Chunk size: $CHUNK_SIZE stocks" | tee -a "$LOG_FILE"
echo "Total stocks: $TOTAL" | tee -a "$LOG_FILE"
echo "Log file: $LOG_FILE" | tee -a "$LOG_FILE"
echo "Started: $(date)" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

START_TS=$(date +%s)
TOTAL_UPDATED=0
TOTAL_FAILED=0
TOTAL_NEW_BARS=0

CHUNK_START=1
while [ "$CHUNK_START" -le "$TOTAL" ]; do
    CHUNK_END=$((CHUNK_START + CHUNK_SIZE - 1))
    if [ "$CHUNK_END" -gt "$TOTAL" ]; then
        CHUNK_END=$TOTAL
    fi

    CHUNK_NUM=$(( (CHUNK_START - 1) / CHUNK_SIZE + 1 ))
    TOTAL_CHUNKS=$(( (TOTAL + CHUNK_SIZE - 1) / CHUNK_SIZE ))

    echo "" | tee -a "$LOG_FILE"
    echo "--- Chunk $CHUNK_NUM/$TOTAL_CHUNKS: stocks $CHUNK_START-$CHUNK_END ---" | tee -a "$LOG_FILE"
    CHUNK_START_TS=$(date +%s)

    # Run the chunk
    python3 -u scripts/update_daily_ohlcv.py --start "$CHUNK_START" --end "$CHUNK_END" 2>&1 | tee -a "$LOG_FILE" | tail -5

    CHUNK_END_TS=$(date +%s)
    CHUNK_DURATION=$((CHUNK_END_TS - CHUNK_START_TS))
    echo "Chunk $CHUNK_NUM took ${CHUNK_DURATION}s" | tee -a "$LOG_FILE"

    # Memory state between chunks
    MEM=$(free -m | awk '/^Mem:/ {print $3 "MB used / " $7 "MB available"}')
    echo "Memory: $MEM" | tee -a "$LOG_FILE"

    # Brief pause between chunks to let system breathe (helps avoid OOM)
    sleep 2

    CHUNK_START=$((CHUNK_END + 1))
done

END_TS=$(date +%s)
TOTAL_DURATION=$((END_TS - START_TS))
echo "" | tee -a "$LOG_FILE"
echo "=== Bulk Update Complete ===" | tee -a "$LOG_FILE"
echo "Total duration: ${TOTAL_DURATION}s" | tee -a "$LOG_FILE"
echo "Finished: $(date)" | tee -a "$LOG_FILE"

# Final freshness summary
echo "" | tee -a "$LOG_FILE"
echo "=== Freshness Summary ===" | tee -a "$LOG_FILE"
python3 << 'PYEOF' | tee -a "$LOG_FILE"
import csv, os
from datetime import datetime, timezone, timedelta
PKT = timezone(timedelta(hours=5))
now = datetime.now(PKT)

fresh = 0
stale = 0
empty = 0
for fname in os.listdir('data/ohlcv_all'):
    if not fname.endswith('.csv'):
        continue
    try:
        with open(f'data/ohlcv_all/{fname}') as f:
            rows = list(csv.DictReader(f))
        if not rows: continue
        last = rows[-1]
        ts = int(last.get('date', 0))
        dt = datetime.fromtimestamp(ts/1000, tz=PKT)
        age = (now - dt).total_seconds() / 86400
        close = last.get('close', '')
        if not close or close == '0':
            empty += 1
        elif age < 3:
            fresh += 1
        else:
            stale += 1
    except:
        pass

total = fresh + stale + empty
print(f"  Total CSV files: {total}")
print(f"  FRESH (last bar < 3 days old, with close): {fresh}")
print(f"  STALE (last bar > 3 days old, with close): {stale}")
print(f"  EMPTY/SUSPENDED (last bar has empty close): {empty}")
PYEOF
