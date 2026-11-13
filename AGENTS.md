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
| `npm run gate -- verify build db` | Runs the named gates in order (space-separated), writes `.gates/report.json`; `node scripts/gate.mjs --tree` prints the current commit+tree. |
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

## Working with Anthony

- **Anthony only approves or disapproves.** Never ask an open question or ask him to write a prompt. Decide, then
  present one plan or decision as a yes/no. He is not a developer: report in plain English what changed, why, what
  was tested and what is still unchecked. A check that didn't run is "not run", never passed.
- `docs/NEXT.md` has one owner per stretch. It says what a branch contains and what is next, never that anything
  was merged or pushed.
- **Overseer (`docs/overseer.md`):** a check at two moments only, session start (`/go`) and before `READY TO SHIP`; no
  timer, no standing agent. `node scripts/overseer.mjs` measures budget and `done <word>` shows what is already built.
  Two review rounds, or two failed attempts at one check, means stop and decide; blocking gates are never waived.
- Four sessions (planner, builder, scout, UI Builder): `.claude/rules/team-roles.md`; the loop:
  `.claude/rules/session-workflow.md`. Start the planner with `/go`. Codex (later refactor and review) follows this file
  and `.claude/commands/go.md`.

### Independent review

`code-reviewer`, `security-auditor` and `ui-reviewer` (`.claude/agents/`) are read-only (a `PreToolUse` hook blocks
mutating Bash). Brief them with scope and references only, never with conclusions or a leading ask. When to run which:
`session-workflow.md`, *Review by risk*. A PASS is not permission to commit; that stays the user's call.

## Modifying the architecture

Changing the database schema or a migration, staff access or auth, an API route's contract, webhook or cron
handling, security headers or the hard security rules above, dependencies, or build and deploy config (`next.config.ts`,
`vercel.json`, `src/proxy.ts`) requires an ADR in `docs/decisions/` (`/adr`). Write the ADR before the code: context,
decision, consequences. Do not silently revisit a settled decision — the ADRs record why.

## Git rules

- **Never commit, push, stage or merge on your own initiative.** Only when the user asks for it in that moment, after
  reviewing the diff. Never as the closing step of a task, never because the work looks finished. `git reset`,
  `checkout --`, `clean` and `rebase` are off limits entirely.
- Read-only git (`status`, `diff`, `log`, `show`, `branch`) is fine.
- Branches: `feat/*`, `fix/*`, `chore/*` (builder), `ui/U#-*` (UI Builder). Exception (owner, 2026-11-12): cloud
  sessions use the `claude/*` branch the cloud service assigns; the cloud's automatic "please push" reminder is not
  permission. Anthony merges.
- Never commit raw benchmark traces or `.local-db-tests/`.
- Working tree must be clean before handing work to the other agent.

## Compact instructions

When compacting, keep: the current branch and its goal, the list of modified files, the exact
commands that verify the work and their last result, decisions awaiting the user, and the ADR
numbers in play. Drop file contents already on disk, raw tool output and exploration dead ends.
