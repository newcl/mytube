# Native macOS MyTube implementation plan

Date: 2026-07-23

## Goal

Run MyTube as one native service on the always-on Apple Silicon Mac Mini:

```text
mytubeapi.elladali.com
  -> explicit DNS route to the Mac Cloudflare Tunnel
  -> http://127.0.0.1:8081
  -> native MyTube Go service
  -> SQLite + downloads on the Mac
  -> yt-dlp using the Mac user's live browser session
```

The VM deployment remains intact as a rollback target until the Mac service is
verified through Cloudflare. The cutover must not delete the k3s namespace,
PersistentVolume, database, downloads, or wildcard DNS route.

## Decisions

- Reuse the existing Go API, worker, SQLite schema, progress reporting, and
  HTTP Range file serving.
- Build for `darwin/arm64`.
- Run as a macOS user LaunchAgent so `yt-dlp --cookies-from-browser` can use
  the user's Chrome profile and macOS Keychain.
- Bind the origin to `127.0.0.1:8081`; only Cloudflare Tunnel publishes it.
- Store mutable state outside the executable under:
  `~/Library/Application Support/MyTube/`.
- Treat `yt-dlp` as a managed packaged tool:
  - a pinned executable can be embedded at build time;
  - it is extracted to the Application Support tool directory;
  - an explicitly configured executable can override the packaged copy;
  - diagnostics report the selected path and version.
- Do not store browser cookies, API tokens, tunnel credentials, or other
  secrets in Git.
- Keep the current bearer-token API contract so the frontend and extension do
  not need a coordinated rewrite.

## Packaging model

The Go binary contains the SQLite engine and optionally a pinned
`yt-dlp_macos` payload. SQLite data remains a writable external database file.
At runtime, packaged tools are materialized under a versioned directory:

```text
~/Library/Application Support/MyTube/
  mytube.db
  downloads/
  tools/
    yt-dlp/<version>/yt-dlp
```

`ffmpeg`, `ffprobe`, and a supported JavaScript runtime are discovered through
explicit configuration first and `PATH` second. Packaging those large,
independently updated runtimes is outside the first implementation.

Service logs live separately under `~/Library/Logs/MyTube/`.

## Implementation tracker

### Phase 1 — plan and baseline

- [x] Record architecture, safety constraints, phases, and verification gates.
- [x] Capture the current backend test baseline.
- [x] Confirm the current macOS build succeeds.

### Phase 2 — runtime and packaged tool support

- [x] Separate application startup from process entrypoint so commands and
      tests can reuse configuration safely.
- [x] Add macOS-aware default paths without changing Linux/container defaults.
- [x] Add an explicit `MYTUBE_YTDLP_PATH` override.
- [x] Add packaged `yt-dlp` extraction with versioned, atomic installation and
      executable permissions.
- [x] Make the worker invoke the resolved executable instead of assuming
      `yt-dlp` is on `PATH`.
- [x] Add build tooling that verifies the pinned payload checksum before
      embedding it.
- [x] Keep source builds functional when no payload has been staged.

### Phase 3 — operations

- [x] Add a `version` command.
- [x] Add a `doctor` command that checks state directories, SQLite, yt-dlp,
      browser-cookie configuration, JavaScript runtime, ffmpeg, and bind
      configuration without exposing secrets.
- [x] Add graceful interrupted-job recovery on service startup.
- [x] Add a user LaunchAgent installer with an external, permission-restricted
      environment file.
- [x] Add uninstall/stop/status operations that preserve application data.
- [x] Add a repeatable native package build script.

### Phase 4 — verification

- [x] Run Go formatting and all backend tests.
- [x] Add unit tests for default paths, tool resolution/extraction, and
      interrupted-job recovery.
- [x] Build and inspect the `darwin/arm64` executable.
- [x] Run the diagnostics command locally.
- [x] Verify the service binds only to `127.0.0.1`.
- [x] Verify API authentication and HTTP byte-range behavior locally.
- [x] Verify one real browser-authenticated YouTube download on the Mac.

Verification evidence:

- Native package size: approximately 53 MiB.
- Packaged yt-dlp: `2026.07.04`, verified against the pinned SHA-256.
- Local health returned HTTP `200`.
- Unauthenticated `/api/jobs` returned HTTP `401`; authenticated access
  returned HTTP `200`.
- A browser-authenticated download of the 19-second public video
  `jNQXAC9IVRw` reached `completed`.
- A one-byte media range request returned HTTP `206` with
  `Content-Range: bytes 0-0/635502`.
- The interrupted-job recovery behavior is covered by a database unit test.

### Phase 5 — cutover (infrastructure change)

- [x] Back up the Mac SQLite database and record whether the cutover uses a
      clean database or migrated VM data.
- [x] Install and start the user LaunchAgent.
- [x] Verify local health, authenticated API access, download, playback, and
      restart recovery.
- [x] Add an explicit `mytubeapi.elladali.com` route to the existing Mac
      Cloudflare Tunnel.
- [x] Verify public health, authentication, job progress, and HTTP 206 serving.
- [x] Remove the k3s MyTube Deployment, Service, and Ingress without deleting
      its namespace, PVC, PV, database, downloads, or cookie jar.
- [x] Disable the obsolete Mac-to-VM cookie refresh only after successful
      public verification.
- [x] Update the homelab execution tracker and handoff.

Mac installation evidence:

- The legacy Mac library was selected rather than VM data: 43 completed jobs
  and approximately 18 GiB of downloads were preserved.
- Pre-install SQLite backup:
  `~/Library/Application Support/MyTube/backups/mytube-20260723-before-native-install.db`.
- `com.mytube.server` is enabled and running as a user LaunchAgent.
- The origin listens only on `127.0.0.1:8081`.
- Local health returned HTTP `200`; unauthenticated API access returned
  HTTP `401`; authenticated access returned HTTP `200`.
- A new browser-authenticated download completed in the installed LaunchAgent
  context and returned HTTP `206` for a byte-range request.
- The verification job and all of its media/subtitle artifacts were removed.
- A managed LaunchAgent restart returned to HTTP `200`.
- The exact `mytubeapi.elladali.com` DNS record targets the Mac tunnel while
  the wildcard continues to target the VM tunnel for other applications.
- Public health and authenticated API access return HTTP `200`; public
  byte-range serving returns HTTP `206`.
- The k3s Deployment, Service, and Ingress were removed. The `mytube`
  namespace, bound 75 GiB retained PVC/PV, `/srv/mytube` data, SQLite database,
  downloads, and cookie jar remain as rollback assets.
- The obsolete `com.mytube.cookie-refresh` LaunchAgent and its installed copy
  of the push script were removed.

## Verification gates

Implementation is ready for cutover only when:

1. `go test ./...` passes.
2. A `darwin/arm64` package builds reproducibly.
3. `mytube doctor` succeeds in the intended LaunchAgent user context.
4. A real job completes using browser cookies without exporting a cookie jar.
5. A completed file supports local HTTP Range requests.
6. Restarting the service does not strand a job in `downloading`.

Cutover is complete only when the same health, authenticated job, and HTTP
Range checks pass through `https://mytubeapi.elladali.com`.

## Rollback

Before public cutover, rollback is simply stopping the Mac LaunchAgent.

After public cutover:

1. Restore the previous DNS route to the VM tunnel.
2. Scale the existing k3s Deployment back to one replica.
3. Verify its workload, Service, Ingress, public route, file serving, and
   Prometheus metrics.

No retained VM data is removed during the migration.

## Lightweight yt-dlp maintenance

- [x] Add `yt-dlp status`, `yt-dlp update`, and `yt-dlp rollback` commands.
- [x] Seed a managed executable from the packaged fallback.
- [x] Use yt-dlp's own stable-channel updater without rebuilding MyTube.
- [x] Verify the updated executable and restore the previous copy on failure.
- [x] Keep current and previous managed slots for one-command rollback.
- [x] Add a one-command LaunchAgent workflow that updates, restarts, waits for
      health, and reports the selected version.
- [x] Add unit tests for successful update/rollback and failed-update recovery.
- [x] Install and verify the updater-enabled native binary.
- [x] Run the update checker inside the macOS app five minutes after startup
      and weekly thereafter, without a second LaunchAgent.
- [x] Switch new jobs to an atomically installed update without interrupting
      active downloads.

Verification evidence:

- `bash scripts/install-native-macos.sh update-yt-dlp` confirmed that
  stable `2026.07.04` is current.
- The restarted service selected the managed executable.
- Current and previous copies match the verified packaged SHA-256.
- Public health and authenticated API access return HTTP `200`; public
  byte-range serving returns HTTP `206`.
