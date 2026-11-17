# Backlog

The single list of deferred work. Anything a slice skips, an unfixed review finding, a known shortcut or a risk is added here **in the same change**. Delete a line when its item is built. Only the owner moves an item to "Dropped".

## Risks

- Dev-only advisories (2026-11-12, `npm audit`: 9 = 8 moderate + 1 high; runtime has 0): `minimatch` high GHSA-g3hv-75wg-m249 via `@typescript-eslint/typescript-estree`, and `zod` <4.6.6 moderate via `eslint-plugin-react-hooks`. Both come in through `eslint-config-next`; the minimatch fix needs `--force`. Recheck before release.
- `npm audit signatures` (registry signature check) couldn't run in the cloud container ("Failed to download", cause unconfirmed). Run it on the owner's PC or in CI.
- Lockfile: npm on Linux (10.9.9 and 11.21.2) dropped 38 `"libc"` entries from `package-lock.json` during the 16.4.6 upgrade. Linux installs may fetch both the glibc and musl native builds (extra download, nothing broken), and a Windows npm may add them back (noisy diff).
- Real Supabase gateway, Auth and migration workflow never exercised (B02c). Must run on staging before release.
- Unchecked until deployed: Resend delivery and the live webhook `tags` shape, Vercel cron behaviour, Vercel request-size limits, real `x-vercel-forwarded-for` values, real Supabase restore.
- GitHub CI (`.github/workflows/ci.yml`) has never been seen running.
- Click counts (ADR-0003, security audit 2026-11-13, low): off Vercel there is no `x-vercel-forwarded-for`, so every tap shares one "unattributed" rate-limit bucket (30 per 10 min) and real taps get dropped. Recheck when the host is chosen (B12). The beacon and the `/admin` exclusion were checked in a local browser on 2026-11-13; the count reaching a real database is still unchecked (staging check in manual-checks).
- Security events (audit 2026-11-14, low): the write cap (60 per event code per minute) is per server instance, so the real ceiling grows with Vercel instances (`ponytail:` in `src/lib/server/security/record.ts`); and it is per code, not per network, so one flooding network can crowd out a quieter second one's events for that minute (detection still fires for the flooder). Upgrade: a shared bucket in the database, a per-network share.
- Security (audit 2026-11-14, low): a track flood above the site-wide cap (600 per 10 min) drops real tap counts for everyone (fails closed by design). Staff host and the `isStaffHost` check trust the raw `Host` header; correct on Vercel, recheck if B12 moves hosting behind another proxy.
- Accepted shortcuts: the Supabase secret key doubles as the rate-limit HMAC key; a few networks can fill the site-wide contact cap (guests then see the phone number); a retry lost during a package rename gives a 409 and a possible duplicate.

## Deferred work

- Analytics leftovers from ADR-0003: language split for inquiries (column + intake change), page views (Search Console covers search; revisit Cloudflare Web Analytics terms if needed), CSV export.

- B12 staging and release ([release checklist](release-checklist.md)): blocked on the owner's accounts.
- Uptime monitor and alert destination; real restore drill on staging.
- Staff access: forgot-password form, MFA, role management screen (roles are SQL-only today).
- Inbox: assignment field, filter by kind, review screen for unmatched delivery events. Search is a sequential scan; fine at current volume.
- Content publishing: add or remove whole sections or packages, reordering, closing after midnight, pruning old versions.
- Gallery: reordering, new sections, crop control; unused photos are cleaned up by hand; removed photos can linger about 2 hours in caches.
- Russian: staff can't enter Russian text, so new staff-edited dishes show in English on `/ru` until added to `src/lib/i18n/content-ru.ts`.
- Lint: unused `eslint-disable` directive at `src/app/apple-icon.tsx:16`.
- UI audit fixes (2026-11-14, [ui-audit.md](ui-audit.md), report only so far). Suggested order: H1 320px sideways
  scroll and the RU menu button cut off → (M1+M2 dropped with the contact form, ADR-0006) →
  M4 staff sign-in shows the public header and a RU link to a 404 → quick wins (L1 404 title, L2 typo, L3 "Позвонить",
  em dashes in EN copy; RU dashes need a rule decision) → L4 image `sizes`. S1-S4 suggestions and an inKind popup check
  on a preview deploy.
- Leftovers of the calls-only removal (ADR-0006, reviews 2026-11-16, all harmless dead names):
  `.env.example` still lists `CONTACT_TO_EMAIL` and `RESEND_WEBHOOK_SECRET` (the builder's session may not read env
  files; Anthony can delete those two lines). Dead security rule R4 (Resend webhook) in `security/rules.ts:61-67` and
  `webhook_bad_signature` in `record.ts`. The DB check constraints and `security_gate` still accept `contact_*`,
  `contact` and `pause_contact`; a stale comment at `api/health/route.ts:8`. `events.packageLabel` / `packageLabel()`
  may be unused. No live database ever ran, so no `pause_contact` rows can exist.
- Release: there is no "send a test security alert" button; step 5 of the release checklist waits for a real alert.
- Owner answers to apply (2026-11-16, from the [launch roadmap](https://claude.ai/artifact/2knxWr3TM1zwZEfhbmiHiJ)):
  lunch $25 (keep); Fri/Sat $100 minimum is per person (keep); pelmeni/vareniki $16 per plate (keep); add the
  "Special Garnishes $6" list (angel hair pasta, mushroom couscous, creamy risotto, home potatoes, creamy polenta,
  Brussels sprouts); neighborhood Gravesend; valet parking; nearest subway Q at Neck Rd; delivery via Uber Eats or by
  phone; no happy hour; price range $$$; inKind shows on `/ru` and the owner accepted its terms. Still open: dietary
  dishes, email in schema, ratings, room photos, name spelling, whether inKind works off the final domain.
- Gallery photos: no sharp, text-free photos of the dining room, bar or banquet tables exist as stills (only in reels),
  so "The rooms" is hidden and "Private events" has one photo (a lonely row at 768px and up). Needs real room and
  banquet photos from the owner, or stills from the restaurant's reels.

## Workflow (ADR-0001)

- `scripts/overseer.mjs` budgets are SteamRoller's (warn 1500, stop 3500 changed lines); recalibrate after about 10 merged slices here.
- No automated browser suite (e2e/visual gate steps). UI checks are Playwright MCP screenshots by hand; add a suite only if a UI regression slips through.
- No hand-check gate inside `npm run verify` (SteamRoller's `handChecks.mjs`); the return gate is enforced by `/go` reading `docs/manual-checks.md`.

## Dropped

(Owner only.)
