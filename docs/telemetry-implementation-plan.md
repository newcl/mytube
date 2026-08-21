# Mytube telemetry implementation plan

Status: accepted for implementation on 2026-08-21

## Goals

- Distinguish backend, Mac host, Cloudflare Tunnel, public-route, frontend, and
  mobile-player failures.
- Measure download reliability, API performance, playback reliability, and
  playlist engagement without adding a paid service.
- Keep detailed product analytics first-party and avoid collecting video URLs,
  titles, API tokens, email addresses, or stable device identifiers.
- Reuse the Prometheus installation in the homelab and add Grafana OSS only as
  a presentation layer.

## Architecture

### Operational metrics

The Go backend exposes Prometheus metrics from a dedicated HTTP listener. The
VM Prometheus server scrapes that listener over a private Mac-to-VM path using
a dedicated bearer token. The application API remains bound to loopback and
continues to be published through Cloudflare Tunnel.

Prometheus owns numeric time-series data used for dashboards and alerts:

- request count, status class, latency, response bytes, and in-flight requests;
- active media streams, range requests, and bytes served;
- queued, active, completed, and failed downloads;
- download duration and yt-dlp fallback/failure counts;
- backend process/runtime and build information;
- accepted and rejected client telemetry events.

A Blackbox Exporter probe checks the public health URL independently. Comparing
the private origin target with the public probe separates backend failures from
tunnel, DNS, ISP, or Cloudflare-path failures.

### Product analytics

The frontend and mobile app send low-volume semantic events to an authenticated
backend endpoint. The backend validates a versioned allowlist, deduplicates by
event ID, and stores events in a separate local `analytics.sqlite` database.
Raw events are retained for 90 days; daily aggregates are retained until the
user changes the policy.

Clients must queue events locally during transient outages and retry in small
batches. They must not contact Prometheus, Pushgateway, or Grafana directly.

Initial event vocabulary:

- `app_opened`
- `video_started`
- `video_completed`
- `playback_failed`
- `playback_recovered`
- `playback_started_over`
- `playlist_started`
- `playlist_item_completed`
- `playlist_item_skipped`
- `playlist_completed`
- `download_submitted`
- `download_failed`

Allowed common properties are client (`web` or `ios`), app version, playback
mode, retry count, elapsed seconds, and non-identifying outcome codes. Event
IDs and session IDs may be stored in SQLite for deduplication and session
analysis but must never become Prometheus labels.

### Dashboards and alerts

Grafana OSS runs in the existing `monitoring` namespace, reads the existing
Prometheus data source, and is protected by Cloudflare Access.

The first dashboard should answer:

1. Is the private Mytube origin up?
2. Is the public route up, and how does its latency compare with the origin?
3. What are API error ratio and p50/p95 latency by bounded route template?
4. How many downloads succeed, fail, or use HLS fallback?
5. How often do web and iOS playback fail and recover?
6. How many playback and playlist sessions complete?

Initial alerts:

- private origin unavailable;
- public probe unavailable while the origin remains healthy;
- elevated API 5xx ratio;
- repeated download failures;
- elevated playback failure or failed-recovery ratio;
- Prometheus target missing.

## Metric design rules

- Prefix application metrics with `mytube_`.
- Use counters for totals, gauges for current state, and histograms for latency
  or job duration.
- Use seconds and bytes as base units.
- Keep labels bounded. Route templates, method, status class, outcome, and
  client type are acceptable.
- Never label metrics with a job ID, URL, title, session/event ID, token, IP
  address, error text, or user identifier.
- Initialize known label combinations where practical so dashboards do not
  confuse an absent series with zero.
- Treat SQLite aggregates as the durable product-analytics source of truth;
  Prometheus counters are optimized for trends and alerts.

## Security and privacy

- Use a new `MYTUBE_METRICS_TOKEN`; never reuse `MYTUBE_TOKEN`.
- Disable the metrics listener unless both its bind address and token are set.
- Bind metrics to the VMware/private Mac interface, not a public interface.
- Do not route the private metrics listener through Cloudflare as the primary
  Prometheus target.
- Reject unknown event names and properties, cap batch size and payload bytes,
  and use the existing API authentication for event ingestion.
- Do not persist request authorization headers, query tokens, video URLs, or
  titles in analytics storage.
- Document analytics collection in the app privacy policy and App Store privacy
  responses before distributing an analytics-enabled iOS build.
- Provide a client analytics toggle before the app is distributed to other
  users.

## Delivery phases

### Phase 1: backend operational foundation

- Add an isolated Prometheus registry and HTTP middleware.
- Add a separately configured, bearer-protected metrics listener.
- Export Go/process, HTTP, build, and initial download-worker metrics.
- Add unit tests for authentication, route-label cardinality, and metric output.
- Update native deployment documentation without enabling the live listener.

### Phase 2: private scraping and outage correlation

- Select and verify the Mac VMware/private address.
- Generate the metrics token outside Git and install it in the Mac environment
  and a Kubernetes Secret.
- Restrict and verify VM-to-Mac reachability.
- Add the Prometheus scrape target and Blackbox Exporter public probe.
- Verify origin-only, public-only, and combined failure scenarios.

### Phase 3: durable analytics ingestion

- Add the versioned event schema and batch endpoint.
- Add the separate SQLite store, deduplication, retention, and daily rollups.
- Export bounded ingestion and product-event counters to Prometheus.
- Add API validation, migration, retention, and concurrency tests.

### Phase 4: frontend telemetry

- Add a typed event client with local batching and retry.
- Instrument playback, recovery, playlist, and download lifecycle boundaries.
- Add an analytics preference and tests that prohibit sensitive properties.

### Phase 5: mobile telemetry

- Add the same versioned client contract and a durable local delivery queue.
- Instrument the corresponding Flutter player, recovery, playlist, and download
  lifecycle boundaries.
- Verify airplane-mode recovery, deduplication, and privacy behavior on iPhone.

### Phase 6: dashboards, alerts, and operations

- Deploy Grafana OSS and Blackbox Exporter in `monitoring`.
- Provision the Prometheus data source, dashboard, recording rules, and alerts
  from version-controlled manifests.
- Add backup/retention checks and a telemetry runbook.
- Perform an end-to-end outage exercise and document the evidence.

## Verification gates

- Backend tests, race tests, and native macOS build pass.
- `/metrics` returns `401` without the dedicated token and Prometheus text only
  with the correct token.
- Dynamic URLs collapse to route templates; no high-cardinality or secret data
  appears in exported labels.
- A private-origin target remains scrapeable during a simulated public tunnel
  failure.
- Offline client events are delivered once after connectivity returns.
- Metrics and event ingestion cannot interrupt playback or downloads.
- All live infrastructure changes are reflected in the homelab execution
  tracker and handoff.

## Explicit non-goals

- Google Analytics is not introduced in this plan.
- Prometheus is not used as a raw event database.
- No client receives credentials for Prometheus or Grafana.
- Telemetry does not identify individual users or videos.
