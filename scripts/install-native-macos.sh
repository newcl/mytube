#!/usr/bin/env bash
# Install and manage the native MyTube user LaunchAgent.
#
# This script does not change Cloudflare Tunnel configuration or DNS.
#
# Usage:
#   bash scripts/install-native-macos.sh install [path-to-binary]
#   bash scripts/install-native-macos.sh status
#   bash scripts/install-native-macos.sh start
#   bash scripts/install-native-macos.sh stop
#   bash scripts/install-native-macos.sh restart
#   bash scripts/install-native-macos.sh uninstall

set -euo pipefail

ACTION="${1:-install}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
DEFAULT_BINARY="$REPO_DIR/backend/bin/mytube-darwin-arm64"
SOURCE_BINARY="${2:-$DEFAULT_BINARY}"

LABEL="com.mytube.server"
DOMAIN="gui/$(id -u)"
APP_DIR="$HOME/Library/Application Support/MyTube"
INSTALL_BINARY="$APP_DIR/mytube"
CONFIG_FILE="$APP_DIR/mytube.env"
LEGACY_CONFIG_FILE="$APP_DIR/.env"
DOWNLOAD_DIR="$APP_DIR/downloads"
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
  start)
    launchctl enable "${DOMAIN}/${LABEL}"
    if ! launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1; then
      launchctl bootstrap "$DOMAIN" "$PLIST"
    fi
    status
    exit 0
    ;;
  stop)
    stop_if_loaded
    echo "Stopped: $LABEL"
    exit 0
    ;;
  restart)
    launchctl enable "${DOMAIN}/${LABEL}"
    if launchctl print "${DOMAIN}/${LABEL}" >/dev/null 2>&1; then
      launchctl kickstart -k "${DOMAIN}/${LABEL}"
    else
      launchctl bootstrap "$DOMAIN" "$PLIST"
    fi
    status
    exit 0
    ;;
  uninstall)
    stop_if_loaded
    rm -f "$PLIST"
    echo "Removed LaunchAgent: $LABEL"
    echo "Application data and configuration were preserved at: $APP_DIR"
    exit 0
    ;;
  install)
    ;;
  *)
    echo "usage: $0 [install [binary]|status|start|stop|restart|uninstall]" >&2
    exit 2
    ;;
esac

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "ERROR: the native package requires Apple Silicon macOS" >&2
  exit 1
fi
if [[ ! -x "$SOURCE_BINARY" ]]; then
  echo "ERROR: executable not found: $SOURCE_BINARY" >&2
  echo "Build it with: bash scripts/build-native-macos.sh" >&2
  exit 1
fi

mkdir -p "$APP_DIR" "$DOWNLOAD_DIR" "$LOG_DIR" "$(dirname "$PLIST")"
chmod 0700 "$APP_DIR"

stop_if_loaded
install -m 0755 "$SOURCE_BINARY" "$INSTALL_BINARY"

if [[ ! -f "$CONFIG_FILE" && -f "$LEGACY_CONFIG_FILE" ]]; then
  install -m 0600 "$LEGACY_CONFIG_FILE" "$CONFIG_FILE"
  chmod 0600 "$LEGACY_CONFIG_FILE"
  # The legacy service listened on all interfaces. The native service is
  # published by cloudflared and should only accept loopback connections.
  sed -i '' 's/^MYTUBE_BIND=.*/MYTUBE_BIND=127.0.0.1:8081/' "$CONFIG_FILE"
  if ! grep -q '^MYTUBE_JS_RUNTIME=' "$CONFIG_FILE"; then
    echo "MYTUBE_JS_RUNTIME=deno" >> "$CONFIG_FILE"
  fi
  echo "Migrated legacy configuration and preserved its token/data paths."
elif [[ ! -f "$CONFIG_FILE" ]]; then
  TOKEN="$(openssl rand -hex 32)"
  {
    echo "MYTUBE_TOKEN=$TOKEN"
    echo "MYTUBE_BIND=127.0.0.1:8081"
    echo "MYTUBE_STATE_DIR=$APP_DIR"
    echo "MYTUBE_DOWNLOAD_DIR=$DOWNLOAD_DIR"
    echo "MYTUBE_CORS_ORIGIN=https://mytube.elladali.com"
    echo "MYTUBE_CONCURRENCY=2"
    echo "MYTUBE_COOKIE_BROWSER=chrome"
    echo "MYTUBE_JS_RUNTIME=deno"
  } > "$CONFIG_FILE"
  chmod 0600 "$CONFIG_FILE"
  echo "Created protected configuration: $CONFIG_FILE"
else
  chmod 0600 "$CONFIG_FILE"
  echo "Preserved existing configuration: $CONFIG_FILE"
fi

"$INSTALL_BINARY" doctor --config "$CONFIG_FILE"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${INSTALL_BINARY}</string>
    <string>serve</string>
    <string>--config</string>
    <string>${CONFIG_FILE}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>${APP_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/server.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/server.log</string>
</dict>
</plist>
EOF

plutil -lint "$PLIST"
# The previous Mac backend was explicitly disabled during the k3s migration.
# Re-enable the label before bootstrapping the replacement LaunchAgent.
launchctl enable "${DOMAIN}/${LABEL}"
launchctl bootstrap "$DOMAIN" "$PLIST"

echo "Installed and started: $LABEL"
echo "Local health: http://127.0.0.1:8081/health"
echo "Logs: $LOG_DIR/server.log"
echo "Configuration: $CONFIG_FILE"
echo "The API token remains in the mode-0600 configuration file."
echo "Cloudflare Tunnel and DNS were not changed."
