#!/usr/bin/env bash
# Compatibility wrapper for the old all-in-one Mac setup script.
# Cloudflare Tunnel and DNS cutover are now deliberate, separate operations.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building the native macOS package..."
"$SCRIPT_DIR/build-native-macos.sh"

echo "Installing the native user LaunchAgent..."
"$SCRIPT_DIR/install-native-macos.sh" install

echo
echo "Local installation is complete."
echo "Cloudflare Tunnel and DNS were not changed."
echo "Follow docs/deploy-mac.md after local download and playback verification."
