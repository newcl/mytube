# MyTube

Personal YouTube downloader + library UI + Chrome extension.

## Architecture

| Component | Tech | Where |
|-----------|------|-------|
| Backend API + worker | Go + SQLite | Oracle Cloud VPS |
| Frontend | React + Vite | Cloudflare Pages |
| Chrome extension | MV3 | Local install |

- Frontend: `https://mytube.elladali.com`
- Backend: `https://api.mytube.elladali.com`

## Repo layout

```
backend/        Go API + worker (chi router, modernc.org/sqlite)
frontend/       React + Vite (Cloudflare Pages)
extension/      Chrome MV3 extension
docs/           Architecture + ADRs + deploy guides
scripts/        systemd unit, helper scripts
.github/        CI workflows
```

## Local development

### Backend

Requires Go 1.22+ and `yt-dlp` installed on the host.

```bash
cd backend
cp .env.example .env   # set MYTUBE_TOKEN at minimum
go run ./cmd/server
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Background playback notes (web player)

- The player now exposes a **Picture-in-Picture** action in the Play modal to keep playback active while multitasking.
- Media Session metadata is set so compatible browsers can show lock-screen/notification playback controls.
- Background playback is still browser and OS policy dependent:
  - Desktop Chrome/Edge: usually continues when unfocused/minimized.
  - Android Chrome: often continues, but may be paused by battery/app policies.
  - iOS Safari: strict background limits; playback may stop unless Picture-in-Picture is active.
- If playback is paused after the tab/app is backgrounded, use Picture-in-Picture or keep the player in the foreground.

### Chrome extension

Load `extension/` as an unpacked extension in Chrome (see [docs/extension-dev.md](docs/extension-dev.md)).

## Deployment

- VPS backend: [docs/deploy-vps.md](docs/deploy-vps.md)
- Cloudflare Pages: [docs/deploy-cloudflare-pages.md](docs/deploy-cloudflare-pages.md)
