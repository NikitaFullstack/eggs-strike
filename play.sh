#!/usr/bin/env bash
# Запускает игру и публичный туннель одной командой.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Нужен Node.js 18+. Установи: https://nodejs.org"
  exit 1
fi

if [ ! -d node_modules ]; then
  npm install
fi

node server.js &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

echo ""
echo "  Локально:  http://localhost:3000"
echo "  Публичная ссылка появится ниже (строка с https://...lhr.life)"
echo "  Чтобы остановить — Ctrl+C"
echo ""

ssh -R 80:localhost:3000 nokey@localhost.run \
  -o StrictHostKeyChecking=no \
  -o UserKnownHostsFile=/dev/null \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  -o TCPKeepAlive=yes
