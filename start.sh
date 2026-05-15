#!/bin/bash
#===============================================================================
# Deniz Game Hub - Tum servisleri baslat
#===============================================================================
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
PIDDIR="$DIR/.pids"
mkdir -p "$PIDDIR"

echo "============================================"
echo " Deniz Game Hub Baslatiliyor..."
echo "============================================"

# ---- Game Hub Landing + Snake Frontend (port 8080) ----
echo -n "[1] Game Hub sayfasi (8080)... "
python3 server.py &
echo $! > "$PIDDIR/hub.pid"
sleep 1
echo "OK"

# ---- Chess (port 5000) ----
echo -n "[2] Satranc (5000)... "
cd "$DIR/chess"
python3 app.py --port 5000 --host 0.0.0.0 &
echo $! > "$PIDDIR/chess.pid"
cd "$DIR"
sleep 2
echo "OK"

# ---- Dama (port 5001) ----
echo -n "[3] Dama (5001)... "
cd "$DIR/dama"
python3 app.py --port 5001 --host 0.0.0.0 &
echo $! > "$PIDDIR/dama.pid"
cd "$DIR"
sleep 2
echo "OK"

# ---- Snake Backend (port 3000) ----
echo -n "[4] Snake backend (3000)... "
cd "$DIR/snake-backend"
node server.js &
echo $! > "$PIDDIR/snake.pid"
cd "$DIR"
sleep 2
echo "OK"

# ---- Get local IP ----
LOCAL_IP=$(ip route get 1 2>/dev/null | awk '{print $7; exit}' || ifconfig 2>/dev/null | grep -Eo 'inet (addr:)?([0-9]*\.){3}[0-9]*' | grep -v '127.0.0.1' | head -1 | awk '{print $2}')
[ -z "$LOCAL_IP" ] && LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -z "$LOCAL_IP" ] && LOCAL_IP="localhost"

echo ""
echo "============================================"
echo " TUM SERVISLER CALISIYOR!"
echo "============================================"
echo ""
echo "  Ana sayfa: http://${LOCAL_IP}:8080"
echo "  Satranc:   http://${LOCAL_IP}:5000"
echo "  Dama:      http://${LOCAL_IP}:5001"
echo "  Yilan:     http://${LOCAL_IP}:8080/snake"
echo ""
echo " Arkadaslarin ayni Wi-Fi agindan bu adrese baglanabilir."
echo " Durdurmak icin: bash stop.sh"
echo "============================================"
