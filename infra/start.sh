#!/bin/zsh
# LIFEX Platform — Morning Startup
# Usage: ~/STAXX/start.sh

# Load platform-level env vars (ports etc)
[ -f ~/STAXX/.env ] && set -a && source ~/STAXX/.env && set +a

echo "🚀 Starting LIFEX Platform..."

# ── Safety: kill any stale backend processes ──────────────────────────────
pkill -f "uvicorn app.main" 2>/dev/null
sleep 2

# ── Safety: ensure local pg16 is STOPPED (Docker is the only DB) ─────────
brew services stop postgresql@16 2>/dev/null
/opt/homebrew/opt/postgresql@16/bin/pg_ctl stop -D /opt/homebrew/var/postgresql@16 -m fast 2>/dev/null
sleep 1

# ── PID directory ─────────────────────────────────────────────────────────
mkdir -p ~/STAXX/pids

# ── Start Docker containers ───────────────────────────────────────────────
docker start staax_db staax_redis 2>/dev/null
sleep 3

# Verify DB is accepting connections before migrations
until docker exec staax_db pg_isready -U staax -q 2>/dev/null; do
  echo "  Waiting for staax_db..."
  sleep 1
done
echo "  ✅ staax_db ready"

# Create travex_db if not exists
docker exec staax_db psql -U staax -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='travex_db'" | grep -q 1 \
  || docker exec staax_db createdb -U staax travex_db
echo "  ✅ travex_db ready"

# ── Run pending migrations ────────────────────────────────────────────────
echo "  Running migrations..."
(cd ~/STAXX/staax/backend  && python3.12 -m alembic upgrade head 2>&1 | tail -3)
(cd ~/STAXX/invex/backend  && python3.12 -m alembic upgrade head 2>&1 | tail -3)
# budgex backend has no alembic.ini — schema is managed manually
(cd ~/STAXX/travex/backend  && python3.12 -m alembic upgrade head 2>&1 | tail -3)

# ── Start all backends ────────────────────────────────────────────────────
mkdir -p ~/STAXX/logs

(cd ~/STAXX/staax/backend  && python3.12 -m uvicorn app.main:app --host 0.0.0.0 --port ${STAAX_BACKEND_PORT:-8000} >> ~/STAXX/logs/staax.log 2>&1) &
echo $! > ~/STAXX/pids/staax-backend.pid
(cd ~/STAXX/invex/backend  && python3.12 -m uvicorn app.main:app --host 0.0.0.0 --port ${INVEX_BACKEND_PORT:-8001} >> ~/STAXX/logs/invex.log 2>&1) &
echo $! > ~/STAXX/pids/invex-backend.pid
(cd ~/STAXX/budgex/backend && python3.12 -m uvicorn app.main:app --host 0.0.0.0 --port ${BUDGEX_BACKEND_PORT:-8002} >> ~/STAXX/logs/budgex.log 2>&1) &
echo $! > ~/STAXX/pids/budgex-backend.pid
(cd ~/STAXX/travex/backend  && python3.12 -m uvicorn app.main:app --host 0.0.0.0 --port ${TRAVEX_BACKEND_PORT:-8004} >> ~/STAXX/logs/travex.log 2>&1) &
echo $! > ~/STAXX/pids/travex-backend.pid

# ── Start all frontends ───────────────────────────────────────────────────
echo "  Starting frontends..."

(cd ~/STAXX/staax/frontend   && npm run dev > ~/STAXX/logs/staax-frontend.log   2>&1) &
echo $! > ~/STAXX/pids/staax-frontend.pid
(cd ~/STAXX/invex/frontend   && npm run dev > ~/STAXX/logs/invex-frontend.log   2>&1) &
echo $! > ~/STAXX/pids/invex-frontend.pid
(cd ~/STAXX/budgex/frontend  && npm run dev > ~/STAXX/logs/budgex-frontend.log  2>&1) &
echo $! > ~/STAXX/pids/budgex-frontend.pid
(cd ~/STAXX/travex/frontend  && npm run dev > ~/STAXX/logs/travex-frontend.log  2>&1) &
echo $! > ~/STAXX/pids/travex-frontend.pid
(cd ~/STAXX/lifex-landing    && npm run dev > ~/STAXX/logs/lifex-landing.log    2>&1) &
echo $! > ~/STAXX/pids/lifex-landing.pid

sleep 5

# ── Verify frontends are up ───────────────────────────────────────────────
declare -A FRONTEND_URL
FRONTEND_URL[3000]="http://localhost:3000"
FRONTEND_URL[3001]="http://localhost:3001"
FRONTEND_URL[3002]="http://localhost:3002"
FRONTEND_URL[3004]="http://localhost:3004"
FRONTEND_URL[5173]="http://localhost:5173"

for port in 3000 3001 3002 3004 5173; do
  if curl -sf --max-time 2 ${FRONTEND_URL[$port]} > /dev/null 2>&1; then
    echo "  ✅ Frontend on :$port"
  else
    echo "  ⚠️  Frontend on :$port not yet ready (check ~/STAXX/logs/)"
  fi
done

# ── Verify backends are up via health check ───────────────────────────────
# STAAX (port 8000): 15 retries × 2s — loads broker sessions, scheduler, SmartStream
# Others: 5 retries × 2s
declare -A HEALTH_URL
HEALTH_URL[8000]="http://localhost:8000/api/v1/system/health"
HEALTH_URL[8001]="http://localhost:8001/api/v1/system/health"
HEALTH_URL[8002]="http://localhost:8002/api/v1/system/health"
HEALTH_URL[8004]="http://localhost:8004/health"

declare -A MAX_RETRIES
MAX_RETRIES[8000]=15
MAX_RETRIES[8001]=5
MAX_RETRIES[8002]=5
MAX_RETRIES[8004]=5

for port in 8000 8001 8002 8004; do
  ok=0
  for i in $(seq 1 ${MAX_RETRIES[$port]}); do
    curl -sf ${HEALTH_URL[$port]} > /dev/null 2>&1 && ok=1 && break
    sleep 2
  done
  if [ $ok -eq 1 ]; then
    echo "  ✅ Backend on :$port"
  else
    echo "  ❌ Backend on :$port FAILED — check ~/STAXX/logs/"
  fi
done

echo ""
# ── OVERNIGHT EXIT REMINDER ───────────────────────────────────────────────────
# Check if today has overnight (BTST/STBT) positions that need exit monitoring.
# NEXT OVERNIGHT EXITS: Mon 2026-04-20
#   NF-STBT1  @ 09:30 IST  (next_day_exit_time)
#   NF-STBT2  @ 09:29 IST  (next_day_exit_time)
#   NF-BTST   @ check algo.next_day_exit_time
#   NF-TF     @ check algo.next_day_exit_time
# Verify in logs: grep "RECOVERY-BTST" ~/STAXX/logs/staax.log
# ─────────────────────────────────────────────────────────────────────────────
echo "📊 STAAX:  http://localhost:3000  (api: :8000)"
echo "📈 INVEX:  http://localhost:3001  (api: :8001)"
echo "💰 BUDGEX: http://localhost:3002  (api: :8002)"
echo "✈  TRAVEX: http://localhost:3004  (api: :8004)"
echo "🌐 LIFEX:  http://localhost:5173  (landing)"
echo "📋 Logs:   ~/STAXX/logs/"
echo ""
echo "✅ LIFEX Platform started"
