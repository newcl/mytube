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
        | /api/*         packaged yt-dlp      |
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
- embedded SQL migrations;
- a pinned, checksum-verified `yt-dlp_macos` payload.

The package extracts yt-dlp atomically into a versioned directory under
`~/Library/Application Support/MyTube/tools/`. An explicit
`MYTUBE_YTDLP_PATH` or managed `tools/yt-dlp/current/yt-dlp` can override the
packaged payload.

SQLite data and downloads remain external writable files:

```text
~/Library/Application Support/MyTube/
  mytube.db
  downloads/
  tools/
```

## Authentication

All `/api/*` and `/files/*` endpoints require
`Authorization: Bearer <MYTUBE_TOKEN>`.

HTML5 video requests cannot attach a custom authorization header, so
`/files/{id}` also accepts `?token=<MYTUBE_TOKEN>`. These URLs are sensitive.
Cloudflare security controls are an additional layer and do not replace
application authentication.

See [adr/0001-auth-bearer-token.md](adr/0001-auth-bearer-token.md).

## Download flow

1. A client posts `{url}` to `/api/jobs`.
2. The worker claims a queued job within the single process.
3. yt-dlp reads cookies directly from the configured browser profile.
4. The worker parses progress and throttles SQLite writes.
5. yt-dlp writes media and metadata to local storage.
6. The job becomes `completed` or `failed`.
7. The API serves completed or in-progress media with byte-range support.

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
- `mytube yt-dlp update --config <path>`
- `mytube yt-dlp rollback --config <path>`
- `mytube version`

`doctor` verifies the loopback bind, state paths, SQLite, selected yt-dlp,
browser-cookie configuration, ffmpeg/ffprobe, and JavaScript runtime without
printing secrets.

The yt-dlp updater maintains `current` and `previous` executable slots under
the Application Support tool directory. It uses yt-dlp's own release updater,
validates the updated executable, restores automatically on failure, and keeps
the embedded version unchanged as a final fallback.
