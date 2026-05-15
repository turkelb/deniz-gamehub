#!/bin/bash
#===============================================================================
# Deniz Game Hub - Tum servisleri durdur
#===============================================================================
DIR="$(cd "$(dirname "$0")" && pwd)"
PIDDIR="$DIR/.pids"

echo "Servisler durduruluyor..."

for svc in hub chess dama snake; do
    if [ -f "$PIDDIR/${svc}.pid" ]; then
        PID=$(cat "$PIDDIR/${svc}.pid")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID" 2>/dev/null
            echo "  [$svc] PID $PID durduruldu"
        fi
        rm -f "$PIDDIR/${svc}.pid"
    fi
done

# Kill any remaining child processes
pkill -f "server.py" 2>/dev/null || true
pkill -f "chess/app.py" 2>/dev/null || true
pkill -f "dama/app.py" 2>/dev/null || true
pkill -f "snake-backend/server.js" 2>/dev/null || true

rm -rf "$PIDDIR"
echo "Tum servisler durdu."
