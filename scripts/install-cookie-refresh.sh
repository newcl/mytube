#!/usr/bin/env bash
# Install a launchd user agent that refreshes YouTube cookies every 6 hours.
# Runs as your Mac user → has Keychain + Chrome cookie access.
# Safe to re-run (unloads existing agent before reinstalling).
#
# Usage:
#   bash scripts/install-cookie-refresh.sh
#   bash scripts/install-cookie-refresh.sh --uninstall

set -euo pipefail

PLIST_LABEL="com.mytube.cookie-refresh"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUSH_SCRIPT="$SCRIPT_DIR/push-yt-cookies.sh"
LOG_DIR="$HOME/Library/Logs/mytube"
PYTHON3="/usr/bin/python3"
# yt-dlp installed in user's Python path
YTDLP_BIN="$HOME/Library/Python/3.9/bin"

# Install the push script to ~/Library/Scripts/mytube/ so launchd can access it
# (launchd agents cannot access ~/Downloads due to macOS TCC restrictions)
INSTALLED_SCRIPT="$HOME/Library/Scripts/mytube/push-yt-cookies.sh"

if [[ "${1:-}" == "--uninstall" ]]; then
  if launchctl list "$PLIST_LABEL" &>/dev/null; then
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    echo "Unloaded $PLIST_LABEL"
  fi
  rm -f "$PLIST_PATH"
  rm -f "$HOME/Library/Scripts/mytube/push-yt-cookies.sh"
  echo "Removed $PLIST_PATH"
  exit 0
fi

# Sanity checks
if [[ ! -f "$PUSH_SCRIPT" ]]; then
  echo "ERROR: push script not found at $PUSH_SCRIPT" >&2
  exit 1
fi
if [[ ! -f "$YTDLP_BIN/yt-dlp" ]]; then
  echo "ERROR: yt-dlp not found at $YTDLP_BIN/yt-dlp" >&2
  echo "Install with: pip3 install -U yt-dlp" >&2
  exit 1
fi
if ! ssh -q -o BatchMode=yes -o ConnectTimeout=5 tiny exit 2>/dev/null; then
  echo "WARNING: ssh tiny is not reachable right now — agent will still be installed."
fi

mkdir -p "$LOG_DIR"
mkdir -p "$(dirname "$INSTALLED_SCRIPT")"
cp "$PUSH_SCRIPT" "$INSTALLED_SCRIPT"
chmod +x "$INSTALLED_SCRIPT"
echo "Installed push script to $INSTALLED_SCRIPT"

# Unload existing agent if running
if launchctl list "$PLIST_LABEL" &>/dev/null; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  echo "Unloaded existing agent."
fi

# Write the plist
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${INSTALLED_SCRIPT}</string>
  </array>

  <!-- Run every 6 hours (21600 seconds). Fires immediately on wake if interval was missed. -->
  <key>StartInterval</key>
  <integer>21600</integer>

  <!-- Also run once shortly after login -->
  <key>RunAtLoad</key>
  <true/>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin:${YTDLP_BIN}</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>

  <key>WorkingDirectory</key>
  <string>${HOME}</string>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/cookie-refresh.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/cookie-refresh.log</string>
</dict>
</plist>
EOF

# Load it
launchctl load "$PLIST_PATH"

echo ""
echo "✓ Installed and loaded: $PLIST_LABEL"
echo "  Runs every 6 hours + at login"
echo "  Logs: $LOG_DIR/cookie-refresh.log"
echo ""
echo "To check status:   launchctl list $PLIST_LABEL"
echo "To view logs:      tail -f $LOG_DIR/cookie-refresh.log"
echo "To uninstall:      bash scripts/install-cookie-refresh.sh --uninstall"
