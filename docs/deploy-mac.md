# Deploy — Backend on Mac Mini (current setup)

The backend runs on an Apple Silicon Mac Mini at home, exposed via a Cloudflare
Tunnel. This replaces the original Oracle VPS design.

```
Client → Cloudflare edge → cloudflared tunnel → Mac Mini localhost:8081 → mytube-server
```

---

## Services managed by launchd

All four agents live in `~/Library/LaunchAgents/` and are managed by
`scripts/setup-mac.sh`.

| Label | Plist | Purpose |
|---|---|---|
| `com.mytube.server` | `LaunchAgents/com.mytube.server.plist` | Go HTTP API + worker |
| `com.mytube.cloudflared` | `LaunchAgents/com.mytube.cloudflared.plist` | Cloudflare Tunnel |
| `com.mytube.cookie-refresh` | `LaunchAgents/com.mytube.cookie-refresh.plist` | Pushes fresh YT cookies every 6 h |

Useful commands:

```bash
# Status
launchctl list | grep com.mytube

# Logs
tail -f ~/Library/Logs/mytube/server.log
tail -f ~/Library/Logs/mytube/cloudflared.log
tail -f ~/Library/Logs/mytube/cookie-refresh.log

# Restart a service
launchctl unload ~/Library/LaunchAgents/com.mytube.server.plist
launchctl load   ~/Library/LaunchAgents/com.mytube.server.plist
```

---

## Cloudflare Tunnel config

`~/.cloudflared/config.yml` — ingress rules:

| Hostname | Local target |
|---|---|
| `mytubeapi.elladali.com` | `http://localhost:8081` |
| `cal.elladali.com` | `http://localhost:3000` |

---

## Known issues & fixes

### 1. QUIC idle-timeout causes periodic 530 errors (fixed 2026-05-18)

**Symptom:** When accessing the API remotely (e.g. on a phone with a different
network), requests occasionally return HTTP 530 for a second or two.

**Root cause:** By default cloudflared uses QUIC (UDP). Home routers flush idle
UDP NAT table entries after ~60 seconds. cloudflared's four tunnel connections
all drop simultaneously when no traffic has passed recently. The connections
reconnect within ~1 s, but any request landing during that window gets a 530
from Cloudflare.

**Fix applied:** Added `protocol: http2` to `~/.cloudflared/config.yml`.
HTTP/2 uses persistent TCP connections which the router NAT keeps alive
indefinitely. `setup-mac.sh` now writes this setting when creating the config.

Verify it's active:
```bash
grep protocol ~/.cloudflared/config.yml
# → protocol: http2

tail -5 ~/Library/Logs/mytube/cloudflared.log | grep protocol
# → protocol=http2
```

---

### 2. Services don't start after a Mac restart (unattended reboot)

**Symptom:** After a power cut or macOS update reboot, the API is unreachable
until someone physically logs in to the Mac Mini.

**Root cause:** The agents use `~/Library/LaunchAgents/` which is a
*per-user* location. macOS only loads these after a GUI login session begins.
They cannot be moved to `/Library/LaunchDaemons/` (system level) because
`mytube-server` and `cookie-refresh` both need Keychain access to read Chrome
cookies via yt-dlp.

**Fix:** Enable automatic login so the user session starts at boot without
requiring someone to be present.

System Settings → Users & Groups → Login Options → Automatic login → select your
user account.

> This is appropriate for a single-user home server. Do not enable on a
> shared or publicly accessible machine.

---

### 3. Homebrew cloudflared agent conflict (fixed 2026-05-18)

**Symptom:** `launchctl list | grep cloudflare` showed two entries:
`com.mytube.cloudflared` (running) and `homebrew.mxcl.cloudflared` (exit 256,
not running). The Homebrew-managed plist has no tunnel config and fails
immediately on load.

**Fix applied:** Removed `~/Library/LaunchAgents/homebrew.mxcl.cloudflared.plist`.
`setup-mac.sh` now deletes this file automatically if it exists.

---

## Initial setup / re-setup

```bash
# From repo root
bash scripts/setup-mac.sh
```

Then follow the auto-login note printed at the end.
