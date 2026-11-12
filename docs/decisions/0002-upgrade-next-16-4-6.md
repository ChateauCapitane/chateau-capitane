# 0002. Upgrade Next.js to 16.4.6 for security advisories

Date: 2026-11-12 · Status: accepted

## Context
- `npm audit` lists three advisories for `next` 16.4.0 (affected range `>=16.0.0 <=16.4.0`). Two are critical unauthenticated remote code execution: GHSA-2464-fhr4-w9xw (image optimization API with SVG files) and GHSA-673q-mjm6-r5xr (`use cache` functions returning typed arrays). One is high: GHSA-p3m5-59mp-jv5r (App Router Server Actions DoS).
- Exposure: the site uses Server Actions (staff admin forms), so the DoS applies. It has no `use cache`, so the second critical advisory is probably unreachable. Whether the SVG image path is reachable isn't proven either way.
- npm's suggested fix is 16.4.6 (2026-11-09), the newest 16.4.x patch. Its peers accept React 19.2.8, and it needs Node 20.9 or newer (CI uses 22).
- Next.js also fails the first agent-run build while an advisory applies, which slows every slice.

## Decision
Pin `next` and `eslint-config-next` to exactly `16.4.6` (both versions move together) with `npm install --save-exact`, keeping the lockfile. No other dependency changes.

## Consequences
- The three advisories close. The production build no longer stops for the upgrade warning.
- This is a patch inside the same minor version, so breaking changes are unlikely, but not impossible. The build plus a production check of every route catches build and routing breaks. Subtle visual or behaviour changes would only show in a full browser pass, which this slice doesn't do.
- The dev-only ESLint glob-chain advisories are untouched (they stay in BACKLOG).
