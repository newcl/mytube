# MyTube — Coding Agent Handoff (Sonnet 4.6)

Date: 2026-04-27  
Owner: `newcl`  
Repository: `newcl/mytube` (**PRIVATE**)  
Product: personal/private YouTube downloader + library UI + Chrome extension

## 1) Mission

Build **MyTube**, a private personal product that:

- Lets me queue YouTube downloads using **yt-dlp** (installed on the backend VM)
- Tracks jobs and metadata in **SQLite**
- Shows **live download progress** in a web UI
- Serves downloaded files from host disk with **HTTP Range** support so they can be **played in-browser**
- Provides a **Chrome extension** button to send the current tab URL to the backend (fire-and-forget; optional notification)
- Frontend is deployed to **Cloudflare Pages** and served at `https://mytube.elladali.com`
- Backend runs on an **Oracle Cloud VPS** (1 CPU, 1GB RAM, 100GB disk) and served at `https://api.mytube.elladali.com`
- The product is for **personal use only** and behind WAF; still require an API token

Deliver the project incrementally using a “Spec → Plan → Execute → Verify” loop and small PRs per phase.

---

## 2) Fixed decisions (do not change unless asked)

### Hosting / domains
- Frontend origin: `https://mytube.elladali.com` (Cloudflare Pages)
- Backend origin: `https://api.mytube.elladali.com` (Oracle VPS behind WAF)

### Auth
- Backend requires `Authorization: Bearer <MYTUBE_TOKEN>` for:
  - all `/api/*`
  - all `/files/*`
- The WAF is an additional layer; do not rely on it for app auth.

### Download scope
- MVP supports **single YouTube video URL**.
- Design should leave room to add playlist/channel later:
  - DB schema + code should not block new “job types” or “sources”.

### Concurrency
- Default: **3** concurrent downloads
- Configurable via env var

### Progress
- Provide **live progress** (percent/speed/ETA) in UI
- Implement via **backend parsing yt-dlp output and storing progress in SQLite**
- UI can use **polling** (every ~1–2s) for v1.

### Playback
- Browser playback through native HTML5 `<video>` is acceptable.
- Backend must implement **Range requests** (206 Partial Content) for smooth playback/scrubbing.

---

## 3) Repo creation + structure (must do first)

### Create private repo
Use `gh`:

```bash
gh repo create newcl/mytube --private --description "Personal yt-dlp downloader with web UI + chrome extension" --confirm
gh repo clone newcl/mytube
cd mytube
```

### Monorepo layout
Create:

```
mytube/
  backend/                # Go API + worker
  frontend/               # Cloudflare Pages UI
  extension/              # Chrome extension (MV3)
  docs/
    adr/
  scripts/
    systemd/
  .github/workflows/
  README.md
  LICENSE (optional)
```

### Add baseline docs
- `README.md`: high-level overview, local dev, deployment pointers
- `docs/architecture.md`: components, data flow, auth, progress strategy
- `docs/adr/0001-auth-bearer-token.md`: record auth choice
- `docs/AGENT_HANDOFF.md`: this document (keep updated as you implement)

---

## 4) Backend (Go + SQLite) — requirements

### Tech constraints
- Oracle VPS: 1 CPU / 1GB RAM → keep dependencies light, avoid heavy background polling, throttle DB writes.
- `yt-dlp` is installed on host and invoked via `exec.CommandContext`.

### Go implementation guidance
- Prefer:
  - Router: `chi` (or `gin`, but pick one)
  - SQLite driver: `modernc.org/sqlite` (avoid CGO)
- DB migrations:
  - simplest: run SQL migrations on startup from embedded files (or a minimal migration table)
  - keep it easy to deploy

### Environment variables
Backend must support:

- `MYTUBE_BIND` (default `:8080`)
- `MYTUBE_TOKEN` (**required**)
- `MYTUBE_DB_PATH` (default `./data/mytube.db`)
- `MYTUBE_DOWNLOAD_DIR` (default `./data/downloads`)
- `MYTUBE_CONCURRENCY` (default `3`)
- `MYTUBE_CORS_ORIGIN` (default `https://mytube.elladali.com`)
- `MYTUBE_PUBLIC_BASE_URL` (optional; e.g. `https://api.mytube.elladali.com`, used when building links)

### Job lifecycle
Statuses:
- `queued`
- `downloading`
- `completed`
- `failed`

### yt-dlp default behavior (v1)
- Use a **reasonable default preset** that tends to produce playable output:
  - Choose best available and prefer mp4 if possible (but do not overcomplicate)
- Ensure output filenames are stable and safe:
  - Recommended template: `%(title).200B-%(id)s.%(ext)s`
- Store metadata where applicable:
  - title
  - uploader/channel (if available)
  - extractor
  - webpage_url
  - thumbnail (URL or downloaded path — URL is fine for v1)
- Capture stdout/stderr:
  - store a capped “log tail” per job (e.g., last 32KB)

### Progress parsing (v1)
- Must implement live progress.
- Use yt-dlp options that produce parseable per-line progress output.
- Update DB progress fields at most ~2x/second (throttle) to reduce IO.

---

## 5) Backend API contract (v1)

All endpoints require Bearer token.

### `POST /api/jobs`
Request:
```json
{
  "url": "https://www.youtube.com/watch?v=..."
}
```

Response:
```json
{ "id": 123 }
```

Validation:
- url must be non-empty and parse as URL
- for v1, accept any URL but expect YouTube; do not hardcode too strictly

### `GET /api/jobs?limit=50`
Response (example):
```json
[
  {
    "id": 123,
    "url": "...",
    "status": "downloading",
    "created_at": "2026-04-27T00:00:00Z",
    "updated_at": "2026-04-27T00:01:00Z",
    "title": "Video title",
    "uploader": "Channel",
    "thumbnail_url": "https://....",
    "output_path": "data/downloads/....mp4",
    "error": "",
    "progress": {
      "percent": 42.1,
      "speed": "1.2MiB/s",
      "eta": "00:35",
      "downloaded_bytes": 12345678,
      "total_bytes": 45678901
    }
  }
]
```

### `GET /api/jobs/{id}`
Returns the full record (same structure as list).

### `GET /api/jobs/{id}/log`
Returns:
```json
{ "tail": "last lines..." }
```

### `GET /files/{id}`
- Streams the completed file for job `{id}`
- Must support `Range` requests
- Must 404 if job not completed or file missing
- Must not allow arbitrary filesystem reads (ID → DB lookup → exact file)

---

## 6) Frontend (Cloudflare Pages) — requirements

### Goals
- Provide a simple library UI:
  - submit URL to download
  - list jobs with status
  - show **live progress**
  - for completed jobs: **play in browser** and offer download link

### Implementation notes
- Stack: React + Vite is OK (simple and common).
- Store `API_BASE_URL` and `TOKEN` in localStorage via a “Settings” panel OR build-time env vars.
- Poll `/api/jobs` every 1–2 seconds for progress updates (v1).
- For playback:
  - use native `<video controls>` pointing to `${API_BASE_URL}/files/${id}`
  - include token in request: since `<video>` cannot easily attach headers, prefer **token via signed URL** OR cookie-based auth OR query token.
  - **Important**: decide approach early.

#### Playback auth constraint (must solve)
HTML5 video requests do not include custom Authorization headers. Choose ONE approach:

**Option A (recommended for v1 simplicity):** token in query string for file endpoint only  
- e.g. `/files/{id}?token=...`
- Backend accepts either Bearer header OR `?token=` for `/files/*` only.
- Document that URLs are sensitive; acceptable for private personal use.

**Option B:** cookie-based session  
- more complex; not necessary for v1.

For v1, implement **Option A**.

Also apply same approach for frontend if you want to avoid headers, but it’s fine for fetch() calls to use Authorization header.

---

## 7) Chrome Extension (MV3) — requirements

### Behavior
- Clicking the extension action button:
  - reads current tab URL
  - sends `POST ${API_BASE_URL}/api/jobs` with `{url: tabUrl}`
  - fire-and-forget
  - if possible, show notification “Queued” or “Failed”

### Configuration
- Options page:
  - API base URL (default: `https://api.mytube.elladali.com`)
  - token
- Store settings in `chrome.storage.sync` or `chrome.storage.local`

### Permissions
- `activeTab`
- `storage`
- `notifications` (optional)
- Host permissions: `${API_BASE_URL}/*` (or `<all_urls>` avoided if possible)

---

## 8) Deployment (must document and provide scripts)

### Backend on VPS
Provide:
- `scripts/systemd/mytube.service` (systemd unit)
- `docs/deploy-vps.md` including:
  - install yt-dlp
  - install ffmpeg (recommended for merges)
  - create directories: DB + downloads
  - set env vars (token, dirs, concurrency)
  - run as a dedicated user
- Reverse proxy guidance:
  - Caddyfile or nginx config snippet for TLS + proxy to `:8080`
  - Must allow large responses + range requests

### Frontend on Cloudflare Pages
Provide:
- `docs/deploy-cloudflare-pages.md`
- build instructions and env var notes
- domain mapping to `mytube.elladali.com`

---

## 9) Phased delivery plan (PRs)

Make separate PRs, in order:

### PR 1 — Repo bootstrap + docs
- Create structure, README, architecture doc, ADR auth
- Add minimal tooling (`Makefile` optional)

Acceptance:
- repo exists private under `newcl`
- docs render and explain architecture

### PR 2 — Backend foundation (API + SQLite + auth)
- migrations, job create/list/get, auth middleware, CORS

Acceptance:
- `POST /api/jobs` creates queued job
- `GET /api/jobs` lists jobs
- 401 without token

### PR 3 — Worker + download execution + metadata
- background worker, concurrency semaphore
- invoke yt-dlp, write metadata, output_path, status

Acceptance:
- queued job downloads successfully on a machine with yt-dlp installed

### PR 4 — Live progress
- parse yt-dlp progress output
- persist progress to DB
- job list/detail includes progress fields

Acceptance:
- progress fields update during download

### PR 5 — File streaming w/ Range + token query support
- `GET /files/{id}`
- Range support
- accept `?token=` for `/files/*` only

Acceptance:
- can play completed file in browser, scrub works

### PR 6 — Frontend MVP
- submit URL, list jobs, progress, playback via `<video>` using file URL with token query

Acceptance:
- end-to-end works from web UI

### PR 7 — Chrome extension MVP
- button queues current tab URL
- options page for API base URL + token
- optional notification

Acceptance:
- click on YouTube page, job appears in UI and downloads

### PR 8 — Deployment docs + scripts
- systemd unit + reverse proxy examples
- Cloudflare Pages guide

Acceptance:
- docs allow reproducible deployment

---

## 10) Testing / quality gates

### Backend
- `go test ./...` must pass
- basic linting preferred (`golangci-lint` optional)
- include at least:
  - auth middleware unit test
  - URL validation unit test
  - DB query tests where feasible

### Frontend
- `npm run build` must pass
- keep dependencies minimal

### Extension
- include a “How to load unpacked extension” doc

---

## 11) Risk notes / constraints (be mindful)

- SQLite write amplification from progress updates → throttle updates.
- yt-dlp + ffmpeg can be CPU-heavy; concurrency default 3 might be high on 1 CPU.
  - Implement concurrency config and document recommended values (1–2) for small VM.
- Storing token in query string is acceptable for personal/private use but must be documented clearly as sensitive.
- Ensure file serving is safe: only serve files mapped by job id from DB.

---

## 12) First actions checklist (agent)

1. Create private repo `newcl/mytube` via `gh`.
2. Bootstrap structure + docs (PR 1).
3. Implement backend foundation with migrations and API (PR 2).
4. Continue through PR 8 sequentially, keeping PRs small and mergeable.

---

## 13) Completion criteria (project-level)

Project is complete when:

- Extension → backend → download → UI playback works end-to-end
- Live progress visible while downloading
- Jobs and metadata persist across restarts (SQLite)
- Files served safely with Range support
- Deployment docs allow setup on Oracle VPS + Cloudflare Pages + domains