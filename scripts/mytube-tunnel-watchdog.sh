#!/usr/bin/env bash
# Restart the MyTube Cloudflare Tunnel only when the local origin is healthy
# and the public route has failed repeatedly.

set -euo pipefail

LOCAL_HEALTH_URL="${MYTUBE_WATCHDOG_LOCAL_URL:-http://127.0.0.1:8081/health}"
PUBLIC_HEALTH_URL="${MYTUBE_WATCHDOG_PUBLIC_URL:-https://mytubeapi.elladali.com/health}"
TUNNEL_LABEL="${MYTUBE_WATCHDOG_TUNNEL_LABEL:-com.mytube.cloudflared}"
DOMAIN="${MYTUBE_WATCHDOG_LAUNCH_DOMAIN:-gui/$(id -u)}"
FAILURE_LIMIT="${MYTUBE_WATCHDOG_FAILURE_LIMIT:-3}"
COOLDOWN_SECONDS="${MYTUBE_WATCHDOG_COOLDOWN_SECONDS:-600}"
STATE_DIR="${MYTUBE_WATCHDOG_STATE_DIR:-$HOME/Library/Application Support/MyTube/tunnel-watchdog}"
FAILURE_FILE="$STATE_DIR/consecutive-failures"
RESTART_FILE="$STATE_DIR/last-restart"

timestamp() {
  date -u +'%Y-%m-%dT%H:%M:%SZ'
}

log() {
  printf '%s %s\n' "$(timestamp)" "$*"
}

read_counter() {
  local file="$1"
  local value="0"
  if [[ -r "$file" ]]; then
    IFS= read -r value < "$file" || value="0"
  fi
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    value="0"
  fi
  printf '%s' "$value"
}

write_counter() {
  local file="$1"
  local value="$2"
  local temporary="${file}.tmp.$$"
  printf '%s\n' "$value" > "$temporary"
  chmod 0600 "$temporary"
  mv -f "$temporary" "$file"
}

healthy() {
  curl --fail --silent --show-error --output /dev/null \
    --connect-timeout 3 --max-time 12 \
    -H 'Cache-Control: no-cache' "$1"
}

if [[ ! "$FAILURE_LIMIT" =~ ^[1-9][0-9]*$ || ! "$COOLDOWN_SECONDS" =~ ^[0-9]+$ ]]; then
  log "invalid watchdog configuration"
  exit 2
fi

mkdir -p "$STATE_DIR"
chmod 0700 "$STATE_DIR"

failures="$(read_counter "$FAILURE_FILE")"

if ! healthy "$LOCAL_HEALTH_URL"; then
  if (( failures > 0 )); then
    log "local MyTube origin is unhealthy; cleared $failures public failure(s) without restarting the tunnel"
  fi
  write_counter "$FAILURE_FILE" 0
  exit 0
fi

if healthy "$PUBLIC_HEALTH_URL"; then
  if (( failures > 0 )); then
    log "public MyTube route recovered after $failures failure(s)"
  fi
  write_counter "$FAILURE_FILE" 0
  exit 0
fi

failures=$((failures + 1))
write_counter "$FAILURE_FILE" "$failures"
log "public MyTube health failed while local origin is healthy ($failures/$FAILURE_LIMIT)"

if (( failures < FAILURE_LIMIT )); then
  exit 0
fi

now="$(date +%s)"
last_restart="$(read_counter "$RESTART_FILE")"
if (( now - last_restart < COOLDOWN_SECONDS )); then
  log "tunnel restart suppressed by ${COOLDOWN_SECONDS}s cooldown"
  exit 0
fi

if launchctl kickstart -k "${DOMAIN}/${TUNNEL_LABEL}"; then
  write_counter "$RESTART_FILE" "$now"
  write_counter "$FAILURE_FILE" 0
  log "restarted ${DOMAIN}/${TUNNEL_LABEL} after $failures consecutive public health failures"
else
  log "failed to restart ${DOMAIN}/${TUNNEL_LABEL}"
  exit 1
fi
