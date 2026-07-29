#!/usr/bin/env bash
# Build the Apple Silicon MyTube executable.
#
# yt-dlp is an external Homebrew dependency and is not embedded in the binary.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$REPO_DIR/backend"
OUTPUT_PATH="${MYTUBE_BUILD_OUTPUT:-$BACKEND_DIR/bin/mytube-darwin-arm64}"

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/mytube-native-build.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT

mkdir -p "$(dirname "$OUTPUT_PATH")"

BUILD_VERSION="$(git -C "$REPO_DIR" describe --always --dirty 2>/dev/null || echo dev)"
BUILD_COMMIT="$(git -C "$REPO_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILD_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LDFLAGS=(
  "-X main.buildVersion=$BUILD_VERSION"
  "-X main.buildCommit=$BUILD_COMMIT"
  "-X main.buildDate=$BUILD_DATE"
)

echo "Building native MyTube executable..."
(
  cd "$BACKEND_DIR"
  GOCACHE="${GOCACHE:-$TEMP_DIR/go-cache}" \
  GOTMPDIR="${GOTMPDIR:-$TEMP_DIR}" \
  CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 \
    go build -trimpath -ldflags "${LDFLAGS[*]}" -o "$OUTPUT_PATH" ./cmd/server
)

chmod 0755 "$OUTPUT_PATH"
echo "Built: $OUTPUT_PATH"
echo "External dependency: /opt/homebrew/bin/yt-dlp"
