# Predeployment security audit (2026-11-14)

Reviewed commit: `main` at b0a0980, plus branch `fix/security-audit` (this audit's fixes). Environment: source,
configuration and local runs on the developer PC only. Nothing is deployed; no staging or production system, Supabase
project, Resend account or Vercel project was tested. Not a certification, not legal advice. Status of each fix and
the deployment decision: section 8.

## 1. Scope and system

| Item | Finding (evidence) |
| --- | --- |
| What it does | Marketing site for one restaurant in Brooklyn, NY (EN at `/`, RU at `/ru`); contact and banquet inquiry form; staff inbox and content publishing at `/admin` |
| Users | Public guests (anonymous, no accounts); a few invited staff (`owner` / `staff` roles, `staff_members`) |
| Operates | United States (NY). Guests may be anywhere, so California and foreign visitors are possible |
| Personal data | Guest name, email, phone, free-text message, event date and party size (`inquiries`, migration 202610090001:24-29); copies in email jobs (202610090002:52-57); staff emails in notes and audit trail (202610100002:21,32); staff passwords held by Supabase Auth, never by the app. No payment, health, children's or government-ID data. No IP addresses stored (HMAC network hash only, 202610090004:2) |
| Third parties | Vercel (hosting, cron), Supabase (database, Auth), Resend (email + webhook), inKind (browser script on public pages), Google Maps (iframe on contact), OpenTable (outbound link), social links. Fonts are self-hosted by `next/font` at build |
| Tracking | First-party Book now / Call counts with no identifiers (ADR-0003). inKind and Google Maps may set their own cookies (not checked in a browser) |
| Not involved | Payments, guest accounts, user-generated public content, AI features, children-directed content, international transfers beyond US-hosted providers |
| Environments reviewed | Repository only. Preview/production configuration is documented in `docs/backend-operations.md` but unexercised |

## 2. Threat model

**Assets:** guest inquiries (PII), staff sessions, published menu/prices/hours (trust, revenue), Supabase secret key,
Resend key (sending reputation), CRON_SECRET, availability of the inquiry form and phone fallback.

**Trust boundaries:** browser → Vercel edge → `src/proxy.ts` → route handlers (`/api/*`) and Server Actions
(`/admin`) → `src/lib/server` → Supabase REST (service_role) / Resend; Resend → webhook; Vercel cron → cron routes;
third-party script (inKind) → same browser origin as the site.

| # | Threat | Entry point | Existing control | Residual (exploitability × impact) |
| --- | --- | --- | --- | --- |
| T1 | Staff account takeover by password guessing | `/admin/login` | Per-network login limit, fail closed; Supabase Auth | Medium: no MFA, no forgot-password; detection added (ADR-0004 R1/R2) |
| T2 | Third-party script reads inbox via staff browser | inkind.js on public pages | Client-side path check only | **High until fixed** (SEC-01): ADR-0005 |
| T3 | Privilege escalation staff → owner, or non-staff Auth user → staff | Server Actions, RPCs | `require_staff` in every staff RPC, roles SQL-only, metadata ignored | Low (verified) |
| T4 | Inquiry data theft through API or database | PostgREST | Private schema unexposed, RLS on, service_role-only grants | Low (verified in local PostgreSQL; real gateway unchecked, B02c) |
| T5 | XSS / injection | form fields, content editor, photo metadata | React escaping, one escaped JSON-LD, no dynamic SQL, LIKE escaping | Low; no CSP backstop until ADR-0005 |
| T6 | CSRF | Server Actions, sign-out GET | Next Server Action origin check, SameSite=Lax | Low (SEC-04 sign-out GET) |
| T7 | Forged webhook / cron trigger | `/api/webhooks/resend`, `/api/cron/*` | Svix HMAC + 5-min window, bearer with constant-time compare | Low |
| T8 | Spam / cost amplification | `/api/contact`, `/api/track`, `/media/[id]` | Body limits, honeypot, per-network + global contact caps | Medium: media uncached at CDN (SEC-03), track has no global cap (SEC-08) |
| T9 | Malicious upload | gallery upload | 3.5 MB, sharp re-encode to WebP, pixel limit, magic-byte check | Low |
| T10 | Supply chain | npm, GitHub Actions, inkind.js | Lockfile, `npm ci`, registry signatures verified (380), runtime audit 0 | Medium: actions tag-pinned (SEC-07), inkind.js unpinned |
| T11 | Insider misuse | staff inbox | Audit events, roles, retention | Low-medium: staff see all inquiries by design |
| T12 | Denial of service | edge | Vercel platform | Out of app scope; rate limits fail closed to the phone number |
| T13 | Abuse of the new response system | `/admin/security`, incident API | Owner session only, bounded expiring actions, read token cannot act | Reviewed in ADR-0004 audit |
| — | Tenant isolation, payment abuse, AI misuse | — | — | Not applicable (single tenant, no payments, no AI features) |

## 3. Tools run (and their limits)

| Tool | Covered | Result | Limits |
| --- | --- | --- | --- |
| `npm audit --omit=dev` | Runtime tree | 0 vulnerabilities | Known advisories only |
| `npm audit` (full) | Dev tree | 8 (7 moderate, 1 high `zod` via eslint plugins) | Dev-only; not reachable at runtime |
| `npm audit signatures` | Registry signatures | 380 verified, 88 attestations | Does not prove package behaviour |
| Regex secret scan of tree and `git log -p --all` | Keys, JWTs, PEM, env assignments | No values found; only `.env.example` tracked | Not a dedicated scanner (gitleaks not installed) |
| License read of runtime packages | 22 packages | All permissive except libvips binaries (LGPL-3.0, via sharp) | Linux build variant not checked |
| Manual code audit (security-auditor, opus) | Whole trust chain at b0a0980 | PASS WITH CONCERNS, findings below | Gates not rerun by auditor; live provider behaviour unchecked |
| Greps | headers, cookies, redirects, fetch targets, SECURITY DEFINER, grants, logging | See findings | Static only |
| Runtime tests | Local only (section 8) | — | No staging |

## 4. Findings register

| ID | Sev | Conf | Where | Issue | Fix | Blocks deploy | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SEC-01 | high | high (path), theoretical (exploit) | `inkind-popup.tsx:8-9`, `[lang]/layout.tsx:71`, `session.ts:11-13` | Third-party script can share a document with, or fetch, staff pages using the staff cookies | ADR-0005 (1) full-page boundary now; (2) `ADMIN_HOST` separate origin at release | Yes, until `ADMIN_HOST` is set at release | see §8 |
| SEC-02 | medium | medium | `next.config.ts` | No security headers (CSP, framing, nosniff, HSTS, referrer) | ADR-0005 (3) | No | see §8 |
| SEC-03 | medium | medium | `src/app/media/[id]/route.ts:9-14` | Unauthenticated photo route not CDN-cached; each hit = function + up to ~2.7 MB DB egress | `s-maxage` | No | see §8 |
| SEC-04 | low | high | `admin/refresh/route.ts:12-15` | Cross-site link can sign staff out | Sec-Fetch-Site check | No | see §8 |
| SEC-05 | low | high | `admin/inquiries/[id]/page.tsx:55` | Guest email can inject mailto `cc`/`bcc`/`body` | encode + tighter pattern | No | see §8 |
| SEC-06 | low | high | `api/health/route.ts:10` | One secret for cron and monitor | `MONITOR_TOKEN` (ADR-0005 (4)) | No | see §8 |
| SEC-07 | low | high | `.github/workflows/ci.yml:12-13` | Actions pinned by tag | SHA pin | No | see §8 |
| SEC-08 | low | medium | `src/lib/server/track.ts` | No site-wide cap on click beacons | Global bucket (in the monitoring migration) | No | see §8 |
| SEC-09 | info | high | repository | No privacy notice page although PII is collected | Owner/counsel: §6 | Yes (legal, §6) | open |
| SEC-10 | info | — | Supabase dashboard | Sign-up disabled, Auth rate limits, email templates unverified | Staging check | Yes (checklist) | open |

Hardening, not vulnerabilities: public-page CSP, SRI for inkind.js, MFA, forgot-password, dev-only advisories.
Unconfirmed suspicion: Supabase Auth's own per-IP limit sees only Vercel's server IPs and might let guessing lock
staff out of sign-in at Supabase level (check on staging).

## 5. Verified controls (no change needed)
Staff check on every admin page, action and media route (`requireStaff` → Supabase `/auth/v1/user` + `staff_role`);
cookies httpOnly, Lax, `Path=/admin`, Secure in production; `safeAdminPath` stops open redirects; every staff RPC
calls `require_staff`; all SECURITY DEFINER functions set `search_path = ''`; no dynamic SQL; RLS on all tables; no
grants to anon/authenticated; webhook verified before parsing; cron bearer constant-time; contact JSON-only with 32 KB
limit, honeypot, fail-closed limiter; uploads re-encoded; logs carry codes only; no `NEXT_PUBLIC_` secrets.

## 6. Requirements applicability matrix

Sources were gathered from search results on 2026-11-14 and mostly not read on the primary page; items marked
*confirm* need a lawyer or the primary text. Jurisdiction-dependent; not legal advice.

| Obligation | Applies? | Evidence in product | Gap | External review |
| --- | --- | --- | --- | --- |
| OWASP ASVS 5.0 (May 2025) | Voluntary benchmark; Level 1 fits, Level 2 for the staff area | This audit | Not a formal ASVS assessment; MFA (L2) missing | Optional independent pentest |
| NY SHIELD Act, GBL 899-bb (safeguards) | Likely yes: NY business holding staff email + password (Supabase Auth) | RLS, roles, retention, this audit | Written security program/owner of security not named | Counsel *confirm* small-business standard |
| NY GBL 899-aa (breach notice) | Yes if staff credentials are breached; guest name+email+phone alone is likely not "private information" | Monitoring (ADR-0004) | Notification procedure; 30-day deadline per a 2024 amendment *confirm* | Counsel |
| CalOPPA (B&P 22575) | Likely yes: commercial site collecting PII from any California visitor | None | **No privacy policy** (must cover data collected, third parties, Do Not Track response) | Counsel drafts or approves; owner publishes |
| CCPA/CPRA | Likely no: thresholds $26.6M revenue / 100k consumers / selling data *confirm revenue* | — | — | Owner confirms revenue |
| NY comprehensive privacy law | None enacted as of 2026-11 (NY Privacy Act not passed) *confirm* | — | — | — |
| ADA Title III / NYC Human Rights Law (website accessibility) | Yes in practice: restaurant = public accommodation; NY courts apply it to websites; WCAG 2.1 AA is the usual benchmark (no final DOJ Title III rule) | Semantic HTML, one h1, alt text conventions (`docs/technical.md`) | No WCAG audit done in this review | Accessibility audit (automated + manual) before launch |
| FTC 16 CFR 465 (fake reviews, eff. 2024-10-21) | Yes: testimonials page | Rule "never invent reviews" (AGENTS.md); `testimonials.ts` | Provenance of each testimonial not recorded in this audit | Owner confirms each review is real |
| CAN-SPAM | Staff notification emails are transactional; no marketing email | Worker sends only inquiry content | None | — |
| Software licenses | Runtime: permissive + LGPL-3.0 libvips (dynamic use on server, no redistribution to users) | License read | Keep notices | None expected |
| Photos / IP | Real photos with provenance (`docs/photo-sources.md`) | Rule in AGENTS.md | — | Owner confirms rights |
| PCI DSS, HIPAA, COPPA, GDPR | No payments, health data or children's data; site not targeted at the EU | — | — | — |

## 7. Monitoring and incident response
Design: ADR-0004. Runbook, incident schema, sample and reusable prompt: `docs/incident-response.md`. Not active until
verified on staging.

## 8. Fixes, verification and decision

Branch `fix/security-audit`, uncommitted on b0a0980, reviewed 2026-11-14.

| ID | Fixed by | Test |
| --- | --- | --- |
| SEC-01 | (a) Separate root layouts `(site)` / `(staff)`; only `(site)` mounts inKind and the click counter. (b) `ADMIN_HOST`: the proxy 404s `/admin`, `/en/admin`, `/ru/admin` off the staff host; `isStaffHost` is checked again in the staff layout, `requireStaff`, the sign-in / set-password / sign-out actions and `/admin/refresh`; host-only cookies, `SameSite=Strict` when set; readiness reports `staff_host_unset` in production | `security-audit.test.mjs` (proxy, refresh, `isStaffHost`), `ops.test.mjs` |
| SEC-02 | Headers in `next.config.ts` per ADR-0005 (3); the `/admin` CSP rule is later, so it overrides the site-wide `frame-ancestors` (Next `headers.md:47`) | `security-audit.test.mjs` (config only) |
| SEC-03 | `/media/[id]`: `s-maxage=3600`, misses 60, 503 `no-store` | none (reviewed in code; served header unchecked) |
| SEC-04 | `/admin/refresh` refuses `Sec-Fetch-Site` other than same-origin / none | `security-audit.test.mjs` |
| SEC-05 | mailto encoded; email pattern rejects `?` and `&` | `contact.test.mjs` |
| SEC-06 | `HEALTH_TOKEN` for health, `MONITOR_TOKEN` for incidents, `CRON_SECRET` for cron only | `ops.test.mjs` |
| SEC-07 | Actions pinned to commit SHAs | not run: SHA-to-tag match (release checklist) |
| SEC-08 | `track-all` site-wide bucket (600 / 10 min) | db tests |
| SEC-09, SEC-10 | Open: owner / counsel and staging | — |

**Review rounds.** Code review and security audit (opus) of the fix branch: PASS WITH CONCERNS. Fixed from them: the
owner incident read now re-checks `staff_members` (`security_owner_incidents_read`, owner only); security-event
writes are capped at 60 per code per minute per instance, which is above every detection threshold; the staff-host
redirect is built from `site.url` only; the staff-host check was added inside the app, not only in the proxy.
Re-audit (opus): PASS WITH CONCERNS; its one medium finding (the sign-in actions were reachable through `/ru/admin` on
the public host) is fixed above. Per the two-round rule Anthony approved finishing without a third round. Accepted
lows are in `docs/BACKLOG.md`.

**Gates.** `npm run gate -- verify build db`: see `.gates/report.json`, final run listed in the READY TO SHIP block.

**Not verified (staging, release checklist section Security):** served response headers, off-host requests against a
running server (`/ru/admin/login`, `/%61dmin/login`, `//evil.test`), Vercel's `Host` handling, real Supabase gateway,
alert emails, CI action SHAs.

**Decision.** Fit for staging. Not fit for staff use on the live site until `ADMIN_HOST` is set and the staging
checks pass, and not fit for public launch until SEC-09 (privacy notice) and SEC-10 are closed.
