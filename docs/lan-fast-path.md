# MyTube LAN fast path

The mobile app requires no router DNS override or per-device Wi-Fi settings.
It starts with the public endpoint:

```text
https://mytubeapi.elladali.com:8443
```

On home Wi-Fi, macOS advertises `MyTube._mytube._tcp.local` through Bonjour.
The server publishes that service only on the Mac's Wi-Fi interface (`en1`).
Bonjour therefore supplies the current Wi-Fi address without exposing the
VMware interfaces or depending on a fixed DHCP lease. A small LaunchAgent
supervisor keeps Caddy bound only to the current `en1` IPv4 address and restarts
it if DHCP changes that address. The app probes `/health` for the
`X-MyTube-LAN: 1` marker and then switches API, downloads, and media playback
to the discovered `.local` host on port 8083. Startup and resume perform three
discovery attempts with backoff, and the foreground app checks every 15 seconds
so it can switch as Bonjour becomes available. A known LAN endpoint is retained
while its health probe succeeds. If discovery, permission, or the probe fails,
the app stays on Cloudflare. Read requests and media initialization also retain
the public endpoint as a fallback.

## Components

- MyTube backend: `127.0.0.1:8081`, unchanged and not directly LAN-accessible.
- Caddy LaunchAgent: `com.mytube.caddy`.
- Bonjour advertiser LaunchAgent: `com.mytube.discovery`.
- Discovered LAN listener: the Mac's current home-network address on port 8083,
  advertised as `_mytube._tcp.local` only on Wi-Fi.
- Public tunnel listener: `127.0.0.1:8082`, HTTP and loopback-only.
- Compatibility HTTPS listener: port 8443 with a Let's Encrypt certificate.
- Public mobile endpoint: `https://mytubeapi.elladali.com:8443`.

The LAN listener still requires the per-device bearer credential. Its traffic
is private to the home network but is HTTP rather than end-to-end TLS, so the
home Wi-Fi/LAN is part of the trust boundary. The public fallback remains HTTPS.

Caddy obtains and renews its public certificate using HTTP-01 through the
existing Cloudflare Tunnel. The tunnel must continue routing the hostname to
Caddy's port 8082 for renewal.

## Operations

```bash
bash scripts/install-lan-proxy.sh status
bash scripts/install-lan-proxy.sh restart
```

Configuration and logs:

- `~/Library/Application Support/MyTube/Caddyfile`
- `~/Library/Application Support/MyTube/run-lan-proxy.sh`
- `~/Library/Application Support/MyTube/caddy-data/`
- `~/Library/LaunchAgents/com.mytube.caddy.plist`
- `~/Library/LaunchAgents/com.mytube.discovery.plist`
- `~/Library/Logs/MyTube/caddy.log`
- `~/Library/Logs/MyTube/discovery.log`
- `~/Library/Logs/MyTube/lan-access.log`

The access log redacts authorization headers by default.

## Verification

```bash
dns-sd -L MyTube _mytube._tcp local.
curl -i http://Liangs-Mac-mini.local:8083/health
curl https://mytubeapi.elladali.com:8443/health
```

The LAN health response must include `X-MyTube-LAN: 1`. Authenticated API and
byte-range checks must keep the bearer credential in a protected configuration
file and must never print it.

## Rollback

1. Run `bash scripts/install-lan-proxy.sh uninstall`.
2. Restore `~/.cloudflared/config.yml.pre-lan-proxy-20260830` if the loopback
   Caddy origin is also being removed.
3. Restart `com.mytube.cloudflared` only if that tunnel config was restored.
4. Rebuild the mobile app without LAN discovery if desired; otherwise it will
   simply remain on the public fallback when no service is advertised.

The router has no MyTube DNS mapping. The backend, database, downloads, and
device credentials are not modified by this routing layer.
