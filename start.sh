#!/bin/bash
set -e

# ── Check dependencies ───────────────────────────────────────────────────────
if ! command -v cloudflared &>/dev/null; then
  echo "[!] 'cloudflared' not found in PATH."
  echo "    Install it with:"
  echo "      wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
  echo "      sudo dpkg -i cloudflared-linux-amd64.deb"
  exit 1
fi

if ! command -v node &>/dev/null; then
  echo "[!] 'node' not found in PATH. Install Node.js first."
  exit 1
fi

if ! command -v openssl &>/dev/null; then
  echo "[!] 'openssl' not found. Install it with: sudo apt-get install openssl"
  exit 1
fi

echo "[*] Killing any old cloudflared/node processes..."
pkill cloudflared 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true
sleep 1

echo "[*] Starting fresh tunnel..."
cloudflared tunnel --url http://localhost:8787 > /tmp/cf.log 2>&1 &
CF_PID=$!

echo "[*] Waiting for tunnel URL..."
URL=""
for i in $(seq 1 15); do
  URL=$(grep -o 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' /tmp/cf.log | head -1)
  if [ -n "$URL" ]; then break; fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "[!] Failed to get tunnel URL, check /tmp/cf.log"
  exit 1
fi

echo "[*] Tunnel is live at: $URL"

MASTER_KEY=$(openssl rand -hex 16)
echo ""
echo "=========================================="
echo " MASTER KEY (only shown here, don't paste"
echo " this into any chat, ever):"
echo ""
echo " $MASTER_KEY"
echo "=========================================="
echo ""
echo "[*] Connector URL for claude.ai:"
echo " $URL/mcp"
echo ""
echo "[*] Starting server..."

PUBLIC_URL="$URL" MASTER_KEY="$MASTER_KEY" node server.js
