# Mytube telemetry operations

Last verified: 2026-08-21

## Live architecture

- The native macOS backend exposes its API on `127.0.0.1:8081` and its
  bearer-protected metrics listener on the VMware-private
  `192.168.234.1:9091` address.
- Prometheus in the k3s `monitoring` namespace scrapes the private listener
  every 15 seconds and probes the public health URL through the internal
  Blackbox Exporter every 30 seconds.
- Grafana OSS is installed from `grafana-community/grafana` chart 12.11.1
  (Grafana 13.2.0). It uses a 2 GiB PVC and a provisioned, read-only Mytube
  dashboard backed by the in-cluster Prometheus service.
- Alertmanager is installed by Prometheus chart 29.19.0 with a 2 GiB PVC. Its
  configuration is mounted from the `alertmanager-config` Secret.
- Detailed product events are stored separately in `analytics.sqlite`. Raw
  events expire after 90 days; daily rollups are retained permanently until
  that policy is deliberately changed.
- Prometheus retains five days of time-series data. Client queues retain at
  most 500 events and discard events older than 30 days.

## Access and credentials

Never place the API token, metrics bearer token, Grafana password, or an alert
delivery URL in Git.

- The Grafana admin password is stored in macOS Keychain with service
  `grafana.elladali.com` and account `admin`, and in the Kubernetes Secret
  `monitoring/grafana-admin`.
- The metrics credential is stored in the native mode-0600 Mytube environment
  and the Kubernetes Secret `monitoring/mytube-metrics`.
- Grafana's Ingress manifest is intentionally separate from its Helm values.
  Apply it only after an owner-only Cloudflare Access application for
  `grafana.elladali.com` has been created and verified.
- Alertmanager currently uses an internal-only receiver. Adding an email or
  webhook receiver requires explicit approval and a credential or destination
  stored in `monitoring/alertmanager-config`, never in the Helm values file.

## Routine checks

On `miniu1`, use the k3s kubeconfig through `sudo k3s kubectl`:

```bash
sudo k3s kubectl -n monitoring get pods
sudo k3s kubectl -n monitoring get pvc
sudo k3s kubectl -n monitoring logs deployment/grafana --tail=100
sudo k3s kubectl -n monitoring logs statefulset/prometheus-alertmanager --tail=100
```

In Prometheus, verify:

- `up{job="mytube-backend"} == 1`
- `probe_success{job="mytube-public"} == 1`
- `mytube_build_info == 1`
- the `mytube` rule group reports `health=ok`
- one active Alertmanager appears under Prometheus runtime information

In Grafana, open the provisioned **Mytube overview** dashboard and check both
availability panels, request error/latency panels, download outcomes, and
product events.

## Backup and restore

The deployment inputs are versioned in the homelab repository:

- `mini+proxmox/manifests/grafana-values.yaml`
- `mini+proxmox/manifests/mytube-grafana-dashboard.yaml`
- `mini+proxmox/manifests/grafana-ingress.yaml`
- `mini+proxmox/manifests/shareitnow-prometheus-values.yaml`
- `mini+proxmox/manifests/alertmanager-config.example.yaml`
- `mini+proxmox/manifests/mytube-blackbox-exporter.yaml`

The first Grafana rollout is backed up on the VM under
`/var/backups/grafana/20260821-initial/`. Prometheus revisions before and after
Alertmanager are backed up under `/var/backups/mytube-prometheus/`.

Before a Grafana upgrade, copy the Grafana SQLite database from
`/var/lib/grafana/grafana.db` inside the pod to a mode-0600 backup directory,
and save `helm get values grafana -n monitoring`. Restore by scaling Grafana
down, restoring the database into its PVC, and upgrading with the known-good
chart and values. Verify `/api/health`, the Prometheus datasource health, and
the provisioned dashboard before restoring public routing.

Back up `analytics.sqlite` with SQLite's online backup mechanism while the
native service is running, or stop the service before copying the database and
its WAL/SHM files together. Restore it independently of the main Mytube
database. A missing or corrupt analytics database must never be allowed to
prevent the API from starting.

## Alert behavior and exercise record

The Mytube rules cover private-origin loss, public-route loss while the origin
is healthy, elevated API 5xx ratio, repeated download failures, and repeated
playback failures without matching recovery events.

On 2026-08-21, two scoped end-to-end exercises blocked only monitoring-pod
traffic and did not stop the Mytube API or tunnel:

1. Blocking Prometheus-to-origin metrics traffic changed the private target to
   `up=0`; `MytubeOriginUnavailable` progressed from pending to firing and was
   present in Alertmanager. The public probe remained `1`.
2. Blocking only the Blackbox pod's HTTPS egress changed `probe_success` to
   `0`; `MytubePublicRouteUnavailable` fired while the private origin remained
   `up=1` and was present in Alertmanager.

Both rules were removed before their automatic rollback deadlines. Final
verification showed both signals at `1`, both alerts resolved, and no test
firewall rules remaining.

## Failure triage

| Origin | Public probe | Likely fault | First checks |
|---|---|---|---|
| 1 | 1 | Service path healthy | Inspect API error, download, and playback panels. |
| 0 | 0 or stale | Native backend, Mac networking, or metrics listener | Check the LaunchAgent, loopback health, VMware address, and metrics retry logs. |
| 1 | 0 | Tunnel, DNS, Cloudflare edge, or public routing | Check `com.mytube.cloudflared`, watchdog logs, exact DNS record, and public health. |
| missing | any | Prometheus scrape/config problem | Check the server pod, Secret mount, target configuration, and rule health. |

For missing frontend/mobile events, first confirm analytics is enabled, the
client has a saved API token, and `/api/telemetry/events` is reachable. Client
queues retry transient failures, so do not clear storage until queue age/size
and the backend response have been inspected. Use only aggregate event names,
clients, and outcomes in Prometheus; never add URLs, titles, tokens, IDs, or
error text as labels.
