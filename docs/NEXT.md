# NEXT

Rewritten every session, never appended; 40 lines or fewer. Last rewrite: 2026-11-12.

## Branch

`claude/cloud-environment-setup-8bp1uq`. Cloud sessions use the `claude/*` branch the cloud service assigns (owner exception to `feat/fix/chore`).

## What the branch contains

- `ddc2f4b`: the throw-away test database allows 200 connections; `test:db` passes 21/21 on Linux.
- `8d431a2`: notes on the Next.js advisory and the cloud `test:db` steps (since carried into this file and BACKLOG).
- `6d31b0e`: the workflow setup (AGENTS.md, CLAUDE.md, this file, BACKLOG, vision, manual-checks, decisions/0001, `/go`, `.claude/rules/workflow.md`; `next.md`/`HANDOFF.md` are pointers).
- `99a39ec`: `next` + `eslint-config-next` pinned to 16.4.6 (ADR 0002), and `npm run verify`. Runtime `npm audit`: 0.
- Settings commit: Claude may push to `claude/*` branches only.

## Next, in order

1. Owner fixes the [GUESS] lines in [vision.md](vision.md); they drive the need test.
2. B12 staging and release: blocked on the owner's accounts and costs ([release checklist](release-checklist.md) section 1). B02c (real Supabase gateway) runs on the staging project.
3. Owner inputs from [manual-checks.md](manual-checks.md) (SEO facts, Russian review) as they arrive.

## Gotchas

- Gate: `npm run verify` (about 10s). Add `npm run build` for app, route or config changes, and `npm run test:db` for database changes.
- Cloud containers run as root: `su postgres -s /bin/bash -c "npm run test:db"`; `.local-db-tests/` must belong to `postgres` (the environment setup script does this).
- If a future Next advisory appears, the first agent-run `npm run build` fails on purpose; an immediate retry proceeds.
- Windows: `npm.cmd` / `npx.cmd`. Linux npm drops `"libc"` entries from the lockfile (BACKLOG).
- `.claude/settings.json` allows Claude to push only to `claude/*` (exact form `git push -u origin claude/...`); `main` and force pushes are denied. Auto mode blocks Claude from editing that file.
- The cloud stop hook asks for a push after every turn. Ignore it: no push unless the owner asks.
- Never exercised: real Supabase gateway/Auth, live Resend email and webhooks, Vercel cron, GitHub CI.
- Lint has 1 known warning (`src/app/apple-icon.tsx:16`, in BACKLOG); it does not fail the gate.
