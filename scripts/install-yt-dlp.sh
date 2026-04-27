#!/usr/bin/env bash
# Install latest yt-dlp + ffmpeg on the Oracle VPS (Ubuntu 24.04).
# Run as a user with sudo access (e.g. ubuntu).
#
# Usage:
#   bash scripts/install-yt-dlp.sh

set -euo pipefail

YT_DLP_DEST="/usr/local/bin/yt-dlp"

echo "==> Installing ffmpeg (required for merging video/audio streams)..."
sudo apt-get update -q
sudo apt-get install -y ffmpeg

echo ""
echo "==> Downloading latest yt-dlp binary from GitHub..."
# Use yt-dlp_linux — the standalone Linux x86_64 binary (no external Python needed).
LATEST_URL=$(curl -fsSL https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest \
  | python3 -c "
import sys, json
assets = json.load(sys.stdin).get('assets', [])
for a in assets:
    if a['name'] == 'yt-dlp_linux':
        print(a['browser_download_url'])
        break
")

if [[ -z "$LATEST_URL" ]]; then
  echo "ERROR: could not determine latest yt-dlp download URL" >&2
  exit 1
fi

echo "    URL: $LATEST_URL"
sudo curl -fsSL "$LATEST_URL" -o "$YT_DLP_DEST"
sudo chmod a+rx "$YT_DLP_DEST"

echo ""
echo "==> Verifying installation..."
echo -n "    yt-dlp path:    "; which yt-dlp
echo -n "    yt-dlp version: "; yt-dlp --version
echo -n "    ffmpeg path:    "; which ffmpeg
echo -n "    ffmpeg version: "; ffmpeg -version 2>&1 | head -1

echo ""
echo "==> yt-dlp self-update test (checks network + GitHub access)..."
yt-dlp --update-to stable 2>&1 | tail -3

echo ""
echo "==> Quick download test (extract info only, no actual download)..."
yt-dlp --simulate --no-playlist "https://www.youtube.com/watch?v=dQw4w9WgXcQ" \
  --print "%(title)s | %(uploader)s | %(duration_string)s" 2>/dev/null \
  || echo "WARN: simulate test failed (network/rate-limit issue)"

echo ""
echo "Done. yt-dlp and ffmpeg are installed."
