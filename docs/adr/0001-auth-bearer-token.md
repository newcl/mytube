# ADR 0001 — Auth: Bearer Token

**Date:** 2026-04-27  
**Status:** Accepted

## Context

MyTube is a personal, single-user application. All API and file-serving endpoints must be protected. The product runs behind a Cloudflare WAF but we do not rely on the WAF for application-level authentication.

HTML5 `<video>` elements in browsers cannot attach custom `Authorization` headers to media requests. A solution for playback auth is needed.

## Decision

1. **All `/api/*` endpoints** require `Authorization: Bearer <MYTUBE_TOKEN>`.
2. **`/files/{id}`** accepts EITHER:
   - `Authorization: Bearer <MYTUBE_TOKEN>` header (e.g., for `fetch()` preflight / download links), OR
   - `?token=<MYTUBE_TOKEN>` query parameter (for HTML5 `<video src="...?token=...">` tags).
3. No session cookies; no OAuth; no JWT. A single static token from the environment variable `MYTUBE_TOKEN`.

## Consequences

- Simple to implement and deploy — no token rotation or session management needed.
- The file URL `https://api.mytube.elladali.com/files/123?token=...` contains the token. URLs logged in browser history, server logs, and proxies should be treated as sensitive.
- Acceptable for personal/private use behind WAF. **Not suitable for multi-user or public applications.**
- Frontend stores the token in `localStorage` (Settings panel) and appends it to file URLs. This is acknowledged as a trade-off for simplicity.
