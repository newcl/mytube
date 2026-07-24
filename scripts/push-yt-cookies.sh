#!/usr/bin/env bash
# Extract YouTube-only cookies from local Chrome and push them to the homelab VM.
#
# - Never writes cookies to a local file (piped straight to SSH)
# - Filters to youtube.com and its subdomains only
# - Replaces the remote cookie jar atomically
#
# Usage:
#   bash scripts/push-yt-cookies.sh [ssh-host]
#
# Requires: python3 with yt-dlp installed (pip3 install yt-dlp)

set -euo pipefail

SSH_HOST="${1:-liang@192.168.234.129}"
SSH_KEY="${MYTUBE_SSH_KEY:-$HOME/.ssh/miniu1}"
REMOTE_DIR="/srv/mytube/cookies"
REMOTE_DEST="${REMOTE_DIR}/cookies.txt"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_HOST")

echo "==> Extracting YouTube-only cookies from Chrome..."
echo "    (macOS will prompt for Keychain access — click Allow)"
echo ""

# Verify that the current browser session works before replacing the VM jar.
yt-dlp --simulate --no-playlist \
  --cookies-from-browser chrome \
  --js-runtimes node \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" >/dev/null

# Extract, filter, format as a Netscape cookie file, and pipe directly to the VM.
# No local file is written at any point.
python3 - <<PYEOF | "${SSH[@]}" "
  set -eu
  test -d '$REMOTE_DIR'
  candidate=\$(mktemp '$REMOTE_DIR/.cookies.XXXXXX')
  trap 'rm -f \"\$candidate\"' EXIT
  cat > \"\$candidate\"
  awk '
    BEGIN { count = 0; bad = 0 }
    /^#/ || NF == 0 { next }
    {
      count++
      domain = \$1
      if (domain !~ /(^|\\.)youtube\\.com\$/) bad = 1
    }
    END { if (count == 0 || bad) exit 1 }
  ' \"\$candidate\"
  # yt-dlp updates cookie expiry values and saves the jar on exit, so the pod
  # group needs write access as well as read access.
  chmod 0660 \"\$candidate\"
  mv -f \"\$candidate\" '$REMOTE_DEST'
  trap - EXIT
  echo 'Cookie jar replaced atomically'
"
import sys
from http.cookiejar import CookieJar
from yt_dlp.cookies import extract_cookies_from_browser

jar: CookieJar = extract_cookies_from_browser("chrome")

lines = ["# Netscape HTTP Cookie File", "# Filtered: youtube.com only", ""]
count = 0
for c in jar:
    domain = c.domain.lstrip(".").lower()
    if domain != "youtube.com" and not domain.endswith(".youtube.com"):
        continue
    secure = "TRUE" if c.secure else "FALSE"
    subdomain = "TRUE" if c.domain.startswith(".") else "FALSE"
    expires = str(int(c.expires)) if c.expires else "0"
    lines.append(f"{c.domain}\t{subdomain}\t{c.path}\t{secure}\t{expires}\t{c.name}\t{c.value}")
    count += 1

print("\n".join(lines), file=sys.stdout)
sys.stderr.write(f"Filtered {count} youtube.com cookies\n")
PYEOF

echo ""
echo "==> Verifying remote cookie file metadata..."
"${SSH[@]}" '
  FILE="/srv/mytube/cookies/cookies.txt"
  TOTAL=$(grep -c "^[^#]" "$FILE" 2>/dev/null || echo 0)
  echo "    Total cookies: $TOTAL"
  echo "    Domains present:"
  grep -v "^#" "$FILE" | awk "{print \$1}" | sort -u | sed "s/^/      /"
  echo "    Permissions: $(stat -c "%a %U:%G" "$FILE")"
  echo ""
  # Sanity check — every cookie must belong to youtube.com.
  BAD=$(grep -v "^#" "$FILE" | awk "{print \$1}" | grep -vE "(^|\.)youtube\.com$" || true)
  if [ -n "$BAD" ]; then
    echo "WARNING: unexpected domains found:"
    echo "$BAD"
  else
    echo "    Domain check passed — only youtube.com cookies present"
  fi
'
