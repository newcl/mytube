# MyTube

Personal YouTube downloader + library UI + Chrome extension.

## Architecture

| Component | Tech | Where |
|-----------|------|-------|
| Backend API + worker | Native Go + SQLite + packaged yt-dlp | Mac Mini |
| Frontend | React + Vite | Cloudflare Pages |
| Chrome extension | MV3 | Local install |

- Frontend: `https://mytube.elladali.com`
- Backend: `https://mytubeapi.elladali.com`

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

Source development requires Go and a `yt-dlp` executable on `PATH`.

```bash
cd backend
cp .env.example .env   # set MYTUBE_TOKEN at minimum
go run ./cmd/server
```

Build the self-contained Apple Silicon package:

```bash
bash scripts/build-native-macos.sh
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

- Native Mac backend: [docs/deploy-mac.md](docs/deploy-mac.md)
- Native migration tracker: [docs/native-macos-implementation-plan.md](docs/native-macos-implementation-plan.md)
- Homelab k3s rollback deployment: [docs/deploy-k3s.md](docs/deploy-k3s.md)
- Cloudflare Pages: [docs/deploy-cloudflare-pages.md](docs/deploy-cloudflare-pages.md)
