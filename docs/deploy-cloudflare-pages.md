# Deploy — Frontend on Cloudflare Pages

## Prerequisites

- Cloudflare account
- Repository connected to Cloudflare Pages (GitHub integration)
- Custom domain `mytube.elladali.com` configured in Cloudflare

---

## 1. Build settings in Cloudflare Pages

| Setting | Value |
|---------|-------|
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `frontend` |

---

## 2. Environment variables

Set these in the Cloudflare Pages dashboard under **Settings → Environment variables**:

| Variable | Value |
|----------|-------|
| `VITE_API_BASE_URL` | `https://api.mytube.elladali.com` |

> The `MYTUBE_TOKEN` is **not** set as a build-time env var — it is entered by the user at runtime in the Settings panel and stored in `localStorage`.

---

## 3. Custom domain

1. Go to **Pages → your project → Custom domains**
2. Add `mytube.elladali.com`
3. Cloudflare will automatically configure the DNS CNAME pointing to your Pages project

---

## 4. Local preview build

```bash
cd frontend
npm install
npm run build
npx wrangler pages dev dist
```

---

## 5. Manual deploy (without CI)

```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=mytube
```

---

## 6. CI deploy (GitHub Actions)

See `.github/workflows/frontend.yml` for automated deploy on push to `main`.

Requires the following secrets in GitHub repository settings:
- `CLOUDFLARE_API_TOKEN` — a Cloudflare API token with Pages edit permission
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account ID
