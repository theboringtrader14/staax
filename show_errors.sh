#!/bin/bash
LOG_DIR=~/STAXX/logs
DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/staax_$DATE.log"
if [ ! -f "$LOG_FILE" ]; then
    echo "No log for today. Start with: ./debug_log.sh"
    exit 1
fi
echo "=== STAAX Errors — $DATE ==="
grep -E "ERROR|failed|Exception|Traceback|Error:" $LOG_FILE | grep -v "GET /api\|OPTIONS /api\|connection open\|connection closed"
echo "Full log: $LOG_FILE"
