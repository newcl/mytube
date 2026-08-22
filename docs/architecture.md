# MyTube architecture

## Target deployment

MyTube is a private, single-user YouTube downloader. The frontend remains on
Cloudflare Pages; the backend runs as one native Apple Silicon service on the
always-on Mac Mini.

```text
Chrome extension                 Cloudflare Pages frontend
        |                                  |
        +--------------- HTTPS ------------+
                           |
                 mytubeapi.elladali.com
                           |
                     Cloudflare Tunnel
                     on the Mac Mini
                           |
                   127.0.0.1:8081
                           |
        +------------------+------------------+
        | native MyTube Go service            |
        |                                     |
        | HTTP API       download worker      |
        | /api/*         Homebrew yt-dlp      |
        | /files/*       Chrome + Keychain    |
        |                                     |
        | SQLite         local media storage  |
        +------------------+------------------+
```

The k3s deployment on `miniu1` is retained as a rollback target during the
native migration. Its storage is not shared with the Mac service.

## Native package

The Go executable includes:

- the chi HTTP API;
- the download worker and progress parser;
- the pure-Go SQLite engine;
- embedded SQL migrations.

yt-dlp is an external dependency. Native installs select
`/opt/homebrew/bin/yt-dlp` through `MYTUBE_YTDLP_PATH`; other deployments may
discover it through `PATH`. Keeping yt-dlp outside the Go binary avoids the
standalone macOS executable's startup delay and reduces package size.

SQLite data and downloads remain external writable files:

```text
~/Library/Application Support/MyTube/
  mytube.db
  downloads/
```

## Authentication

The frontend is protected by Cloudflare Access and sends same-origin requests
to a route-limited Pages Function. The Function verifies the Access assertion
and adds the backend master token from an encrypted environment binding. The
browser never receives or stores that token, including in media URLs.

The iOS app uses a unique device credential stored in Keychain. A signed-in web
session creates a five-minute, one-use QR pairing code; the phone exchanges it
directly with the API. The backend stores hashes of device credentials and the
web UI can revoke each device independently. Master-token authentication is
reserved for the Pages Function and trusted administration.

See [ADR 0002](adr/0002-zero-trust-mobile-pairing.md).

## Download flow

1. A client posts `{url}` to `/api/jobs`.
2. The worker claims a queued job within the single process.
3. yt-dlp reads cookies directly from the configured browser profile.
4. With live browser authentication, yt-dlp validates and prefers the combined
   direct MP4; inaccessible direct URLs fall through to HLS.
5. HLS downloads fetch up to four media fragments concurrently.
6. The worker parses progress and throttles SQLite writes.
7. yt-dlp writes media and metadata to local storage.
8. The job becomes `completed` or `failed`.
9. The API serves completed or in-progress media with byte-range support.

Jobs left in `downloading` after an unclean service exit are returned to
`queued` during the next startup.

## Runtime and security model

- The origin binds to `127.0.0.1:8081`.
- cloudflared makes an outbound connection and publishes the origin.
- MyTube runs as a user LaunchAgent, not as root.
- The API token is stored in a mode-`0600` external configuration file.
- Browser cookies are read from the live browser store; they are not exported
  into the repository or application data directory.
- SQLite uses WAL mode and a single writer connection.
- Download concurrency defaults to two on macOS.

## File serving

`GET /files/{id}` resolves the path through the SQLite job record and delegates
range handling to Go's HTTP file server. Arbitrary client-provided paths are
never accepted.

## Operational commands

The same executable provides:

- `mytube serve --config <path>`
- `mytube doctor --config <path>`
- `mytube yt-dlp status --config <path>`
- `mytube version`

`doctor` verifies the loopback bind, state paths, SQLite, selected yt-dlp,
browser-cookie configuration, ffmpeg/ffprobe, and JavaScript runtime without
printing secrets.

On macOS, Homebrew owns yt-dlp updates. Run `brew upgrade yt-dlp`, then restart
MyTube so `doctor` and the startup log confirm the selected version.
