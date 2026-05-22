#!/bin/bash
#===============================================================================
# Deniz Game Hub - Termux Install Script
#===============================================================================
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "============================================"
echo " Deniz Game Hub - Termux Kurulum"
echo "============================================"
echo ""

# ---- System packages ----
echo "[1/4] Sistem paketleri kuruluyor..."
pkg update -y -o Dpkg::Options::="--force-confdef" 2>/dev/null
pkg install -y python python-pip nodejs git wget curl 2>/dev/null
echo "  Sistem paketleri OK"

# Optional: Stockfish for chess AI (offline)
echo "[*] Stockfish (satranc motoru) kuruluyor..."
pkg install -y stockfish 2>/dev/null && echo "  Stockfish OK" || echo "  [BILGI] Stockfish yok - satrancta AI calismaz"

# ---- Python dependencies ----
echo ""
echo "[2/4] Python paketleri kuruluyor..."
pip install flask flask-socketio flask-cors python-chess eventlet 2>/dev/null
echo "  Python paketleri OK"

# ---- Node.js dependencies ----
echo ""
echo "[3/4] Node.js paketleri kuruluyor..."
cd "$DIR/snake-backend"
npm install 2>/dev/null
cd "$DIR"
echo "  Node.js paketleri OK"

# ---- Done ----
echo ""
echo "[4/4] Kurulum tamamlandi!"
echo ""
echo "============================================"
echo " Baslatmak icin: bash start.sh"
echo " Durdurmak icin: bash stop.sh"
echo "============================================"
