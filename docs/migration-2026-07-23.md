# Mac Mini to k3s migration — 2026-07-23

## Outcome

The MyTube backend moved from a macOS launch agent on the Mac Mini to the
single-node k3s VM `miniu1`.

```text
mytubeapi.elladali.com
  -> Cloudflare wildcard DNS
  -> cloudflared on miniu1
  -> Traefik
  -> mytube Service
  -> one MyTube pod
  -> /srv/mytube local PersistentVolume
```

The deployment starts with an empty SQLite database and download directory.
No previous application data was copied.

## Final state

- Namespace: `mytube`
- Workload: one replica, `Recreate` strategy
- Image: `docker.io/library/mytube-backend:20260723-5`
- PersistentVolume: `mytube-data`, 75 GiB, `Retain`
- Host storage: `/srv/mytube`
- Public API: `https://mytubeapi.elladali.com`
- Authentication: random API token in Kubernetes Secret `mytube-secrets`
- YouTube authentication jar: `/srv/mytube/cookies/cookies.txt`
- Cookie refresh: Mac launch agent `com.mytube.cookie-refresh`, every six hours
- Old Mac backend: stopped and `com.mytube.server` disabled
- Mac cloudflared: retained because it also serves `cal.elladali.com`

The token is intentionally absent from Git, manifests, documentation, and
logs. It must be entered in the frontend Settings panel and any extension.

## Work performed

1. Expanded the VM's LVM physical volume and root logical volume after the
   virtual disk was increased to 100 GB. The root filesystem is approximately
   96 GB usable.
2. Installed Buildah and built the ARM64 image directly on the ARM64 VM. This
   removed the need for GitHub authentication or a registry for this migration.
3. Added the backend container image and a reusable k3s manifest.
4. Created a local 75 GiB retained PV and a new, empty SQLite database.
5. Added an explicit Traefik Ingress for `mytubeapi.elladali.com`.
6. Removed the old explicit DNS record so the existing `*.elladali.com`
   wildcard route could send the hostname to the VM tunnel.
7. Added Node as yt-dlp's JavaScript runtime.
8. Added cookie-file support and an atomic Mac-to-VM, `youtube.com`-only cookie
   refresh workflow.
9. Selected YouTube's `web_safari` HLS format path for downloads.
10. Verified a real public API download, HTTP byte-range serving, and
    persistence across a pod restart.
11. Removed all migration test jobs and media.
12. Stopped and disabled the old Mac backend.

## Problems encountered and resolutions

### Root filesystem still showed 17 GB

Increasing the virtual disk did not automatically grow the guest partitions or
LVM. `growpart`, `pvresize`, and `lvextend -r` were required inside the VM.

### GitHub authentication request

GitHub authentication was only proposed as a way to publish/download a CI-built
OCI artifact. It was not necessary. The final process builds locally with
Buildah and imports the image into k3s containerd.

### Duplicate database migrations

The first source archive included macOS AppleDouble files such as `._*.sql`.
Those files looked like additional migrations inside Linux. Source archives
must be created with `COPYFILE_DISABLE=1`, `--no-xattrs`, and the Docker
`.dockerignore` rules that exclude `._*`.

### Public hostname still reached the old tunnel

An explicit `mytubeapi.elladali.com` DNS record overrode the wildcard record.
After the explicit record was removed, the wildcard sent the hostname to the VM
tunnel and Traefik routed it to MyTube.

### Cookie-free progressive download returned HTTP 403

YouTube's progressive format 18 URL required proof-of-origin behavior that
cookies alone did not satisfy. A cookie-free `web_safari` HLS download worked,
but cookies are still useful for authentication, age-restricted media, and bot
challenges. The final worker combines:

```text
--cookies /data/cookies/cookies.txt
--extractor-args youtube:player_client=web_safari
--format 93/...HLS fallbacks.../18/...progressive fallbacks...
--js-runtimes node
```

### Cookie jar was readable but the worker still failed

yt-dlp saves updated cookie values on exit. Mode `0640` allowed reads but caused
a `PermissionError` when yt-dlp saved the jar. The final mode is `0660`, with
owner `liang` and group `mytube` (GID 10001).

### Old Mac launch agent would not unload normally

macOS returned launchd I/O error 5. The service was disabled in the user launchd
domain and its exact running process was terminated. Port 8081 is no longer
listening. The plist remains on disk as a rollback artifact.

## Verification evidence

- Container build ran `go test ./...` successfully.
- Deployment and pod reached `1/1 Ready`.
- PVC `mytube-data` reached `Bound`.
- Public `/health` returned `{"status":"ok"}`.
- A real YouTube job reached `completed`.
- The resulting MP4 was served through Cloudflare with:
  - HTTP `206 Partial Content`
  - `Content-Range: bytes 0-1023/11936712`
- The same range request succeeded after a Deployment restart.
- Prometheus reported one available MyTube Deployment replica.
- Test jobs, MP4 files, metadata, and subtitle files were removed afterward.

## Operations and maintenance

### Cookie health

Check the scheduled refresh:

```bash
launchctl print gui/$(id -u)/com.mytube.cookie-refresh
tail -100 ~/Library/Logs/mytube/cookie-refresh.log
```

Run it manually:

```bash
bash scripts/push-yt-cookies.sh
```

The original refresh briefly exported broader `.google.com` cookies. On
2026-07-23 the filter was narrowed to `youtube.com` and its subdomains, and the
old broad jar was securely overwritten and removed while the pod was stopped.

The cookie jar remains highly sensitive. Use a dedicated YouTube
account/profile, never commit the jar, and do not print its contents. yt-dlp
warns that YouTube may temporarily or permanently restrict accounts used for
automated downloads.

### Application health

```bash
ssh -i ~/.ssh/miniu1 liang@192.168.234.129
sudo k3s kubectl -n mytube get deployment,pod,service,ingress,pvc
sudo k3s kubectl -n mytube logs deployment/mytube
curl https://mytubeapi.elladali.com/health
```

### Image updates

Build with a new immutable tag, import it into k3s, update the manifest, and
wait for the rollout. The complete commands are in `docs/deploy-k3s.md`.

Keep yt-dlp pinned and update it deliberately. YouTube extraction behavior,
JavaScript challenge support, client selection, and PO-token requirements
change over time, so a real download is required after every yt-dlp or worker
change.

### Storage

The PV uses local VM disk and `Retain`. Deleting the Deployment does not delete
`/srv/mytube`, but the directory is not a backup. Back up the SQLite database
and downloads separately if the data later becomes important.

### DNS and tunnels

The wildcard DNS record is authoritative for MyTube. Do not add another
explicit `mytubeapi.elladali.com` record unless intentionally changing tunnels.
The Mac tunnel still has historical MyTube ingress configuration, but DNS no
longer selects it. Do not stop Mac cloudflared without first accounting for
`cal.elladali.com`.

## Rollback

The VM deployment can be scaled down without deleting its retained storage.
To temporarily restore the old Mac backend:

```bash
launchctl enable gui/$(id -u)/com.mytube.server
launchctl bootstrap gui/$(id -u) \
  ~/Library/LaunchAgents/com.mytube.server.plist
```

DNS would also need to be deliberately routed back to the Mac tunnel. Do not
run both backends against the same hostname unintentionally.
