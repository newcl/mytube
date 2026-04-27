# MyTube — Architecture

## Overview

MyTube is a personal YouTube downloader with a web UI and Chrome extension. It is designed for single-user personal use, hosted on an Oracle Cloud VPS and Cloudflare Pages.

## Components

```
┌──────────────────────────────────────────────────────────┐
│ Chrome extension (MV3)                                    │
│   • reads current tab URL                                 │
│   • POST /api/jobs  →  api.mytube.elladali.com            │
└──────────────────────────────┬───────────────────────────┘
                               │
┌──────────────────────────────▼───────────────────────────┐
│ Frontend (Cloudflare Pages)                               │
│   mytube.elladali.com                                     │
│   React + Vite                                            │
│   • Submit URL form                                       │
│   • Job list with live progress (polling /api/jobs ~1s)   │
│   • <video> playback via /files/{id}?token=...            │
└──────────────────────────────┬───────────────────────────┘
                               │ HTTPS
┌──────────────────────────────▼───────────────────────────┐
│ Backend (Oracle VPS)                                      │
│   api.mytube.elladali.com                                 │
│                                                           │
│   ┌──────────────┐   ┌─────────────────────────────────┐ │
│   │  HTTP API    │   │  Download Worker                │ │
│   │  (chi)       │   │  • semaphore (MYTUBE_CONCURRENCY)│ │
│   │  /api/jobs   │   │  • exec yt-dlp                  │ │
│   │  /files/{id} │   │  • parse progress lines         │ │
│   └──────┬───────┘   └────────────┬────────────────────┘ │
│          │                        │                       │
│          └──────────┬─────────────┘                       │
│                     │                                     │
│              ┌──────▼──────┐                              │
│              │   SQLite    │                              │
│              │  (jobs,     │                              │
│              │   progress) │                              │
│              └─────────────┘                              │
│                                                           │
│   Disk: MYTUBE_DOWNLOAD_DIR (downloaded files)            │
└──────────────────────────────────────────────────────────┘
```

## Auth

All `/api/*` and `/files/*` endpoints require `Authorization: Bearer <MYTUBE_TOKEN>`.

For HTML5 `<video>` requests (which cannot set custom headers), `/files/{id}` additionally accepts `?token=<MYTUBE_TOKEN>` as a query parameter. This is documented as sensitive — acceptable for personal/private use only.

The WAF (Cloudflare) provides an additional layer of protection, but the app does not rely on it for authentication.

See [adr/0001-auth-bearer-token.md](adr/0001-auth-bearer-token.md).

## Data Flow — Download

1. Client POSTs `{ url }` to `/api/jobs` → job created with status `queued`.
2. Worker picks up queued job (up to `MYTUBE_CONCURRENCY` concurrent).
3. Worker sets status → `downloading`, invokes `yt-dlp` via `exec.CommandContext`.
4. Worker reads yt-dlp stdout line-by-line; parses progress lines (percent/speed/ETA).
5. Progress is written to DB at most ~2×/second (throttled).
6. On exit code 0 → status `completed`, `output_path` set.
7. On non-zero exit → status `failed`, last log lines stored.

## Progress (v1)

- UI polls `GET /api/jobs` every ~1 second.
- Backend stores `progress` as JSON in SQLite (`percent`, `speed`, `eta`, `downloaded_bytes`, `total_bytes`).
- yt-dlp is invoked with `--newline` to produce one progress line per update.

## File Serving

`GET /files/{id}`:
- Looks up job by ID in DB; verifies status = `completed` and `output_path` is set.
- Serves file with `http.ServeContent` for Range request support (206 Partial Content).
- Safe: no arbitrary filesystem reads — file path comes only from DB record.

## Job Lifecycle

```
queued → downloading → completed
                    ↘ failed
```

## Database

SQLite via `modernc.org/sqlite` (no CGO). Single file at `MYTUBE_DB_PATH`.

Schema is managed via embedded SQL migration files run on startup.

## Scalability Notes (personal use)

- 1 CPU / 1 GB RAM Oracle VPS — keep things light.
- yt-dlp + ffmpeg is CPU-heavy; recommended `MYTUBE_CONCURRENCY=1` or `2`.
- Progress DB writes are throttled to ~2×/s to reduce IO.
- No external queues/brokers — SQLite is sufficient for personal use.
