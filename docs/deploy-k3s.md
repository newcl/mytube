# Deploy — Backend on the homelab k3s VM

MyTube runs as a single pod because the API and worker share one SQLite
database and one local download directory.

The completed migration record and operational notes are in
[`migration-2026-07-23.md`](migration-2026-07-23.md).

```text
Cloudflare Tunnel -> Traefik -> Service -> MyTube pod -> local PersistentVolume
```

## Prerequisites

- The VM root filesystem has been expanded to use the 100 GB virtual disk.
- `/srv/mytube` exists on the VM.
- Buildah is installed on the ARM64 VM.
- `cloudflared` on the VM forwards `*.elladali.com` to Traefik on
  `http://localhost:80`.

The reusable manifest is maintained in the homelab repository:

```text
mini+proxmox/manifests/mytube-k3s.yaml
```

## Build and import the image

Package the backend without macOS metadata, copy it to the VM, build natively,
and import the OCI archive into k3s containerd. Use an immutable tag:

```bash
# Mac
COPYFILE_DISABLE=1 tar --no-xattrs --exclude='./bin' --exclude='./data' \
  -czf /tmp/mytube-backend-src.tar.gz -C backend .
scp -i ~/.ssh/miniu1 /tmp/mytube-backend-src.tar.gz \
  liang@192.168.234.129:/home/liang/

# VM
build_dir=$(mktemp -d /tmp/mytube-build.XXXXXX)
tar -xzf /home/liang/mytube-backend-src.tar.gz -C "$build_dir"
sudo buildah bud --layers -t localhost/mytube-backend:<tag> "$build_dir"
sudo buildah push localhost/mytube-backend:<tag> \
  oci-archive:/tmp/mytube-backend.tar:mytube-backend:<tag>
sudo k3s ctr images import /tmp/mytube-backend.tar
sudo k3s ctr images tag mytube-backend:<tag> \
  docker.io/library/mytube-backend:<tag>
```

The Dockerfile runs `go test ./...` as part of the image build.

## Create the API token

Generate a new token outside Git and create the Secret directly in the cluster:

```bash
read -s MYTUBE_TOKEN
export MYTUBE_TOKEN
sudo --preserve-env=MYTUBE_TOKEN k3s kubectl create namespace mytube \
  --dry-run=client -o yaml | sudo k3s kubectl apply -f -
sudo --preserve-env=MYTUBE_TOKEN k3s kubectl -n mytube create secret generic mytube-secrets \
  --from-literal=token="$MYTUBE_TOKEN" \
  --dry-run=client -o yaml | sudo k3s kubectl apply -f -
unset MYTUBE_TOKEN
```

Do not store the token in the manifest, shell history, or Git.

## Deploy

Create the host directory, apply the manifest, and replace the placeholder image
with the imported commit tag:

```bash
sudo install -d -o 10001 -g 10001 -m 2770 /srv/mytube
sudo k3s kubectl apply -f manifests/mytube-k3s.yaml
sudo k3s kubectl -n mytube set image deployment/mytube \
  mytube=docker.io/library/mytube-backend:<tag>
sudo k3s kubectl -n mytube rollout status deployment/mytube
```

## Cookie refresh

YouTube authentication and progressive media URLs are separate concerns. The
worker uses an exported cookie jar for authentication and the `web_safari` HLS
client to avoid progressive URLs that require a per-video PO token.

The Mac refreshes the jar every six hours:

```text
Chrome/Keychain -> filtered Netscape jar -> SSH -> /srv/mytube/cookies/cookies.txt
```

The transfer is atomic and does not create a local cookie file. The remote jar
is mode `0660`, owned by `liang:mytube`; yt-dlp needs group write access because
it updates cookie expiry values when it exits.

One-time VM setup:

```bash
sudo groupadd --gid 10001 mytube       # skip if the group already exists
sudo usermod --append --groups 10001 liang
sudo install -d -o liang -g 10001 -m 2750 /srv/mytube/cookies
```

Install or refresh the Mac launch agent:

```bash
bash scripts/install-cookie-refresh.sh
tail -f ~/Library/Logs/mytube/cookie-refresh.log
```

Use a dedicated YouTube account for this browser profile. An authenticated
cookie jar can provide access to the associated Google account and YouTube may
restrict accounts used by automated downloaders. Never commit, print, or back
up the jar to an unencrypted location.

## Verify

```bash
sudo k3s kubectl -n mytube get pod,pvc,service,ingress
sudo k3s kubectl -n mytube logs deployment/mytube
curl -H 'Host: mytubeapi.elladali.com' http://127.0.0.1/health
curl https://mytubeapi.elladali.com/health
```

Then configure the new token in the web frontend and extension, submit one
small video, verify progress reaches `completed`, and verify playback seeking
returns HTTP `206 Partial Content`.

## Roll back

The PersistentVolume uses the `Retain` policy. Removing or scaling down the
Deployment does not remove `/srv/mytube`.
