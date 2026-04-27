#!/usr/bin/env bash
# Extract YouTube-only cookies from local Chrome and push directly to the VPS.
#
# - Never writes cookies to a local file (piped straight to SSH)
# - Filters to YouTube/Google domains only
# - Places result at ~/.config/yt-dlp/cookies.txt on the remote host
#
# Usage:
#   bash scripts/push-yt-cookies.sh [ssh-host]
#
# Requires: python3 with yt-dlp installed (pip3 install yt-dlp)

set -euo pipefail

SSH_HOST="${1:-tiny}"
REMOTE_DEST="\$HOME/.config/yt-dlp/cookies.txt"

# YouTube + Google domains required for yt-dlp authentication.
# Intentionally narrow — no banking, social, or other site cookies.
YOUTUBE_DOMAINS=(
  ".youtube.com"
  ".google.com"
  ".googlevideo.com"
  ".ytimg.com"
  ".ggpht.com"
  ".googleusercontent.com"
  ".googleapis.com"
)

echo "==> Extracting YouTube-only cookies from Chrome..."
echo "    (macOS will prompt for Keychain access — click Allow)"
echo ""

# Build the domain filter as a Python tuple string
DOMAIN_TUPLE=$(printf '"%s",' "${YOUTUBE_DOMAINS[@]}")
DOMAIN_TUPLE="(${DOMAIN_TUPLE%,})"

# Extract, filter, format as Netscape cookie file, and pipe directly to VPS.
# No local file is written at any point.
python3 - <<PYEOF | ssh "$SSH_HOST" "
  mkdir -p \$(dirname $REMOTE_DEST) &&
  cat > $REMOTE_DEST &&
  chmod 600 $REMOTE_DEST &&
  echo 'Cookies written to $REMOTE_DEST'
"
import sys
from http.cookiejar import CookieJar
from yt_dlp.cookies import extract_cookies_from_browser

DOMAINS = $DOMAIN_TUPLE

jar: CookieJar = extract_cookies_from_browser("chrome")

lines = ["# Netscape HTTP Cookie File", "# Filtered: YouTube/Google domains only", ""]
count = 0
for c in jar:
    # Match if cookie domain ends with any allowed domain
    if not any(c.domain == d or c.domain.endswith(d) for d in DOMAINS):
        continue
    secure = "TRUE" if c.secure else "FALSE"
    subdomain = "TRUE" if c.domain.startswith(".") else "FALSE"
    expires = str(int(c.expires)) if c.expires else "0"
    lines.append(f"{c.domain}\t{subdomain}\t{c.path}\t{secure}\t{expires}\t{c.name}\t{c.value}")
    count += 1

print("\n".join(lines), file=sys.stdout)
sys.stderr.write(f"Filtered {count} YouTube/Google cookies\n")
PYEOF

echo ""
echo "==> Verifying remote cookie file..."
ssh "$SSH_HOST" '
  FILE="$HOME/.config/yt-dlp/cookies.txt"
  TOTAL=$(grep -c "^[^#]" "$FILE" 2>/dev/null || echo 0)
  echo "    Total cookies: $TOTAL"
  echo "    Domains present:"
  grep -v "^#" "$FILE" | awk "{print \$1}" | sort -u | sed "s/^/      /"
  echo "    Permissions: $(stat -c "%a %U" "$FILE" 2>/dev/null || stat -f "%p %Su" "$FILE")"
  echo ""
  # Sanity check — must not contain known non-Google domains
  BAD=$(grep -v "^#" "$FILE" | awk "{print \$1}" | grep -vE "\.(google|youtube|googlevideo|ytimg|ggpht|googleusercontent|googleapis)\.com$" || true)
  if [ -n "$BAD" ]; then
    echo "WARNING: unexpected domains found:"
    echo "$BAD"
  else
    echo "    Domain check passed — only YouTube/Google cookies present"
  fi
'

echo ""
echo "==> Syncing cookies to mytube service user..."
ssh "$SSH_HOST" '
  DEST="/opt/mytube/data/cookies.txt"
  if sudo test -d "/opt/mytube/data"; then
    sudo cp "$HOME/.config/yt-dlp/cookies.txt" "$DEST"
    sudo chown mytube:mytube "$DEST"
    sudo chmod 600 "$DEST"
    echo "    Synced to $DEST"
  else
    echo "    /opt/mytube/data not found — skipping service user sync"
  fi
'

echo ""
echo "==> Testing yt-dlp can use the cookies (simulate only, no download)..."
ssh "$SSH_HOST" '
  yt-dlp --simulate --no-playlist \
    --cookies "$HOME/.config/yt-dlp/cookies.txt" \
    --js-runtimes node \
    --print "%(title)s | %(uploader)s" \
    "https://www.youtube.com/watch?v=c1cBGW_zoyQ" 2>/dev/null \
  && echo "    yt-dlp test passed" \
  || echo "    yt-dlp test failed (cookies may have expired)"
'
