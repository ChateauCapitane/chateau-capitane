# Backlog

The single list of deferred work. Anything a slice skips, an unfixed review finding, a known shortcut or a risk is added here **in the same change**. Delete a line when its item is built. Only the owner moves an item to "Dropped".

## Risks

- Dev-only advisories (2026-11-12, `npm audit`: 9 = 8 moderate + 1 high; runtime has 0): `minimatch` high GHSA-g3hv-75wg-m249 via `@typescript-eslint/typescript-estree`, and `zod` <4.6.6 moderate via `eslint-plugin-react-hooks`. Both come in through `eslint-config-next`; the minimatch fix needs `--force`. Recheck before release.
- `npm audit signatures` (registry signature check) couldn't run in the cloud container ("Failed to download", cause unconfirmed). Run it on the owner's PC or in CI.
- Lockfile: npm on Linux (10.9.9 and 11.21.2) dropped 38 `"libc"` entries from `package-lock.json` during the 16.4.6 upgrade. Linux installs may fetch both the glibc and musl native builds (extra download, nothing broken), and a Windows npm may add them back (noisy diff).
- Real Supabase gateway, Auth and migration workflow never exercised (B02c). Must run on staging before release.
- Unchecked until deployed: Resend delivery and the live webhook `tags` shape, Vercel cron behaviour, Vercel request-size limits, real `x-vercel-forwarded-for` values, real Supabase restore.
- GitHub CI (`.github/workflows/ci.yml`) has never been seen running.
- Accepted shortcuts: the Supabase secret key doubles as the rate-limit HMAC key; a few networks can fill the site-wide contact cap (guests then see the phone number); a retry lost during a package rename gives a 409 and a possible duplicate.

## Deferred work

- B12 staging and release ([release checklist](release-checklist.md)): blocked on the owner's accounts.
- Uptime monitor and alert destination; real restore drill on staging.
- Staff access: forgot-password form, MFA, role management screen (roles are SQL-only today).
- Inbox: assignment field, filter by kind, review screen for unmatched delivery events. Search is a sequential scan; fine at current volume.
- Content publishing: add or remove whole sections or packages, reordering, closing after midnight, pruning old versions.
- Gallery: reordering, new sections, crop control; unused photos are cleaned up by hand; removed photos can linger about 2 hours in caches.
- Russian: staff can't enter Russian text, so new staff-edited dishes show in English on `/ru` until added to `src/lib/i18n/content-ru.ts`.
- Lint: unused `eslint-disable` directive at `src/app/apple-icon.tsx:16`.## Dropped

(Owner only.)
