#!/bin/bash
#===============================================================================
# Deniz Game Hub - Termux Install Script
# Run once after cloning: bash install.sh
#===============================================================================
set -e
echo "============================================"
echo " Deniz Game Hub - Termux Kurulum"
echo "============================================"
echo ""

# ---- System packages ----
echo "[1/4] Sistem paketleri kuruluyor..."
pkg update -y -o Dpkg::Options::="--force-confdef" 2>/dev/null
pkg install -y python python-pip nodejs git wget curl 2>/dev/null

# Stockfish (chess engine) - optional, try to install
echo "[*] Stockfish kuruluyor (santranc AI)..."
pkg install -y stockfish 2>/dev/null && echo "  Stockfish OK" || echo "  [UYARI] Stockfish bulunamadi - satranc AI calismaz"

# ---- Python dependencies ----
echo ""
echo "[2/4] Python paketleri kuruluyor..."
pip install flask flask-socketio python-chess flask-cors 2>/dev/null
echo "  Python paketleri OK"

# ---- Node.js dependencies ----
echo ""
echo "[3/4] Node.js paketleri kuruluyor..."
cd snake-backend
npm install --no-audit --no-fund 2>/dev/null
cd ..
echo "  Node.js paketleri OK"

# ---- Done ----
echo ""
echo "[4/4] Kurulum tamamlandi!"
echo ""
echo "============================================"
echo " Baslatmak icin: bash start.sh"
echo " Durdurmak icin: bash stop.sh"
echo "============================================"
