#!/usr/bin/env bash
# Install and manage the MyTube public-route watchdog as a user LaunchAgent.
#
# Usage:
#   bash scripts/install-tunnel-watchdog.sh install
#   bash scripts/install-tunnel-watchdog.sh status
#   bash scripts/install-tunnel-watchdog.sh run
#   bash scripts/install-tunnel-watchdog.sh uninstall

set -euo pipefail

ACTION="${1:-install}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_WATCHDOG="$SCRIPT_DIR/mytube-tunnel-watchdog.sh"

LABEL="com.mytube.tunnel-watchdog"
DOMAIN="gui/$(id -u)"
APP_DIR="$HOME/Library/Application Support/MyTube"
INSTALL_WATCHDOG="$APP_DIR/tunnel-watchdog.sh"
LOG_DIR="$HOME/Library/Logs/MyTube"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

status() {
  launchctl print "${DOMAIN}/${LABEL}"
}

stop_if_loaded() {
  if launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1; then
    launchctl bootout "$DOMAIN" "$PLIST"
  fi
}

case "$ACTION" in
  status)
    status
    exit 0
    ;;
  run)
    exec "$SOURCE_WATCHDOG"
    ;;
  uninstall)
    stop_if_loaded
    rm -f "$PLIST" "$INSTALL_WATCHDOG"
    echo "Removed LaunchAgent: $LABEL"
    echo "Watchdog state and logs were preserved under: $APP_DIR and $LOG_DIR"
    exit 0
    ;;
  install)
    ;;
  *)
    echo "usage: $0 [install|status|run|uninstall]" >&2
    exit 2
    ;;
esac

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: this watchdog installer requires macOS" >&2
  exit 1
fi
if [[ ! -f "$SOURCE_WATCHDOG" ]]; then
  echo "ERROR: watchdog source not found: $SOURCE_WATCHDOG" >&2
  exit 1
fi
if ! launchctl print "${DOMAIN}/com.mytube.cloudflared" >/dev/null 2>&1; then
  echo "ERROR: com.mytube.cloudflared is not loaded" >&2
  exit 1
fi

mkdir -p "$APP_DIR" "$LOG_DIR" "$(dirname "$PLIST")"
chmod 0700 "$APP_DIR"

stop_if_loaded
install -m 0755 "$SOURCE_WATCHDOG" "$INSTALL_WATCHDOG"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${INSTALL_WATCHDOG}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/tunnel-watchdog.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/tunnel-watchdog.log</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST"
launchctl enable "${DOMAIN}/${LABEL}"
launchctl bootstrap "$DOMAIN" "$PLIST"

echo "Installed and started: $LABEL"
echo "Checks: local origin and public route every 60 seconds"
echo "Recovery: restart the tunnel after 3 consecutive public-only failures"
echo "Cooldown: 600 seconds between automatic restarts"
echo "Logs: $LOG_DIR/tunnel-watchdog.log"
