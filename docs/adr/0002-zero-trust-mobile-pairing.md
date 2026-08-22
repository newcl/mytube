# ADR 0002 — Zero Trust web authentication and mobile pairing

**Date:** 2026-08-21  
**Status:** Accepted

## Context

The original browser and mobile clients both received the same static backend
token. The browser stored it in `localStorage` and media URLs included it in the
query string. This enlarged the impact of an XSS, browser-history leak, device
loss, or token rotation.

The frontend is already protected by a single-user Cloudflare Access policy.

## Decision

- The web app calls only its same-origin `/backend/*` Pages Function.
- The Function validates the Cloudflare Access JWT, restricts upstream routes
  and methods, enforces same-origin writes, strips client credentials, and adds
  `MYTUBE_ADMIN_TOKEN` from the encrypted Pages environment.
- The browser stores no backend credential and file URLs contain no token.
- An authenticated web session may create a random, single-use pairing code
  that expires after five minutes.
- The iOS app scans a `mytube://pair` QR code and exchanges the code directly
  with the backend once. QR payloads targeting any origin other than the known
  Mytube API are rejected.
- The backend returns a unique `mt_device_*` token. Only its SHA-256 hash is
  stored. Device credentials can be listed and revoked from the web settings.
- The backend master token remains valid for trusted services and management
  routes. Device tokens can use application and file routes but cannot create
  pairings or manage devices.

## Consequences

- Compromise or loss of one phone no longer requires rotating every client.
- Access policy changes immediately affect the browser and pairing UI.
- Pages must have the encrypted `MYTUBE_ADMIN_TOKEN` secret, and both the custom
  domain and `pages.dev` hostname must remain covered by Cloudflare Access.
- A user must have the web session and phone together to pair a new install.
