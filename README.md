# Château Capitaine

Marketing website for Château Capitaine, a bar and grill on Coney Island Avenue in Brooklyn.

Next.js 16 (App Router), TypeScript, and Tailwind CSS v4. Public pages are pre-rendered from typed data files; staff publish menu, hours and photo changes through `/admin` (Supabase). Guests call or book on OpenTable; there are no guest forms.

## Getting started

```bash
npm ci
npm run dev                  # http://localhost:3000
```

To run the staff pages and other server features locally, copy `.env.example` to `.env.local` and supply the server-side settings described below. In PowerShell, use `Copy-Item .env.example .env.local`. Node.js 20.9 or newer is required by the installed Next.js version. If PowerShell blocks npm's script wrapper, use `npm.cmd` and `npx.cmd`.

Before calling an application change done, run both of these. Each must pass with no errors. Documentation-only checks and browser verification are described in [validation.md](docs/validation.md).

```bash
npm run build
npm run lint
```

## Pages

English is served at the site root and Russian under `/ru` (for example `/menu` and `/ru/menu`). Both come from one set of pages in `src/app/[lang]/(site)/` (staff pages live in `(staff)/admin/` under their own root layout, so third-party scripts never load there; ADR-0005); `src/proxy.ts` rewrites English addresses to `/en/...` and redirects a visible `/en/...` back to the root. Fixed wording lives in `src/lib/i18n/en.ts` and `ru.ts` (same keys, enforced by the type); menu, banquet and gallery text is translated by exact English string in `src/lib/i18n/content-ru.ts` and falls back to English when a string has no entry. The language button is `src/components/layout/language-switch.tsx`.

| Route | File |
|---|---|
| `/`, `/ru` | `src/app/[lang]/(site)/page.tsx` |
| `/menu` | `src/app/[lang]/(site)/menu/page.tsx` |
| `/private-events` | `src/app/[lang]/(site)/private-events/page.tsx` |
| `/gallery` | `src/app/[lang]/(site)/gallery/page.tsx` |
| `/about` | `src/app/[lang]/(site)/about/page.tsx` |
| `/contact` | `src/app/[lang]/(site)/contact/page.tsx` |
| `/testimonials` | `src/app/[lang]/(site)/testimonials/page.tsx` |
| 404 | `src/app/[lang]/(site)/not-found.tsx` |

Staff pages (`/admin`) stay English only; `/ru/admin` is a 404. How staff sign in and change the menu, hours and
photos, in plain steps: [docs/staff-guide.md](docs/staff-guide.md).

The admin dashboard shows the last 6 months of Book now and Call taps (English / Russian). Taps are counted first-party in Supabase, with no cookies or personal data (`src/app/api/track/route.ts`,
[ADR-0003](docs/decisions/ADR-0003-first-party-click-counts.md)). They are indicative counts, not confirmed bookings or calls.

## Editing content

| What | Where |
|---|---|
| Name, address, phone, email, hours, social links, domain | `src/lib/data/site.ts` |
| Menu and the lunch special | `src/lib/data/menu.ts` |
| Banquet packages | `src/lib/data/private-events.ts` |
| Guest reviews | `src/lib/data/testimonials.ts` |
| Gallery photos | `src/lib/data/gallery.ts` |

`site.ts` is the single source for business details. The header, footer, contact page, structured data, and sitemap all read from it, so change a phone number or hours there and nowhere else.

## Adding photos

Put image files in `public/photos/`.

- **Gallery:** set `src` on the matching entry in `gallery.ts` (for example `"/photos/bar.jpg"`). The entry's `alt` text is already written. Until any gallery photo has a `src`, the gallery page stays out of search results and out of the sitemap. Both switch on automatically once one does.
- **Other slots** (home, about, private events): each `PlaceholderImage` has a `label` describing the shot it needs. Pass a real photo path through its `src` prop to render the photo at the same aspect ratio without changing the layout.

## Calls and bookings only

Guests reach the restaurant by calling or booking on OpenTable. There is no contact form, inquiry inbox or inquiry
email ([ADR-0006](docs/decisions/ADR-0006-calls-and-opentable-only.md)), and the site stores no guest messages.
Server settings (see [supabase/README.md](supabase/README.md) for the database):

| Variable | Purpose |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Staff sign-in, published content, click counts, security records. Server-only. |
| `RESEND_API_KEY` | Resend API key, used only for security alert emails. Server-only. |
| `CONTACT_FROM_EMAIL` | Sender address of security alert emails. Until the domain is verified in Resend, use its test sender, `Château Capitaine <onboarding@resend.dev>`. |
| `CRON_SECRET` | Authenticates the scheduled workers (security scan, retention). Random, 16+ characters. |
| `HEALTH_TOKEN` | Uptime monitor's bearer for `/api/health` readiness. Random, 16+ characters, different from `CRON_SECRET`. |
| `ADMIN_HOST` | Optional staff host (e.g. `admin.<domain>`): staff pages are served only there (ADR-0005). Leave unset locally. |
| `MONITOR_TOKEN` | Bearer for the read-only incident API (`/api/security/incidents`). Random, 16+ characters, different from the other tokens. Unset means the API refuses everyone (ADR-0004). |
| `SECURITY_ALERT_EMAIL` | Where security alert emails go (needs `RESEND_API_KEY` and `CONTACT_FROM_EMAIL`). Unset: incidents are still recorded, nothing is emailed. |
| `SECURITY_ACTIONS_DISABLED` | Emergency stop. Set to `1` and every block stops applying at once, and new ones are refused. |

`npm run verify` runs the mocked unit tests (Node's built-in runner); `npm run test:db` runs the real-database tests.

## Before launch

- Set `site.url` in `src/lib/data/site.ts` to the production domain. Canonical URLs, the sitemap, `robots.txt`, share images, and structured data all derive from it.
- Old WordPress URLs redirect to their new pages through `next.config.ts`. This only has an effect if the old domain points at this site.
- Once the domain is verified in Resend, switch `CONTACT_FROM_EMAIL` (security alerts) to an address on that domain.

## Other files

- `src/components/ui/logo-mark.tsx` is the logo: a captain's cap on an anchor with a loose rope. It's an inline SVG that takes its color from the surrounding text color. The header, the footer, and the share image use it.
- `src/app/icon.svg` is a bolder cut of the logo, without the rope, for the browser tab. `src/app/apple-icon.tsx` generates the iOS home-screen icon from that file.
- `assets/fonts/` holds the TTF files the share image (`src/app/opengraph-image.tsx`) renders with. Both fonts are under the SIL Open Font License, and a copy of each license sits in the same folder.

## Working with ChatGPT Codex

Open this repository in Codex. [AGENTS.md](AGENTS.md) supplies the project instructions automatically: **Research → Plan → Build → Verify** for every task, with depth proportional to the work. Ask for a concrete outcome and acceptance criteria; Codex researches local patterns first, plans before editing, implements complete changes, and runs the relevant checks.

- [Workflow and task briefs](docs/codex-workflow.md)
- [Design rules](docs/design.md) and [technical conventions](docs/technical.md)
- [Verification](docs/validation.md) and [execution-plan format](PLANS.md)
- [Status](docs/NEXT.md), [backlog](docs/BACKLOG.md), [vision](docs/vision.md), [decisions](docs/decisions/README.md), [owner hand checks](docs/manual-checks.md); [backend roadmap](docs/plans/backend-roadmap.md) (archive)
- [Research, benchmarks, and measurement protocol](docs/research.md)

Project skills in `.agents/skills/` cover new pages, session handoffs, screenshot recreation, site visual design, and brand assets. Codex loads the relevant skill when needed; there is no mandatory chain of researcher/reviewer agents. Existing website changes must be preserved.

To resume work after clearing context, run `/go` in the Claude Code planner session (in Codex: **follow `.claude/commands/go.md`**). Four sessions (planner, builder, scout, UI Builder; [team roles](.claude/rules/team-roles.md)) plan, build and review one task at a time under [the session workflow](.claude/rules/session-workflow.md), run the gates (`npm run gate -- verify build db`), rewrite `docs/NEXT.md`, and end with READY TO SHIP or NOT READY. Nothing is committed, pushed or deployed unless the owner asks at that moment.

The existing Playwright browser MCP server is configured in `.codex/config.toml`. Codex loads project configuration only for trusted projects. Restart the client if the server does not appear; first startup may require network access or browser setup. Model, reasoning effort, permissions, and credentials remain in personal settings. This migration does not change installed tools outside the repository.

Keep the Next.js-managed block in `AGENTS.md`: the installed framework uses it to direct agents to version-matched local documentation. Detailed rules live in linked documents so every task does not load the whole documentation collection.
