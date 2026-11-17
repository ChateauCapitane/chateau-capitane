# Backend operations (B11)

Status: B11a (health check, structured logs, CI), B11b (backups runbook, local restore drill, retention cleanup) built. Still open: environment separation notes, real restore on a staging project and monitor setup (B12).

## Health check

`GET /api/health`

- No credentials: `200 {"ok":true}`. Proves only that the site is running; touches no storage, except that any `Authorization` header causes one security-event write, capped at 60 per event code per minute per instance.
- `Authorization: Bearer $HEALTH_TOKEN` (the uptime monitor's own token, not `CRON_SECRET`; ADR-0005): reads `public.ops_snapshot()` (counts and ages only, no guest data) and answers `200` when healthy, `503` otherwise, with `status` (`ok` / `attention` / `down`), `problems` and the numbers.

Point an uptime monitor at it with that header; it alerts on any non-200. Problem codes:

| Code | Meaning | First action |
| --- | --- | --- |
| `storage_unreachable` | Database did not answer (or is not configured) | Check Supabase status and `SUPABASE_URL` / `SUPABASE_SECRET_KEY`. Staff sign-in and content publishing are down; public pages keep working. |
| `staff_host_unset` | Production without `ADMIN_HOST`, so the staff pages are not limited to their own host | Set `ADMIN_HOST` in Vercel (production) and redeploy. |

The snapshot also reports `loginHitsNow` (active sign-in attempt counters; a sudden jump means password guessing, which is already rate limited).

## Logs

Server failures (staff sign-in, content publishing, click counts, crons) print one JSON line: `{"level":"error","source":...,"code":...,"requestId":...}`. `requestId` is Vercel's `x-vercel-id` (visible in Vercel's request log) so a log line can be matched to one request. The `code` is a fixed word; personal data and keys are never logged.

## CI

`.github/workflows/ci.yml` runs on every push and pull request: install from the lockfile, lint, unit tests, database tests (throw-away embedded PostgreSQL with every migration; no hosted database), production build. Not yet run on GitHub (nothing is pushed); first push shows whether the Linux database binaries start there.

## Backups and recovery

Facts from Supabase's backup documentation (checked 2026-10-10; re-check prices before purchase):

- Pro keeps the **last 7 daily backups**. Worst case you lose up to a day of content edits and photos (photos live in the database, so they are covered).
- Point-in-time recovery (to within about 2 minutes) is an add-on, about $100/month for 7 days, and needs at least the Small compute add-on. Turning it on stops the daily backups. Owner decision: not needed at launch volume unless the restaurant cannot tolerate losing a day of inquiries; the notification email to staff is a second copy of every inquiry.
- Restoring makes the project unavailable while it runs. Daily backups do not keep custom role passwords. Deleting a Supabase project deletes its backups too, so keep the project and add a periodic off-site export (`supabase db dump`) once the owner approves a storage place.
- Supabase Storage files are not in backups; this site stores nothing there.

### Restore drill (done 2026-10-10, local)

Hosted restore cannot be exercised before provisioning. What was exercised: build a database from every migration plus seed, stop it, copy the data directory, start the copy on another port and compare rows (content revisions identical; `ops_snapshot()` runs on the copy). Script: `.local-db-tests/restore-check.mjs` (ignored; recreate from this paragraph). Not covered: a real Supabase dashboard restore (do it on a staging project in B12 before launch) and `pg_dump` (not installed here).

### If data is lost or wrong

1. Pause retention cleanup (unset `RETENTION_ENABLED`).
2. Restore the closest backup before the problem, preferably into a new/staging project first, and look at it.
3. Only then switch the live project over and re-enable retention.

## Retention (owner approved 2026-10-10)

| Data | Kept | Then |
| --- | --- | --- |
| Guest inquiries | None stored: the forms and inquiry tables were removed (ADR-0006, migration 202611160001) | n/a |
| Staff role-change history | 24 months | Deleted |
| Security event counts | 30 days | Deleted |
| Security actions, closed security incidents | 12 months | Deleted |
| Content versions, published history, photos | Not deleted | Revisit if the database grows |

How it runs: a daily Vercel Cron (`/api/cron/retention`, 03:17 UTC) calls `public.run_retention()` in batches of 200 until nothing is left or 20 batches. Nothing is deleted unless the environment setting `RETENTION_ENABLED=1` is set, so **switch it on only at release** and pause by removing it. Deleted rows remain in backups until those expire (7 days on Pro).

## Alerts

Free uptime monitor (owner, 2026-10-10); its alerts go to Anthony, not the owner (Anthony, 2026-11-16). Setup is manual, account under Anthony's email: create an HTTPS monitor for `https://<site>/api/health`, every 5 minutes, add the header `Authorization: Bearer <HEALTH_TOKEN>`, alert when the status is not 200. Not set up (no deployment yet); do it in B12.

## Environments

| Setting | Local | Preview (Vercel preview deployments) | Production |
| --- | --- | --- | --- |
| `SUPABASE_URL` / `SUPABASE_SECRET_KEY` | Unset, or loopback test database | Separate staging Supabase project (synthetic data only), never the production keys | Production project |
| `RESEND_API_KEY`, `CONTACT_FROM_EMAIL`, `SECURITY_ALERT_EMAIL` (security alerts only) | Unset | Unset: no alert email is sent, incidents are still recorded | Set at release only |
| `RETENTION_ENABLED` | Unset | Unset | `1` at release |
| `CRON_SECRET`, `HEALTH_TOKEN` | Test values | Own values | Own values |
| `ADMIN_HOST` (staff host, ADR-0005) | Unset | Unset | `admin.<domain>` once its DNS record exists |

Set production values only on Vercel's Production scope so previews cannot read them. Vercel runs cron jobs on production deployments only, so previews never send mail or clean data by themselves.
