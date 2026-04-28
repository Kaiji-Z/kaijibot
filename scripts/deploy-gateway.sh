#!/usr/bin/env bash
set -euo pipefail

echo "[deploy] Building..."
pnpm build

echo "[deploy] Stopping gateway..."
pkill -f 'kaijibot-gateway' 2>/dev/null || true
sleep 2

echo "[deploy] Starting gateway in tmux session 'gw'..."
tmux has-session -t gw 2>/dev/null || tmux new-session -d -s gw
tmux send-keys -t gw '' C-c 2>/dev/null || true
sleep 0.5
tmux send-keys -t gw 'pnpm kaijibot gateway --port 18789 --verbose' Enter

echo "[deploy] Waiting for gateway to start..."
for i in $(seq 1 15); do
  if pgrep -f 'kaijibot-gateway' >/dev/null 2>&1; then
    echo "[deploy] Gateway running (PID $(pgrep -f 'kaijibot-gateway' | head -1))"
    exit 0
  fi
  sleep 1
done

echo "[deploy] ERROR: Gateway did not start within 15s" >&2
exit 1
