# Mytube telemetry implementation tracker

Last updated: 2026-08-21

Legend: `[ ]` pending, `[~]` in progress, `[x]` complete, `[!]` blocked.

## Phase 1: backend operational foundation

- [x] Record the accepted architecture and privacy constraints.
- [x] Add a dedicated metrics configuration (`MYTUBE_METRICS_BIND` and
      `MYTUBE_METRICS_TOKEN`) that is disabled by default.
- [x] Add an isolated Prometheus registry with Go/process/build metrics.
- [x] Instrument bounded HTTP route templates, status classes, latency, bytes,
      and in-flight requests.
- [x] Instrument download starts, active downloads, outcomes, duration, and HLS
      fallback.
- [x] Serve metrics from a separate bearer-protected listener.
- [x] Add configuration, authentication, middleware, and metric recorder tests.
- [x] Run `go test ./...`, `go test -race ./...`, and native macOS build.
- [x] Document configuration and rollout without placing secrets in Git.

## Phase 2: Prometheus and public probing

- [x] Identify and verify the stable private Mac address reachable from the VM.
- [x] Create a dedicated metrics token outside Git.
- [x] Install the metrics bind/token in the native Mac service configuration.
- [x] Add the token as a Kubernetes Secret.
- [x] Add a private Mytube scrape job to the Prometheus configuration.
- [x] Deploy Blackbox Exporter and probe the public health endpoint.
- [x] Add origin/public availability and latency recording rules.
- [~] Verify backend-down, tunnel-down, and public-path-down scenarios.
- [x] Update homelab `execution-todo.md` and `handoff.md`.

## Phase 3: analytics ingestion and storage

- [x] Define the versioned batch schema and allowlisted properties.
- [x] Add authenticated `POST /api/telemetry/events`.
- [x] Create separate `analytics.sqlite` migrations.
- [x] Add event-ID deduplication and payload/batch limits.
- [x] Add 90-day raw-event cleanup and daily rollups.
- [x] Export bounded ingestion and product-event metrics.
- [x] Add API, persistence, retention, and concurrency tests.

## Phase 4: frontend telemetry

- [x] Add a typed, dependency-free telemetry client.
- [x] Add local batching, keepalive delivery, retry, and expiry.
- [x] Instrument app, video, player recovery, playlist, and download events.
- [x] Add an analytics preference and privacy copy.
- [x] Test offline retry, deduplication, and sensitive-property rejection.

## Phase 5: mobile telemetry

- [x] Add a typed Flutter telemetry client and durable local queue.
- [x] Instrument app, video, player recovery, playlist, and download events.
- [x] Add an analytics preference and privacy copy.
- [x] Test airplane-mode recovery and bounded storage.
- [x] Document required App Store privacy responses before distribution.
- [~] Build, sign, install, and verify on the physical iPhone.

## Phase 6: dashboards and operations

- [ ] Deploy Grafana OSS in `monitoring` with persistent storage.
- [ ] Protect Grafana with Cloudflare Access.
- [ ] Provision the Mytube Prometheus dashboard.
- [ ] Add alerts for origin/public availability, API failures, download failures,
      and playback recovery failures.
- [ ] Document retention, backup, restore, and telemetry troubleshooting.
- [ ] Perform and record an end-to-end outage exercise.

## Decisions and evidence

- Mytube backend runs as a native Mac LaunchAgent on `127.0.0.1:8081`; the old
  k3s workload is retained only for rollback.
- Prometheus runs in the VM k3s `monitoring` namespace.
- Product analytics remain first-party; Google Analytics is not part of the
  initial implementation.
- Detailed events use SQLite; Prometheus receives only bounded aggregates.
- The native metrics listener is bound only to the VMware private interface at
  `192.168.234.1:9091`; the public API remains loopback-only on
  `127.0.0.1:8081`.
- Prometheus release revision 8 scrapes the native endpoint every 15 seconds
  through a dedicated Kubernetes Secret and probes the public `/health` path
  every 30 seconds through an internal-only Blackbox Exporter.
- The metrics credential exists only in the protected native configuration and
  Kubernetes Secret; temporary transfer and verification files were removed.
- Both Mytube targets were verified healthy with `up=1`, `probe_success=1`, and
  `mytube_build_info=1`. All six Mytube rules report `health=ok`.
- Alertmanager is still intentionally disabled, so alerts are visible in
  Prometheus but do not yet send notifications.
- Non-disruptive authentication and live-path checks passed. Controlled origin
  and tunnel outage exercises remain pending so this rollout did not interrupt
  the production service.
- Native rollback backup:
  `~/Library/Application Support/MyTube/backups/telemetry-20260821-2225/`.
- Prometheus rollback backup:
  `/var/backups/mytube-prometheus/20260821-2225/` on `miniu1`.
- Backend metrics use `github.com/prometheus/client_golang` v1.24.1 with a
  private registry rather than the process-global registry.
- Unknown HTTP methods and download outcomes collapse to bounded labels; HTTP
  paths use Chi route templates instead of raw paths.
- The metrics endpoint rejects missing/wrong credentials and query-string
  credentials; only the dedicated bearer header is accepted.
- Verification on 2026-08-21: `go test ./...`, `go test -race ./...`, and
  `bash scripts/build-native-macos.sh` all passed.
- Phase 3 uses a strict schema-version-1 allowlist documented in
  `docs/telemetry-api.md`; unknown fields and sensitive metadata are rejected.
- Analytics use a separate WAL-mode SQLite database with single-writer access,
  transactional deduplication/rollups, a 90-day raw retention task, and no raw
  event dependency in playback or download paths.
- Batches are limited to 50 events and 64 KiB. Event timestamps may be up to 30
  days old for offline delivery, and stable event IDs make retries idempotent.
- Phase 3 is installed in the live native service. The authenticated endpoint
  returned `401` without a token and rejected an authenticated invalid schema
  with `400`; this verified routing without storing a product event. The
  separate live analytics database was created successfully.
- Metrics binding is now an optional retrying subsystem. If VMware Fusion is
  stopped and `192.168.234.1` is absent during an app restart, the API remains
  available while metrics retry every 30 seconds.
- The frontend client is source-complete but not deployed. It uses a bounded
  500-event local queue, 50-event batches, 30-day expiry, exponential retry,
  authenticated keepalive requests, and clears queued data when disabled.
- `sendBeacon` is intentionally not used because it cannot attach the required
  bearer authorization header. `fetch(..., {keepalive: true})` preserves both
  secure authentication and page-exit delivery.
- Full frontend verification passes: 30 Vitest tests, zero-warning ESLint, and
  the production Vite build. The obsolete duplicate URL-extractor test and
  removed ESLint CLI flag were corrected during this phase.
- Mobile telemetry uses the same 500-event/50-event-batch/30-day queue policy,
  stores its queue in the existing Keychain-backed storage, retries offline
  delivery, and flushes on app lifecycle transitions. All 12 Flutter tests and
  `flutter analyze` pass.
- The API credential previously embedded as a mobile/share-extension fallback
  was removed from source. Existing upgrades retain the credential in Keychain;
  fresh installs must save it in Settings.
- The signed iOS 1.0.0 build was installed on the paired iPhone 13 mini. Remote
  launch verification is pending because the CoreDevice wireless tunnel timed
  out; unlock and one manual app launch are required to finish this gate.
- App Store disclosure guidance is recorded in
  `docs/telemetry-privacy.md`: Product Interaction data for Analytics/App
  Functionality, not linked to identity and not used for tracking.
