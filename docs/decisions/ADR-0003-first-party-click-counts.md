# ADR-0003. Count Book now and Call taps ourselves, in Supabase

Date: 2026-11-13 · Status: accepted (Anthony approved the approach the same day)

## Context
- `docs/vision.md` needs monthly evidence once live: Book now (OpenTable) taps, Call taps, inquiries and banquet requests, split by English and Russian. The owner allows analytics only if it is free forever (no paid tier, no expiring trial).
- Inquiries and banquet requests are already stored (`inquiry_private.inquiries`, `kind` = `contact` | `event`, migration 202610100003). Their counts are a query. They have no language column today.
- The two taps leave the site (`tel:`, OpenTable), so nothing records them. Scout A1 (2026-11-13, from search snippets only, not confirmed on the vendors' pages): Cloudflare Web Analytics has no custom events; the GoatCounter and Umami Cloud free tiers don't clearly allow commercial use. Vercel Hobby forbids commercial use, and the host isn't settled (B12).
- No CSP or security-header config exists at HEAD, so a third-party script would need no header change. The site already loads one (inKind, `src/components/layout/inkind-popup.tsx`).

## Decision
- **Migration:** a table `inquiry_private.click_counts (day date, target text check in ('book','call'), lang text check in ('en','ru'), count integer, primary key (day, target, lang))`, with RLS on and no grants to anon or authenticated. Two functions:
  - `public.record_click(p_target, p_lang)`: upserts +1 for today (America/New_York). Callable by service_role only.
  - A staff read that returns monthly totals of clicks plus inquiries by kind. It re-checks `staff_members` membership, like every staff function.
- **As built (B-CC1):** the staff read is `public.staff_click_summary(p_staff, p_months 1-24)` (the dashboard shows 6 months). The route's limiter goes through a public wrapper `public.check_track_limit`, mirroring `check_login_limit`, because the gateway exposes only the `public` schema. The existing `rate_limit_hits` bucket check was widened to allow `track:<hash>`. Starting limit: 30 taps per 10 minutes per client network (`TRACK_LIMIT`, `src/lib/server/track.ts`), not tuned.
- **Route:** `POST /api/track` takes JSON `{target, lang}` only, under a small size limit, and validates both against the two allowed lists. It calls `hit_rate_limit` per client IP bucket, and when the limit is hit or the limiter fails it drops the count (fail closed) and still returns 204. It never stores the IP, user agent, referrer or a cookie, and logs codes only.
- **Client:** one small `"use client"` listener in the `[lang]` layout, not on admin pages. A delegated click handler for `a[href^="tel:"]` and the OpenTable URL from `site.ts` sends `navigator.sendBeacon('/api/track', …)`. Every existing link stays exactly as it is.
- **Admin:** a monthly table on the admin dashboard: Book now, Call (each EN / RU), inquiries, banquet requests.

## Rationale
- Free forever and host-independent, built on the database and rate limiter already in place. No outside company, so no new privacy notice and no cookie banner, because nothing personal is stored.
- What a third-party tool wins at: page views, referrers, devices and countries out of the box, at no build cost. Search traffic is covered by Google Search Console (free) once live. If page views become a real need, revisit Cloudflare Web Analytics for those, after reading its terms.

## Consequences
- Counts are indicative, not exact. Anyone can send fake beacons up to the rate limit, ad blockers may drop some, and a tap is not a completed call or booking (OpenTable's own reports hold confirmed bookings).
- Adds one migration, one public API route and one staff function: all high-risk work (gates, `test:db`, code-reviewer, security-auditor).
- Not done (BACKLOG): language split for inquiries (needs a column and an intake change); page views; CSV export.
- Revisit if the counts get spammed, the owner wants page views, or the host choice brings free first-party analytics.
