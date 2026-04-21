#!/bin/zsh
# LIFEX Platform — Evening Shutdown
# Usage: ~/STAXX/stop.sh

# Kill by port (most reliable — catches child workers too)
for port in 8000 8001 8002 8003 8004; do
  pid=$(lsof -ti:$port 2>/dev/null)
  if [ -n "$pid" ]; then
    kill -9 $pid 2>/dev/null
    echo "  Killed process on port $port (PID: $pid)"
  fi
done

# Kill by process name (belt and suspenders)
pkill -9 -f "uvicorn app.main" 2>/dev/null
pkill -9 -f "vite" 2>/dev/null

sleep 1

lsof -ti:3000,3001,3002,3003,3004,5173 | xargs kill -9 2>/dev/null

echo "✅ All backends stopped"
echo "✅ All frontends stopped"
