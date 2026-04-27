# Deploy — Backend on Oracle VPS

## Prerequisites

- Oracle Cloud VPS (1 CPU / 1 GB RAM recommended minimum)
- Ubuntu 22.04 or similar
- A domain pointing to the VPS (e.g. `api.mytube.elladali.com`)

---

## 1. Install dependencies

```bash
sudo apt update && sudo apt install -y ffmpeg curl

# yt-dlp (keep updated)
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod +x /usr/local/bin/yt-dlp

# Verify
yt-dlp --version
ffmpeg -version
```

---

## 2. Create a dedicated user and directories

```bash
sudo useradd -r -s /bin/false mytube

sudo mkdir -p /opt/mytube/data/downloads
sudo chown -R mytube:mytube /opt/mytube
```

---

## 3. Deploy the binary

Build on your dev machine (cross-compile for Linux):

```bash
cd backend
GOOS=linux GOARCH=amd64 go build -o mytube-server ./cmd/server
```

Copy to VPS:

```bash
scp mytube-server user@your-vps:/opt/mytube/mytube-server
ssh user@your-vps "sudo chown mytube:mytube /opt/mytube/mytube-server && sudo chmod 755 /opt/mytube/mytube-server"
```

---

## 4. Configure environment

Create `/opt/mytube/.env`:

```ini
MYTUBE_BIND=127.0.0.1:8080
MYTUBE_TOKEN=your-very-secret-token-here
MYTUBE_DB_PATH=/opt/mytube/data/mytube.db
MYTUBE_DOWNLOAD_DIR=/opt/mytube/data/downloads
MYTUBE_CONCURRENCY=2
MYTUBE_CORS_ORIGIN=https://mytube.elladali.com
MYTUBE_PUBLIC_BASE_URL=https://api.mytube.elladali.com
```

```bash
sudo chown mytube:mytube /opt/mytube/.env
sudo chmod 600 /opt/mytube/.env
```

> **Note:** Recommended `MYTUBE_CONCURRENCY=1` or `2` for a 1 CPU VM to avoid thrashing.

---

## 5. Install systemd service

```bash
sudo cp scripts/systemd/mytube.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable mytube
sudo systemctl start mytube
sudo systemctl status mytube
```

---

## 6. Reverse proxy with Caddy (recommended)

Install Caddy:

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install caddy
```

`/etc/caddy/Caddyfile`:

```caddy
api.mytube.elladali.com {
    reverse_proxy 127.0.0.1:8080 {
        # Allow large uploads and long downloads
        transport http {
            response_header_timeout 0
            read_buffer 32KiB
        }
    }
}
```

```bash
sudo systemctl reload caddy
```

### Alternative: nginx

```nginx
server {
    listen 443 ssl;
    server_name api.mytube.elladali.com;

    ssl_certificate     /etc/letsencrypt/live/api.mytube.elladali.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.mytube.elladali.com/privkey.pem;

    # Important: allow Range requests to pass through
    proxy_set_header Range $http_range;
    proxy_set_header If-Range $http_if_range;
    proxy_pass_header Content-Range;

    # Disable proxy buffering for streaming / range responses
    proxy_buffering off;
    proxy_max_temp_file_size 0;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600;
    }
}
```

---

## 7. Update yt-dlp periodically

```bash
sudo yt-dlp -U
```

Consider a weekly cron job:

```cron
0 3 * * 0  /usr/local/bin/yt-dlp -U >> /var/log/yt-dlp-update.log 2>&1
```

---

## 8. Logs

```bash
sudo journalctl -u mytube -f
```
