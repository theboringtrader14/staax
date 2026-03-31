#!/bin/bash
# ensure_db.sh — Kill pg16 (Homebrew) if running, ensure Docker staax_db is up.
# Run this before starting the STAAX backend to prevent the pg16/Docker port conflict.
#
# pg16 auto-restarts via launchd and grabs port 5432, causing the backend to
# connect to an empty pg16 instance instead of the Docker staax_db container.

set -e

echo "🔍 Checking for pg16 (Homebrew)..."
PG16_PID=$(cat /opt/homebrew/var/postgresql@16/postmaster.pid 2>/dev/null | head -1)

if [ ! -z "$PG16_PID" ]; then
    echo "⚠️  pg16 running (PID $PG16_PID) — killing to prevent DB conflict"
    kill -9 "$PG16_PID" 2>/dev/null || true
    sleep 2
    echo "✅ pg16 stopped"
else
    echo "✅ pg16 not running"
fi

echo "🐳 Starting Docker staax_db..."
docker start staax_db 2>/dev/null || true
sleep 3

echo "🔍 Verifying Docker DB..."
docker exec staax_db psql -U staax -d staax_db -c "SELECT COUNT(*) FROM algos;" \
    && echo "✅ Docker DB ready — staax_db is live on port 5432" \
    || echo "⛔ Docker DB check failed — run: docker logs staax_db"
