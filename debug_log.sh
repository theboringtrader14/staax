#!/bin/bash
LOG_DIR=~/STAXX/logs
mkdir -p $LOG_DIR
DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/staax_$DATE.log"
echo "=== STAAX Debug Log — $DATE ===" >> $LOG_FILE
echo "Started: $(date '+%H:%M:%S')" >> $LOG_FILE
cd ~/STAXX/staax/backend
uvicorn app.main:app --host 0.0.0.0 --port 8000 2>&1 | tee -a $LOG_FILE
