<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Château Capitaine — project instructions

Loaded every turn by Claude Code (through `CLAUDE.md`) and Codex. Keep this file under 150 lines; detail lives in linked docs.

## Purpose

The website of Château Capitaine, a Russian bar, grill and banquet hall on Coney Island Avenue, Brooklyn. It turns online visitors into guests (OpenTable bookings, calls, inquiries, banquet requests) in English and Russian. It also gives staff a private inbox and lets them publish the menu, hours and photos without a developer. What counts as progress: [docs/vision.md](docs/vision.md).

## Stack

Next.js 16 App Router, React 19, TypeScript (strict), Tailwind CSS v4, npm, Node 22. Backend: Supabase PostgreSQL and Auth over REST `fetch` (no SDK), Resend email over `fetch`, Vercel hosting and cron. `sharp` processes photos. Dev only: `embedded-postgres` + `pg` for real-database tests, `svix` to cross-check webhook signatures. Check `package.json` before adding anything.

## Commands

| Command | Use |
| --- | --- |
| `npm run verify` | **The gate:** route types, typecheck, lint, unit tests. Must pass on every slice. |
| `npm run build` | Also required when a slice touches app code, routes or config. The first agent-run build fails on purpose while Next has a known security advisory; an immediate retry proceeds. |
| `npm run test:db` | Real throw-away PostgreSQL with every migration. Required for database work. As root (cloud containers): `su postgres -s /bin/bash -c "npm run test:db"`. |
| `npm run dev` | Local site at http://localhost:3000. |
| `npm ci` | Install from the lockfile. |

Windows PowerShell: use `npm.cmd` / `npx.cmd` if the `.ps1` wrappers are blocked. UI checks use the Playwright MCP (`.mcp.json`) at 375, 768 and 1280px.

## Layout

| Path | What |
| --- | --- |
| `src/app/[lang]/` | Public pages, English at `/` and Russian at `/ru` (`src/proxy.ts` rewrites) |
| `src/app/[lang]/admin/` | Staff pages at `/admin` (English only; `/ru/admin` is a 404; noindex, cookie session) |
| `src/app/api/` | Contact intake, cron workers, health, Resend webhook |
| `src/lib/data/` | Built-in business facts (`site.ts` is the single source), menu, events, gallery |
| `src/lib/i18n/` | `en.ts`, `ru.ts` (same keys), `content-ru.ts` (menu/banquet translations) |
| `src/lib/server/` | Server-only: inquiries, auth, content publishing, media, ops |
| `src/components/` | Shared UI (`ui/styles.ts` holds shared class strings) |
| `supabase/migrations/` | SQL migrations, applied in name order; [supabase/README.md](supabase/README.md) |
| `tests/`, `tests/db/` | Node test runner: mocked unit tests, real-database tests |
| `docs/` | NEXT, BACKLOG, vision, decisions, manual checks, design, technical |

## Hard security rules

- Secrets stay server-side. Never use the `NEXT_PUBLIC_` prefix for a key, never read `.env` / `.env.local`, never print or commit a credential.
- Every staff database function re-checks `staff_members` membership. User metadata never grants access. RLS stays on, and the private schema stays unexposed.
- Never log guest names, emails, phones or messages. Logs carry codes, IDs and counts only.
- Validate all input on the server. Keep request size limits, the honeypot, rate limits (fail closed) and provider timeouts.
- Webhooks must pass signature verification (5-minute window) before being parsed. Cron routes require the `CRON_SECRET` bearer token.
- Never send real email, provision paid services, run live migrations, reset a remote database or deploy without the owner asking in that moment.
- Synthetic test data only: names like "Test Guest", emails ending `.invalid`.

## Conventions

- Server Components by default; add `"use client"` only for state, effects, events or browser APIs.
- Business facts come from `site.ts` / published content. Never invent prices, hours, reviews, ratings or contact details.
- Keep the OpenTable "Book now" link and every Call button. An inquiry never confirms a booking. Lunch is three courses, beverages excluded.
- Black-and-gold identity, Bodoni Moda + Albert Sans, square corners, no em dashes in site copy: [docs/design.md](docs/design.md). Technical conventions: [docs/technical.md](docs/technical.md).
- English and Russian stay in step: a new UI string needs both `en.ts` and `ru.ts`.
- Photos: real restaurant photos with provenance only, never generated scenes presented as real.
- Read the version-matched Next.js guide in `node_modules/next/dist/docs/` before writing Next.js code.

## Git rules

- Never stage, commit, push or merge unless the owner asks in that moment. Read-only git (`status`, `diff`, `log`, `show`) is always fine.
- Never use `git reset`, `git checkout --`, `git clean` or `git rebase`.
- Branches: `feat/*`, `fix/*`, `chore/*`. Exception (owner, 2026-11-12): cloud sessions use the `claude/*` branch the cloud service assigns.
- The cloud's automatic "please push" reminder is not permission; the rule above wins (owner, 2026-11-12).
- Never commit raw benchmark traces or `.local-db-tests/`.
- `docs/NEXT.md` never claims that anything was merged or pushed.

## Roles (one session plays all of them)

Full rules: [.claude/rules/workflow.md](.claude/rules/workflow.md). Start every session with `/go` (Codex: follow `.claude/commands/go.md`).

- **Planner:** reads `docs/NEXT.md`, applies the need test from `docs/vision.md`, picks ONE task, and asks the owner Approve / Disapprove. Never asks the owner an open question or to write a prompt.
- **Builder:** researches only the touched files, writes an ADR in `docs/decisions/` before any change to architecture, the schema, security, dependencies or build config, then edits only the planned files.
- **Reviewer:** runs the gates and records exact result lines, reviews the diff by risk (low: gates; medium: + correctness; high: + security) as if someone else wrote it, fixes only correctness, security or requirement breaks, and logs the rest in `docs/BACKLOG.md`.
- **Finisher:** proof-checks `git status --short` / `git diff --stat` against the claims, rewrites `docs/NEXT.md`, then ends with READY TO SHIP or NOT READY.
- Deferred work, unfixed findings, shortcuts and risks go in `docs/BACKLOG.md` in the same change. Only the owner moves an item to "Dropped".
- If a step can't be followed, stop with "⚠ WORKFLOW ALERT" and offer fixes. Never work around it.

## Talking to the owner

The owner is not a developer. Report in plain English: what changed, why, what was tested, what is still unchecked. A check that didn't run is written as "not run", never as passed.
