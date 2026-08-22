# Deploy — Frontend on Cloudflare Pages

## Prerequisites

- Cloudflare account
- Repository connected to Cloudflare Pages (GitHub integration)
- Custom domain `mytube.elladali.com` configured in Cloudflare

---

## 1. Build settings in Cloudflare Pages

The `mytube` Cloudflare Pages project is connected directly to GitHub. A push
to `main` that changes `frontend/**` automatically starts a production build
and deploy; do not run a separate manual Pages deployment for the normal
release path.

| Setting | Value |
|---------|-------|
| Framework preset | Vite |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `frontend` |

---

## 2. Cloudflare Access and secret

Create an owner-only Cloudflare Access self-hosted application covering both
`mytube.elladali.com/*` and the project's `pages.dev` hostname. The Pages
Function also validates the Access application audience and team issuer.

Store the backend master token as an encrypted production secret:

```bash
npx wrangler pages secret put MYTUBE_ADMIN_TOKEN --project-name mytube
```

Do not define `VITE_API_BASE_URL` in production. Production uses the same-origin
`/backend` Function. Never put the token in a `VITE_*` variable because Vite
embeds those values in the public bundle.

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

For local Function testing, provide `MYTUBE_ADMIN_TOKEN` in an ignored
`frontend/.dev.vars` file. Never commit that file.

---

## 5. Manual deploy (fallback only)

Use this only when the Git-integrated Pages deployment is unavailable or an
explicit immutable preview deployment is needed:

```bash
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=mytube
```

---

## 6. GitHub Actions validation

`.github/workflows/frontend.yml` validates frontend builds. Production
deployment is performed independently by the Cloudflare Pages Git integration
after pushes to `main`.
