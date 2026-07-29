# Deploy the native backend on the Mac Mini

The native package runs the API, worker, SQLite, and media storage in one
Apple Silicon process. It uses the Mac user's live browser session and is
published through the existing Mac Cloudflare Tunnel.

```text
Client
  -> Cloudflare
  -> cloudflared on the Mac
  -> http://127.0.0.1:8081
  -> native MyTube service
```

The implementation and cutover checklist is tracked in
[`native-macos-implementation-plan.md`](native-macos-implementation-plan.md).

## Build

Install the external runtime dependencies:

```bash
brew install yt-dlp ffmpeg deno
```

The package builder compiles only the Go service; yt-dlp is not embedded:

```bash
bash scripts/build-native-macos.sh
```

Output:

```text
backend/bin/mytube-darwin-arm64
```

## Install without changing traffic

Install and start the user LaunchAgent:

```bash
bash scripts/install-native-macos.sh install
```

This step:

- installs the binary under `~/Library/Application Support/MyTube/`;
- creates a mode-`0600` configuration file when one does not exist;
- migrates a legacy `.env` when present, preserving its API token, SQLite
  database, and download paths;
- runs `mytube doctor`;
- installs `com.mytube.server` as a user LaunchAgent;
- starts the service on `127.0.0.1:8081`.

It deliberately does not modify Cloudflare Tunnel configuration or DNS.

Mutable state:

```text
~/Library/Application Support/MyTube/
  mytube
  mytube.env
  mytube.db
  downloads/
```

Logs:

```text
~/Library/Logs/MyTube/server.log
```

## Service operations

```bash
bash scripts/install-native-macos.sh status
bash scripts/install-native-macos.sh start
bash scripts/install-native-macos.sh stop
bash scripts/install-native-macos.sh restart
bash scripts/install-native-macos.sh uninstall
```

Uninstalling the LaunchAgent preserves the configuration, database, downloads,
and installed binary.

Run diagnostics manually:

```bash
"$HOME/Library/Application Support/MyTube/mytube" doctor \
  --config "$HOME/Library/Application Support/MyTube/mytube.env"
```

## yt-dlp updates

Homebrew manages yt-dlp independently of MyTube:

```bash
bash scripts/install-native-macos.sh yt-dlp-status
brew upgrade yt-dlp
bash scripts/install-native-macos.sh restart
bash scripts/install-native-macos.sh yt-dlp-status
```

The installer requires `/opt/homebrew/bin/yt-dlp` and records that exact path
in `mytube.env`. This avoids the roughly ten-second startup cost observed with
the official standalone macOS executable.

## Browser authentication

The default native configuration uses:

```text
MYTUBE_COOKIE_BROWSER=chrome
MYTUBE_JS_RUNTIME=deno
```

The service must run as the logged-in macOS user so yt-dlp can access the
Chrome profile and macOS Keychain. On the first access, macOS may request
Keychain permission. Use a dedicated YouTube profile/account.

The service discovers `ffmpeg`, `ffprobe`, and Deno through `PATH`. Install
missing dependencies with Homebrew if `mytube doctor` reports warnings:

```bash
brew install yt-dlp ffmpeg deno
```

## Local verification

Before changing public traffic:

```bash
curl http://127.0.0.1:8081/health
```

Then enter the API token from the protected configuration into the frontend,
submit one short video, and verify:

- the job reaches `completed`;
- progress updates while downloading;
- playback succeeds;
- seeking returns `206 Partial Content`;
- restarting the LaunchAgent does not strand an active job.

## Cloudflare cutover

The Mac already runs cloudflared for `cal.elladali.com`. Add a MyTube ingress
rule to that existing tunnel:

```yaml
- hostname: mytubeapi.elladali.com
  service: http://127.0.0.1:8081
```

Keep the final catch-all rule:

```yaml
- service: http_status:404
```

Create an explicit `mytubeapi.elladali.com` DNS route to the Mac tunnel. The
explicit record overrides the wildcard that otherwise sends the hostname to
the VM tunnel.

After public health, authentication, a real download, and HTTP Range serving
are verified, scale the VM Deployment to zero. Do not delete its namespace,
PVC, PV, database, downloads, or wildcard DNS route.

Only then disable `com.mytube.cookie-refresh`, which is used solely to push
cookies to the VM deployment.

## Rollback

1. Restore `mytubeapi.elladali.com` to the VM tunnel.
2. Scale the retained k3s MyTube Deployment back to one replica.
3. Verify the Deployment, Service, Ingress, public endpoint, HTTP Range
   serving, and Prometheus metrics.

Stopping the Mac LaunchAgent does not remove its local data.
