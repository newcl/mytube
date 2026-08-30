#!/usr/bin/env bash
# Install and manage the MyTube LAN HTTPS proxy on macOS.
#
# Usage:
#   bash scripts/install-lan-proxy.sh install
#   bash scripts/install-lan-proxy.sh status
#   bash scripts/install-lan-proxy.sh restart
#   bash scripts/install-lan-proxy.sh uninstall

set -euo pipefail

ACTION="${1:-install}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE_CADDYFILE="$REPO_DIR/deploy/macos/Caddyfile.mytube"
SOURCE_RUNNER="$REPO_DIR/scripts/run-lan-proxy.sh"

LABEL="com.mytube.caddy"
DISCOVERY_LABEL="com.mytube.discovery"
DOMAIN="gui/$(id -u)"
APP_DIR="$HOME/Library/Application Support/MyTube"
CONFIG_FILE="$APP_DIR/Caddyfile"
RUNNER_FILE="$APP_DIR/run-lan-proxy.sh"
DATA_DIR="$APP_DIR/caddy-data"
LOG_DIR="$HOME/Library/Logs/MyTube"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
DISCOVERY_PLIST="$HOME/Library/LaunchAgents/${DISCOVERY_LABEL}.plist"
CADDY_BIN="/opt/homebrew/bin/caddy"

status() {
  launchctl print "${DOMAIN}/${LABEL}"
  launchctl print "${DOMAIN}/${DISCOVERY_LABEL}"
}

stop_if_loaded() {
  local label="$1"
  local plist="$2"
  if launchctl print "${DOMAIN}/${label}" >/dev/null 2>&1; then
    launchctl bootout "$DOMAIN" "$plist"
  fi
}

read_lan_ip() {
  local active_ip
  active_ip="$(/usr/sbin/ipconfig getifaddr en1)"
  if [[ ! "$active_ip" =~ ^192\.168\.1\.[0-9]{1,3}$ ]]; then
    echo "ERROR: Wi-Fi en1 has no 192.168.1.x address" >&2
    return 1
  fi
  printf '%s' "$active_ip"
}

write_plist() {
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${RUNNER_FILE}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>XDG_DATA_HOME</key>
    <string>${DATA_DIR}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>Umask</key>
  <integer>63</integer>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/caddy.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/caddy.log</string>
</dict>
</plist>
EOF
  plutil -lint "$PLIST"
}

write_discovery_plist() {
  cat > "$DISCOVERY_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${DISCOVERY_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/dns-sd</string>
    <string>-i</string>
    <string>en1</string>
    <string>-R</string>
    <string>MyTube</string>
    <string>_mytube._tcp</string>
    <string>local.</string>
    <string>8083</string>
    <string>api_host=mytubeapi.elladali.com</string>
    <string>transport=http</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/discovery.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/discovery.log</string>
</dict>
</plist>
EOF
  plutil -lint "$DISCOVERY_PLIST"
}

wait_for_http_proxy() {
  for _ in {1..30}; do
    if curl -fsS -H 'Host: mytubeapi.elladali.com' \
      'http://127.0.0.1:8082/health' >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "ERROR: Caddy's loopback proxy did not become healthy" >&2
  return 1
}

wait_for_https_proxy() {
  local lan_ip="$1"
  for _ in {1..90}; do
    if curl -fsS --resolve "mytubeapi.elladali.com:8443:${lan_ip}" \
      'https://mytubeapi.elladali.com:8443/health' >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "ERROR: Caddy did not obtain a trusted certificate" >&2
  return 1
}

wait_for_lan_proxy() {
  local lan_ip="$1"
  for _ in {1..30}; do
    if [[ "$(curl -fsS -o /dev/null -w '%{http_code}' \
      "http://${lan_ip}:8083/health" 2>/dev/null)" == "200" ]]; then
      return 0
    fi
    sleep 1
  done
  echo "ERROR: Caddy's Bonjour LAN proxy did not become healthy" >&2
  return 1
}

case "$ACTION" in
  status)
    status
    exit 0
    ;;
  restart)
    lan_ip="$(read_lan_ip)"
    MYTUBE_LAN_IP="$lan_ip" "$CADDY_BIN" validate \
      --config "$CONFIG_FILE" --adapter caddyfile
    launchctl kickstart -k "${DOMAIN}/${LABEL}"
    launchctl kickstart -k "${DOMAIN}/${DISCOVERY_LABEL}"
    wait_for_http_proxy
    wait_for_https_proxy "$lan_ip"
    wait_for_lan_proxy "$lan_ip"
    status
    exit 0
    ;;
  uninstall)
    stop_if_loaded "$LABEL" "$PLIST"
    stop_if_loaded "$DISCOVERY_LABEL" "$DISCOVERY_PLIST"
    rm -f "$PLIST" "$DISCOVERY_PLIST" "$CONFIG_FILE" "$RUNNER_FILE" \
      "$APP_DIR/lan-proxy.env"
    echo "Removed MyTube LAN proxy configuration; Caddy data was preserved."
    exit 0
    ;;
  install)
    ;;
  *)
    echo "usage: $0 [install|status|restart|uninstall]" >&2
    exit 2
    ;;
esac

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "ERROR: this installer targets Apple Silicon macOS" >&2
  exit 1
fi
if [[ ! -x "$CADDY_BIN" ]]; then
  echo "ERROR: Caddy is not installed at $CADDY_BIN" >&2
  echo "Install it with: brew install caddy" >&2
  exit 1
fi

LAN_IP="$(read_lan_ip)"

mkdir -p "$APP_DIR" "$DATA_DIR" "$LOG_DIR" "$(dirname "$PLIST")"
chmod 0700 "$APP_DIR"
install -m 0600 "$SOURCE_CADDYFILE" "$CONFIG_FILE"
install -m 0700 "$SOURCE_RUNNER" "$RUNNER_FILE"
rm -f "$APP_DIR/lan-proxy.env"
write_plist
write_discovery_plist
MYTUBE_LAN_IP="$LAN_IP" "$CADDY_BIN" validate \
  --config "$CONFIG_FILE" --adapter caddyfile

stop_if_loaded "$LABEL" "$PLIST"
stop_if_loaded "$DISCOVERY_LABEL" "$DISCOVERY_PLIST"
launchctl enable "${DOMAIN}/${LABEL}"
launchctl enable "${DOMAIN}/${DISCOVERY_LABEL}"
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl bootstrap "$DOMAIN" "$DISCOVERY_PLIST"
wait_for_http_proxy
wait_for_lan_proxy "$LAN_IP"

echo "Installed and started: $LABEL"
echo "Installed and started: $DISCOVERY_LABEL"
echo "Loopback proxy: http://127.0.0.1:8082"
echo "LAN HTTPS: https://mytubeapi.elladali.com:8443 (${LAN_IP})"
echo "Bonjour LAN API: http://${LAN_IP}:8083 (_mytube._tcp.local)"
echo "Run the tunnel cutover before waiting for certificate issuance."
