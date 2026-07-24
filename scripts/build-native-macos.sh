#!/usr/bin/env bash
# Build one Apple Silicon MyTube executable with a pinned yt-dlp_macos payload.
#
# Optional environment:
#   MYTUBE_YTDLP_SOURCE=/path/to/already-downloaded/yt-dlp_macos
#   MYTUBE_BUILD_OUTPUT=/path/to/output

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$REPO_DIR/backend"
VERSION_FILE="$BACKEND_DIR/tools/yt-dlp-macos.version"
CHECKSUM_FILE="$BACKEND_DIR/tools/yt-dlp-macos.sha256"
ASSET_PATH="$BACKEND_DIR/internal/tooling/assets/yt-dlp_macos"
OUTPUT_PATH="${MYTUBE_BUILD_OUTPUT:-$BACKEND_DIR/bin/mytube-darwin-arm64}"

YTDLP_VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
EXPECTED_SHA="$(tr -d '[:space:]' < "$CHECKSUM_FILE")"
YTDLP_URL="https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_macos"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mytube-native-build.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"; rm -f "$ASSET_PATH"' EXIT
PAYLOAD_PATH="$TEMP_DIR/yt-dlp_macos"

if [[ -n "${MYTUBE_YTDLP_SOURCE:-}" ]]; then
  cp "$MYTUBE_YTDLP_SOURCE" "$PAYLOAD_PATH"
else
  echo "Downloading pinned yt-dlp_macos ${YTDLP_VERSION}..."
  curl -fL "$YTDLP_URL" -o "$PAYLOAD_PATH"
fi

ACTUAL_SHA="$(shasum -a 256 "$PAYLOAD_PATH" | awk '{print $1}')"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "ERROR: yt-dlp_macos checksum mismatch" >&2
  echo "expected: $EXPECTED_SHA" >&2
  echo "actual:   $ACTUAL_SHA" >&2
  exit 1
fi

mkdir -p "$(dirname "$ASSET_PATH")" "$(dirname "$OUTPUT_PATH")"
cp "$PAYLOAD_PATH" "$ASSET_PATH"
chmod 0755 "$ASSET_PATH"

BUILD_VERSION="$(git -C "$REPO_DIR" describe --always --dirty 2>/dev/null || echo dev)"
BUILD_COMMIT="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LDFLAGS=(
  "-X main.buildVersion=$BUILD_VERSION"
  "-X main.buildCommit=$BUILD_COMMIT"
  "-X main.buildDate=$BUILD_DATE"
  "-X github.com/newcl/mytube/backend/internal/tooling.EmbeddedYTDLPVersion=$YTDLP_VERSION"
  "-X github.com/newcl/mytube/backend/internal/tooling.EmbeddedYTDLPSHA256=$EXPECTED_SHA"
)

echo "Building native MyTube package..."
(
  cd "$BACKEND_DIR"
  GOCACHE="${GOCACHE:-$TEMP_DIR/go-cache}" \
  GOTMPDIR="${GOTMPDIR:-$TEMP_DIR}" \
  CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
    go build -trimpath -ldflags "${LDFLAGS[*]}" -o "$OUTPUT_PATH" ./cmd/server
)

chmod 0755 "$OUTPUT_PATH"
echo "Built: $OUTPUT_PATH"
echo "yt-dlp: $YTDLP_VERSION ($EXPECTED_SHA)"
