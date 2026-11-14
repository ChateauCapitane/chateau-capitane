# ADR-0005. Security headers, staff-area isolation and a separate monitoring token

Date: 2026-11-14 · Status: accepted (planner's recommendation, Anthony reviews after; see `adr-trust` memory)

## Context
Predeployment audit 2026-11-14 (`docs/security-audit.md`), findings at HEAD b0a0980:
- **SEC-01 (high):** the inKind script (`src/components/layout/inkind-popup.tsx:8-9`) is hidden from `/admin` only by
  a client-side path check inside the shared root layout. (a) A client-side navigation public page → admin keeps
  inkind.js running in the same document as the inbox. (b) Any script on a public page is same-origin with `/admin`,
  so it can `fetch('/admin/...')` with the staff cookies (the `Path=/admin` cookie scope limits which URLs get the
  cookie, not which page asks). It is loaded unpinned, with no SRI and no CSP.
- **SEC-02 (medium):** no security headers anywhere (`next.config.ts`, `src/proxy.ts`, `vercel.json`).
- **SEC-06 (low):** `CRON_SECRET` unlocks both the cron workers and health readiness, so an uptime monitor holding it
  could trigger workers.

## Decision
1. **Staff pages never share a document with third-party scripts.** Every navigation between `/admin` and public pages
   is a full page load (staff pages render no `next/link` to public routes and public pages none to `/admin`), or the
   admin tree gets its own root layout without `InkindPopup` and `ClickTracker`. Builder picks the smaller diff and
   says which.
2. **Separate staff origin at release.** New optional setting `ADMIN_HOST` (for example `admin.<domain>`). When set,
   `src/proxy.ts` serves `/admin` only on that host (404 elsewhere) and serves public pages only elsewhere (redirect
   to the public host taken from configuration (`site.url`), never from the request's Host header). Session cookies
   stay host-only (no `Domain` attribute) and become `SameSite=Strict` when `ADMIN_HOST` is set. The two hosts are
   **cross-origin but same-site**: a public-page script cannot read staff responses, and Strict keeps the cookies off
   its requests. API routes (outside the proxy matcher) answer on both hosts; they are bearer-, signature- or
   form-guarded. Unset (local, tests) keeps today's behaviour. Setting it, with its DNS record, is a release step.
   Rule: **no state-changing GET under `/admin`.** `admin/refresh` (renew and sign-out) acts only when
   `Sec-Fetch-Site` is `same-origin` or `none` (or absent, for older browsers).
3. **Headers** via `headers()` in `next.config.ts`:
   - All routes: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
     `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`, `X-Frame-Options: DENY` plus CSP
     `frame-ancestors 'none'`, and `Strict-Transport-Security: max-age=86400` (no `includeSubDomains`, no `preload` at
     first deploy; raise to two years with `includeSubDomains` after the release checklist passes; browsers ignore it on
     plain-http localhost).
   - `/admin` and below: CSP `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
     img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'none';
     object-src 'none'; frame-ancestors 'none'` plus `Cache-Control: private, no-store`. In development only
     (`NODE_ENV !== "production"`) `script-src` adds `'unsafe-eval'`, which React's dev build needs. A test pins that
     the `/admin` and `/admin/login` responses carry it (headers are matched on the visible path, before the proxy
     rewrite to `/en/admin`; confirm with build + curl). This blocks every third-party
     script on staff pages. `'unsafe-inline'` stays because Next's hydration uses inline scripts; nonces would force
     the proxy to mint one per request for little gain while React escapes output.
   - Public pages get no script CSP yet: inKind loads sub-resources we have not inventoried and a CSP could break it
     silently. BACKLOG: a report-only public CSP once inKind's requests are listed.
4. **Health token.** `/api/health` readiness accepts only `HEALTH_TOKEN` (held by the uptime monitor; constant-time
   compare, ≥ 16 characters, unset = readiness refused), no longer `CRON_SECRET`. `CRON_SECRET` stays for the cron
   routes only; `MONITOR_TOKEN` (ADR-0004) reads incidents only. Three credentials, three holders.

## Rationale
- (1) closes the soft-navigation path now with no infrastructure. (2) is the only change that closes the same-origin
  path short of removing inKind, and it costs one DNS record. Removing or sandboxing inKind is a business call for
  the owner, not a security default.
- Headers in `next.config.ts` are the documented Next.js way, need no new dependency and are covered by build.

## Consequences
- Until `ADMIN_HOST` is set, SEC-01(b) remains: staff should not browse the public site while signed in. This is a
  release condition in the checklist, not an accepted risk.
- The uptime monitor uses `HEALTH_TOKEN`; docs and the release checklist change accordingly.
- Not done (BACKLOG): public-page CSP, SRI for inkind.js (the vendor publishes no pinned versions; unverified).
