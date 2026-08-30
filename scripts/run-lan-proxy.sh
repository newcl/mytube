#!/usr/bin/env bash

set -euo pipefail

CADDY_BIN="/opt/homebrew/bin/caddy"
APP_DIR="$HOME/Library/Application Support/MyTube"
CONFIG_FILE="$APP_DIR/Caddyfile"
current_ip=""
caddy_pid=""

stop_caddy() {
  if [[ -n "$caddy_pid" ]] && kill -0 "$caddy_pid" 2>/dev/null; then
    kill "$caddy_pid"
    wait "$caddy_pid" || true
  fi
  caddy_pid=""
}

trap 'stop_caddy; exit 0' TERM INT EXIT

while true; do
  lan_ip="$(/usr/sbin/ipconfig getifaddr en1 2>/dev/null || true)"
  if [[ "$lan_ip" =~ ^192\.168\.1\.[0-9]{1,3}$ ]]; then
    if [[ "$lan_ip" != "$current_ip" ]] ||
      [[ -z "$caddy_pid" ]] || ! kill -0 "$caddy_pid" 2>/dev/null; then
      stop_caddy
      current_ip="$lan_ip"
      MYTUBE_LAN_IP="$lan_ip" "$CADDY_BIN" run \
        --config "$CONFIG_FILE" --adapter caddyfile &
      caddy_pid="$!"
    fi
  else
    stop_caddy
    current_ip=""
  fi
  sleep 5
done
