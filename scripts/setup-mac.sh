#!/usr/bin/env bash
# Set up mytube backend on an Apple Silicon Mac mini using Cloudflare Tunnel.
#
# What this does:
#   1. Installs deps (homebrew: cloudflared, ffmpeg, yt-dlp)
#   2. Copies the mytube-server binary to ~/Library/Application Support/mytube/
#   3. Creates a .env file with your config
#   4. Installs a launchd agent for mytube-server
#   5. Guides you through creating the cloudflared tunnel
#   6. Installs a launchd agent for cloudflared
#
# After this runs, api.mytube.elladali.com → cloudflared tunnel → localhost:8081
# yt-dlp reads cookies directly from Chrome — no cookie file management needed.
#
# Usage:
#   bash scripts/setup-mac.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
BINARY_SRC="$REPO_DIR/backend/bin/mytube-server-darwin-arm64"

APP_DIR="$HOME/Library/Application Support/mytube"
DATA_DIR="$APP_DIR/data"
DOWNLOADS_DIR="$DATA_DIR/downloads"
BINARY_DEST="$APP_DIR/mytube-server"
ENV_FILE="$APP_DIR/.env"
LOG_DIR="$HOME/Library/Logs/mytube"
CF_CONFIG_DIR="$HOME/.cloudflared"

SERVER_LABEL="com.mytube.server"
CF_LABEL="com.mytube.cloudflared"
SERVER_PLIST="$HOME/Library/LaunchAgents/${SERVER_LABEL}.plist"
CF_PLIST="$HOME/Library/LaunchAgents/${CF_LABEL}.plist"

TUNNEL_NAME="mytube"
HOSTNAME="api.mytube.elladali.com"
LOCAL_PORT="8081"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}==>${NC} $*"; }
warn()  { echo -e "${YELLOW}WARN:${NC} $*"; }
fatal() { echo -e "${RED}ERROR:${NC} $*" >&2; exit 1; }

# ── 1. Prereqs ────────────────────────────────────────────────────────────────
info "Checking prerequisites..."

if ! command -v brew &>/dev/null; then
  fatal "Homebrew not found. Install from https://brew.sh first."
fi

NEED_INSTALL=()
command -v cloudflared &>/dev/null || NEED_INSTALL+=(cloudflared)
command -v ffmpeg      &>/dev/null || NEED_INSTALL+=(ffmpeg)
# yt-dlp: accept both brew-installed and pip-installed
if ! command -v yt-dlp &>/dev/null && ! python3 -c "import yt_dlp" &>/dev/null; then
  NEED_INSTALL+=(yt-dlp)
fi

if [[ ${#NEED_INSTALL[@]} -gt 0 ]]; then
  info "Installing via Homebrew: ${NEED_INSTALL[*]}"
  brew install "${NEED_INSTALL[@]}"
fi

# Resolve yt-dlp path (brew or pip)
if command -v yt-dlp &>/dev/null; then
  YTDLP_DIR="$(dirname "$(command -v yt-dlp)")"
else
  # pip-installed fallback
  YTDLP_DIR="$(python3 -c "import site; print(site.getusersitepackages().replace('/lib/python/site-packages','') + '/bin')" 2>/dev/null || echo "$HOME/Library/Python/3.9/bin")"
fi

# ── 2. Binary ─────────────────────────────────────────────────────────────────
info "Installing mytube-server binary..."

if [[ ! -f "$BINARY_SRC" ]]; then
  info "Binary not found, building now..."
  (cd "$REPO_DIR/backend" && GOOS=darwin GOARCH=arm64 go build -o bin/mytube-server-darwin-arm64 ./cmd/server)
fi

mkdir -p "$APP_DIR" "$DATA_DIR" "$DOWNLOADS_DIR" "$LOG_DIR"
cp "$BINARY_SRC" "$BINARY_DEST"
chmod +x "$BINARY_DEST"
echo "  Installed: $BINARY_DEST"

# ── 3. .env ───────────────────────────────────────────────────────────────────
if [[ -f "$ENV_FILE" ]]; then
  warn ".env already exists at $ENV_FILE — skipping (delete it to regenerate)"
else
  info "Creating .env..."
  # Generate a token if not already set on the VPS
  TOKEN="${MYTUBE_TOKEN:-$(openssl rand -hex 32)}"
  cat > "$ENV_FILE" << EOF
MYTUBE_TOKEN=${TOKEN}
MYTUBE_BIND=:${LOCAL_PORT}
MYTUBE_DB_PATH=${DATA_DIR}/mytube.db
MYTUBE_DOWNLOAD_DIR=${DOWNLOADS_DIR}
MYTUBE_CORS_ORIGIN=https://mytube.elladali.com
MYTUBE_CONCURRENCY=2
# Use Chrome cookies directly — no cookie file management needed on Mac
MYTUBE_COOKIE_BROWSER=chrome
EOF
  echo "  Created: $ENV_FILE"
  echo ""
  echo -e "  ${YELLOW}TOKEN: ${TOKEN}${NC}"
  echo "  → Save this token. Set it in the frontend Settings dialog."
fi

# ── 4. launchd: mytube-server ─────────────────────────────────────────────────
info "Installing launchd agent: $SERVER_LABEL..."

if launchctl list "$SERVER_LABEL" &>/dev/null; then
  launchctl unload "$SERVER_PLIST" 2>/dev/null || true
fi

cat > "$SERVER_PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVER_LABEL}</string>

  <!-- source .env via bash since launchd has no EnvironmentFile support -->
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-c</string>
    <string>set -a; source "${ENV_FILE}"; set +a; exec "${BINARY_DEST}"</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin:${YTDLP_DIR}</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>

  <key>WorkingDirectory</key>
  <string>${APP_DIR}</string>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/server.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/server.log</string>
</dict>
</plist>
EOF

launchctl load "$SERVER_PLIST"
echo "  Loaded: $SERVER_LABEL"

# ── 5. Cloudflare Tunnel ──────────────────────────────────────────────────────
echo ""
info "Setting up Cloudflare Tunnel..."
echo ""

# Check if tunnel already exists
TUNNEL_ID=""
if cloudflared tunnel list 2>/dev/null | grep -q "$TUNNEL_NAME"; then
  TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | awk "/$TUNNEL_NAME/ {print \$1}")
  echo "  Tunnel '$TUNNEL_NAME' already exists (id: $TUNNEL_ID)"
else
  echo "  You need to authenticate cloudflared with your Cloudflare account."
  echo "  A browser window will open — log in and authorise elladali.com."
  echo ""
  read -p "  Press Enter when ready..."
  cloudflared tunnel login

  echo ""
  info "Creating tunnel '$TUNNEL_NAME'..."
  cloudflared tunnel create "$TUNNEL_NAME"
  TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | awk "/$TUNNEL_NAME/ {print \$1}")
fi

if [[ -z "$TUNNEL_ID" ]]; then
  fatal "Could not determine tunnel ID. Run 'cloudflared tunnel list' manually."
fi

# Write tunnel config
CF_TUNNEL_CONFIG="$CF_CONFIG_DIR/config.yml"
info "Writing tunnel config to $CF_TUNNEL_CONFIG..."
cat > "$CF_TUNNEL_CONFIG" << EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CF_CONFIG_DIR}/${TUNNEL_ID}.json

# Use HTTP/2 (TCP) instead of the default QUIC (UDP).
# Home routers drop idle UDP/NAT state every ~60 s which causes all four tunnel
# connections to time out simultaneously and produces brief 530 errors.
# HTTP/2 keeps persistent TCP connections that survive NAT idle timeouts.
protocol: http2

ingress:
  - hostname: ${HOSTNAME}
    service: http://localhost:${LOCAL_PORT}
  - service: http_status:404
EOF
echo "  Written: $CF_TUNNEL_CONFIG"

# Route DNS
info "Routing ${HOSTNAME} → tunnel..."
echo "  (This will replace the existing A record with a CNAME to the tunnel)"
cloudflared tunnel route dns --overwrite-dns "$TUNNEL_NAME" "$HOSTNAME" \
  && echo "  DNS updated: ${HOSTNAME} → ${TUNNEL_ID}.cfargotunnel.com" \
  || warn "DNS routing failed — you may need to do it manually in the Cloudflare dashboard"

# ── 6. launchd: cloudflared ───────────────────────────────────────────────────
info "Installing launchd agent: $CF_LABEL..."

CF_BIN="$(command -v cloudflared)"

# Remove the Homebrew-managed cloudflared agent if present; it conflicts with
# our custom plist and has no tunnel config (exits 1 immediately).
HB_CF_PLIST="$HOME/Library/LaunchAgents/homebrew.mxcl.cloudflared.plist"
if [[ -f "$HB_CF_PLIST" ]]; then
  launchctl unload "$HB_CF_PLIST" 2>/dev/null || true
  rm -f "$HB_CF_PLIST"
  warn "Removed homebrew.mxcl.cloudflared LaunchAgent (conflicts with $CF_LABEL)"
fi

if launchctl list "$CF_LABEL" &>/dev/null; then
  launchctl unload "$CF_PLIST" 2>/dev/null || true
fi

cat > "$CF_PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${CF_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${CF_BIN}</string>
    <string>tunnel</string>
    <string>--config</string>
    <string>${CF_TUNNEL_CONFIG}</string>
    <string>run</string>
  </array>

  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/cloudflared.log</string>

  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/cloudflared.log</string>
</dict>
</plist>
EOF

launchctl load "$CF_PLIST"
echo "  Loaded: $CF_LABEL"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN} Setup complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Server logs:      tail -f $LOG_DIR/server.log"
echo "  Tunnel logs:      tail -f $LOG_DIR/cloudflared.log"
echo "  Config:           $ENV_FILE"
echo ""
echo "  Test API:         curl -s https://${HOSTNAME}/health"
echo ""
echo "  IMPORTANT: On the first download, macOS will ask for Keychain"
echo "  access so yt-dlp can read Chrome cookies. Click 'Always Allow'."
echo ""
echo -e "  ${YELLOW}IMPORTANT — Mac restart resilience:${NC}"
echo "  The launchd agents above only start after a GUI login (LaunchAgents)."
echo "  If the Mac mini restarts unattended, services won't run until you log in."
echo "  Fix: enable automatic login in System Settings → Users & Groups → Login Options"
echo "  (acceptable for a home server; disable if the machine is in a shared space)."
echo ""
echo "  Frontend settings:"
echo "    API Base URL: https://${HOSTNAME}"
echo "    Token: (from $ENV_FILE)"
