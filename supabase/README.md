# Database (Supabase)

PostgreSQL migrations for Supabase. The private `inquiry_private` schema holds staff access, published content, photos, click counts, rate limits and security monitoring. Do not add it to Supabase's exposed API schemas. Every `public` function uses invoker privileges and only `service_role` may run it. The schema name is historical: guest inquiries were removed by `migrations/202611160001_remove_inquiries.sql` (ADR-0006), which drops the inquiry, notification and delivery tables and their functions. Guests call or book on OpenTable, and the site stores no guest messages.

## Local verification

Run `npm.cmd run test:db` (or `npm run test:db` outside PowerShell). Development-only `embedded-postgres` supplies pinned PostgreSQL 17.10 binaries. The runner creates a unique ignored `.local-db-tests/run-*` cluster, selects an ephemeral port and listens only on `127.0.0.1` with a random password. It ignores external database URLs, creates fresh test databases and stops its own cluster after the suite. Generated fixtures are retained for diagnosis; the runner does not recursively delete directories. No machine service or host user is installed. Install scripts required by the package may need approval under your npm policy.

The harness creates the three Supabase role names for SQL tests. It proves migration rebuild, reconnect persistence, constraints, grants and deny-by-default RLS. It **does not** run Supabase's API gateway, Auth, CLI migrations or hosted infrastructure. No remote reset is part of this workflow. `seed.sql` holds no data.

## Server contract

`src/lib/server/inquiries/persistence.ts` is marked `server-only`. Configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in ignored environment files or provider secrets. New Supabase secret keys are sent in `apikey`; they are not bearer JWTs. The current module accepts `sb_secret_` keys and HTTPS (HTTP only for loopback development). It makes one no-store POST with a bounded response and ten-second timeout. It never logs provider bodies, retries automatically or exposes credentials.

Staff membership: see "Staff access (B06)" below. [Provider decision](../docs/plans/backend-provider-decision.md).

## Rate limits

`rate_limit_hits` (fixed-window counters, shared by every Vercel instance) backs the sign-in limit (`check_login_limit`) and the click-tracking limit (`check_track_limit`). Only a keyed HMAC of the client network is stored, never an address. Client identity is `x-vercel-forwarded-for` only (`clientNetwork` in `src/lib/server/inquiries/abuse-limit.ts`). Limiter failures fail closed.

## Staff access (B06)

`migrations/202610100001_staff_access.sql` adds `staff_members` (user ID, role `owner` or `staff`) and `public.staff_role(user)`. `service_role` can only **read** it: rows are added, changed or removed only by the database owner (Supabase SQL editor or a migration), so no website request and no staff member can grant or change a role. Auth user metadata (`user_metadata`/`app_metadata`) is never consulted. It also adds `check_login_limit`, which reuses the B05 counters under `login:<HMAC>` buckets (10 sign-in or email-link attempts per client network per 15 minutes, `LOGIN_LIMIT` in `src/lib/server/auth/staff-auth.ts`; fails closed).

Code: `src/lib/server/auth/staff-auth.ts` (Supabase Auth REST calls over fetch, no client library), `src/lib/server/auth/session.ts` (cookies, `requireStaff`), `src/app/admin/` (pages, Server Functions, `/admin/refresh`).

- **Session.** Tokens live only in `httpOnly`, `SameSite=Lax`, `Path=/admin` cookies (`Secure` in production); page scripts cannot read them and public pages never receive them. The access cookie ends a minute before the token; `/admin/refresh` then renews it with the refresh token and returns to the page. 12 idle hours end the sign-in.
- **Every page and action** calls `requireStaff`, which asks Supabase Auth to confirm the session (`GET /auth/v1/user`; signed-out or deleted sessions fail there) and re-reads `staff_role`. Removing a row therefore blocks the person on their next page load or action. A rejected or revoked session is sent to `/admin/refresh?end=1`, which revokes it at Supabase and clears the cookies. Admin responses are `no-store` and `noindex`.
- **Sign-out** revokes the session at Supabase using the refresh token, so it works after the access cookie has expired.
- **CSRF.** Sign-in, password and sign-out are Next.js Server Functions (POST only; Next.js rejects a mismatched `Origin`).
- **Sign-in errors** use one message for wrong password, unknown email and non-staff accounts. A non-staff account that authenticates is signed straight out and receives no cookies.

Setup at provisioning (needs owner authorization because it sends real email):

1. Supabase Dashboard → Authentication → Sign In / Providers: turn **off** "Allow new users to sign up". Keep email provider on. Optionally set a session inactivity timeout.
2. Authentication → URL Configuration: Site URL = the production site.
3. Authentication → Email Templates, **Invite user** and **Reset password**: change the link to `{{ .SiteURL }}/admin/confirm?token_hash={{ .TokenHash }}&type=invite` (use `type=recovery` for reset). Opening the page changes nothing; the single-use token is spent only when the person submits a new password (at least 12 characters), so mail scanners cannot consume it. A rejected password still spends the link; send a new one.
4. Invite the person (Authentication → Users → Invite), then grant access in the SQL editor: `insert into inquiry_private.staff_members (user_id, role) values ('<user id>', 'staff');` (`'owner'` for the owner).

Revoke: `delete from inquiry_private.staff_members where user_id = '<user id>';` (takes effect on their next request; no data is removed). To also end their sessions, sign the user out or delete them under Authentication → Users. Emergency: deleting all rows closes the admin area for everyone.

Not included yet: a "forgot password" form (the owner sends resets from the dashboard), multi-factor sign-in, and role management in the site (deliberately SQL-only). Login limits count per network; Supabase's own Auth limits see only the server's address, so heavy failed sign-ins from many networks can still trip them for everyone.

## Content publishing (B09)

`migrations/202610100004_content_publishing.sql` stores the editable restaurant content (menus, dining and lunch-special hours, lunch price and options, dining policies, banquet packages with prices) as versions in `inquiry_private.content_revisions`, and which version is live in the append-only `content_publications`. Prices are integer US cents; package and lunch prices are whole dollars. The phone number, OpenTable link and lunch rules (three courses, beverages excluded) stay in code and are not part of the stored content.

- **Who.** Any signed-in staff member (`staff_members`, owner or staff) can edit and publish at `/admin/content`. Every save is a new version; the newest version is the draft; history shows who saved and who published. Write RPCs (`staff_save_content_draft`, `staff_publish_content`) are security definer and re-check membership; the server key can only read the tables.
- **Flow.** Edit a section → "Save draft" (refused with a message, typed values kept, if a price, schedule or text is invalid, or if someone else saved since the form was loaded) → "Preview draft" (staff-only, same page bodies as the site) → "Publish draft". Rollback: "Publish" on an older version; "Copy to draft" restores an older version as the new draft. Every save and publish is validated again on the server.
- **Public pages.** `/`, `/menu`, `/private-events`, `/contact`, the footer hours and the structured data read the published content (`src/lib/server/content/content.ts`). Pages stay static; publishing expires the `site-content` cache tag so they re-render on the next visit, and the cache also refreshes hourly.
- **Fallback.** No storage configured, or nothing published yet: the built-in content in `src/lib/data/`. Storage configured but unreadable, or the published version fails validation: nothing new is cached and Next.js keeps serving the last rendered pages; the footer and structured data fall back to the built-in hours so staff pages keep working; event inquiries get 503 with the call-us message.
- **Recovery.** Publish a known-good version from `/admin/content`. If the editor itself is unavailable, as the database owner: `insert into inquiry_private.content_publications (revision_id, publisher_id, publisher_email) values (<id>, '<owner user id>', '<owner email>');` The site picks it up within an hour, or at once on the next publish from the editor.
- **Known limits.** Whole menu sections and packages cannot be added or removed in the editor (dishes and package courses can); new dishes go to the end of a section; hours close on the same day (no closing after midnight); versions are never pruned (B11 retention); USD only. A build with storage configured but unreachable fails rather than shipping built-in content.

## Gallery photos (B10)

`migrations/202610100005_gallery_media.sql` adds `inquiry_private.media_assets`: uploaded photos stored in the database (not Supabase Storage), so they are backed up and restored with everything else and need no separate service. The gallery itself is part of the content document from B09 (`gallery` sections with photos: description, caption, shape, and either a built-in file `src`, an uploaded `media` ID with its source date and link, or neither, which shows a labelled placeholder). Versions saved before this have no gallery and show the built-in one.

- **Who and where.** Any signed-in staff member, at `/admin/content` → "Gallery: …". Each section page lists its photos (description, caption, replace, remove) plus two blank slots for new photos. Photos publish with the rest of the content: save draft → preview (Gallery tab, staff-only copies) → publish; rollback republishes an older version.
- **Upload.** The browser shrinks large phone photos to 2400 px first (Vercel rejects request bodies over 4.5 MB; the server accepts at most 3.5 MB per photo and 4 MB per save: add one or two photos per save). The server decodes the file as a real JPEG, PNG or WebP (at most 50 megapixels, at least 400 px on the shorter side, shapes between 3:5 and 9:5), applies camera rotation, shrinks to 2000 px, re-encodes as WebP at quality 80 and stores that. Re-encoding drops EXIF/location data and anything hidden in the file. The nearest of five fixed crop shapes is chosen. Nothing is fetched from a URL; the source link is stored text only.
- **Provenance.** Every uploaded photo needs a date taken or posted, in 2026 or later and not in the future (`media_assets.source_date` is also checked by the database), and may have an https source link; both show on the editor page next to the photo. Built-in photos from the original site remain until intentionally replaced or removed.
- **Privacy.** An asset is private until the live content version lists it. `/media/<id>` (public) serves it only then (`published_media`); `/admin/media/<id>` serves any photo to signed-in staff, never cached. Public responses are cached for one hour (the image optimizer matches it, `minimumCacheTTL`), so a removed or rolled-back photo can linger up to about two hours.
- **Storage limits.** At most 500 photos (database-enforced) and 2 MiB each. Assets are immutable and never deleted by the application, and an upload whose save is later refused (for example someone else saved first) stays unused: clean up unreferenced assets by hand as the database owner after an agreed grace period (a photo is referenced if its ID appears in any `content_revisions.document`). To switch to Supabase Storage later, copy `data` out and change `/media` and `/admin/media`.
- **Known limits.** No reordering, no new gallery sections, no crop control (uploads use the nearest fixed shape and `object-cover`), no HEIC upload from desktop Chrome (phones convert on selection), date/link fields typed for an existing photo without choosing a file are ignored, new post photos still need the owner to confirm each is a verified 2026 post. Unchecked: a real Supabase gateway (B02c) and real Vercel body limits.
