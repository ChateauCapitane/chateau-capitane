# Staging and release checklist (B12)

Nothing here has been run: no staging project, deployment or live email exists yet. Guests only call or book on OpenTable (ADR-0006); the only email is the security alert to the owner. Do the steps in order; each needs the owner's go-ahead where marked **(owner)**. Use made-up guests only (names like "Test Guest", emails ending `.invalid` until the live-email step).

## 1. Accounts and costs (owner)

- Vercel Pro (the 5-minute security cron is rejected on Hobby) and Supabase Pro, in the company's name, regions `iad1` / `us-east-1`; about $45/month. Details: [provider decision](plans/backend-provider-decision.md).
- Resend account, the sending domain verified (SPF/DKIM records at the domain host), the owner address that receives security alerts.
- Free uptime monitor account (owner's email receives alerts).
- Names and emails of the first staff (owner role first).

## 2. Staging project (synthetic data)

1. Create a **separate** Supabase project for staging. Never reuse production keys.
2. Apply every file in `supabase/migrations/` in order (supported Supabase workflow; this is also **B02c**, the first time the database is checked through the real gateway and Auth). Keep the private schema unexposed.
3. Vercel Preview scope: staging `SUPABASE_URL` / `SUPABASE_SECRET_KEY`, own `CRON_SECRET`; leave `RESEND_API_KEY` unset (no alert email is sent).
4. Add the first staff member: [Staff access (B06)](../supabase/README.md#staff-access-b06).

## 3. Staging acceptance (tick each, note date)

| Area | Check |
| --- | --- |
| Calls only | `/contact` and `/private-events` show Call and Book now, no form; `POST /api/contact` returns 404. `/api/health` with the Bearer token shows `ok`. |
| Staff access | Invite email link sets a password; sign-in works; remove the member in SQL, next page load signs them out. |
| Content | Edit hours and a menu price, preview, publish: public pages change within the hour (or at once after publish); roll back. |
| Gallery | Upload a phone-sized photo, refused disguised file, publish, remove, rollback. |
| Buttons | OpenTable "Book now" and every "Call" link still work on `/`, `/menu`, `/private-events`, `/contact`. |
| Restore | Dashboard restore of a staging backup into a scratch project; compare row counts and run `/api/health`. Follow "If data is lost or wrong" in [operations](backend-operations.md). |
| Health/monitor | Create the uptime monitor on the staging URL with `Bearer HEALTH_TOKEN`; confirm it alerts when the token is wrong. |
| Security | Supabase Auth sign-up is OFF. Response headers present (`curl -I`), and `curl -I` on `/admin/login` shows the full staff CSP (`script-src 'self'`), not only `frame-ancestors`. Staff host: `/admin`, `/ru/admin/login`, `/%61dmin/login` and `/admin/refresh` 404 on the public host and work on `ADMIN_HOST`; `https://<admin-host>//evil.test` stays on the site; `/api/health` with `HEALTH_TOKEN` shows no `staff_host_unset`. CI action SHAs match their tags (`git ls-remote https://github.com/actions/checkout v4.4.0`, same for `setup-node`). Incident checks in [incident-response.md](incident-response.md) "Verify before calling it active". |
| CI | First push: the `ci.yml` run is green on GitHub (including the database tests on Linux). |

Also re-run `npm audit --omit=dev` and review the dev-only ESLint advisories before release.

## 4. Production release (owner approves each line)

1. **Push** the branch (explain: pushing triggers CI and, if the repo is linked to Vercel, a preview build; merging to `main` deploys production automatically).
2. Create the production Supabase project, apply migrations, add owner and staff.
3. Vercel Production scope only: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `CONTACT_FROM_EMAIL` (verified domain), `SECURITY_ALERT_EMAIL`, `CRON_SECRET`, `HEALTH_TOKEN`, `MONITOR_TOKEN`, `ADMIN_HOST` (with its DNS record; **required before staff use the live site**, audit SEC-01). Leave `RETENTION_ENABLED` unset for the first week, then set `1`.
4. Deploy. Create the production uptime monitor on `/api/health`.
5. **Live email (owner)**: confirm the first security alert email reaches `SECURITY_ALERT_EMAIL` (there is no test-alert button yet; BACKLOG). Do not book a real table via OpenTable.
6. Watch `/api/health` and `/admin/security` for a day.

## Rollback and reconciliation

| Problem | Do |
| --- | --- |
| Bad deploy | In Vercel, promote the previous deployment (instant). Database migrations are additive; do not undo them. |
| Bad content or photo | Staff: roll back to the previous version in `/admin/content` (no deploy). |
| Alert emails not sending | Check `RESEND_API_KEY`, `CONTACT_FROM_EMAIL` and `SECURITY_ALERT_EMAIL`; incidents are still recorded in `/admin/security`. |
| Data loss | "If data is lost or wrong" in [operations](backend-operations.md): pause retention, restore into a new project, then switch. |
| Staff account misuse | Delete the member row (SQL, see B06 docs) and revoke the user in Supabase Auth. |

## Known limits to tell the owner

A staff member who opens an `/admin` link from an email or another site after the short sign-in token has expired lands on the sign-in page once (cross-site refresh refused, SEC-04; with `ADMIN_HOST` set also strict cookies), by design. No MFA or forgot-password form, roles changed by SQL only, no inbox kind filter, no photo reordering, the build fails if storage is configured but unreachable, backups lose up to a day (PITR is an optional $100/month). Full list in `supabase/README.md`.
