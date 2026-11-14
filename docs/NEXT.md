# NEXT: read this first, then AGENTS.md

Rewrite, do not append. Under 40 lines; history is in git. No merge or push status here (AGENTS.md, Working with Anthony).
**Updated:** 2026-11-13. Branch `main` holds the four-session workflow setup (ADR-0001) on top of
the cloud bundle (Next.js 16.4.6, ADR-0002; `test:db` connection fix; `npm run verify`).
Four sessions (`.claude/rules/team-roles.md`), named `planner Chateau`, `builder Chateau`, `scout Chateua`,
`ui builder Chateau`. Use the name ListAgents shows; SteamRoller's sessions are listed too. Sessions, never subagents.
**Return gate: away** (`docs/manual-checks.md`).

## On this branch
- Workflow: `AGENTS.md` (Working with Anthony, review, architecture, git, compact), `CLAUDE.md`,
  `.claude/rules/session-workflow.md` + `team-roles.md`, `/go`, `/scout`, `/adr`, three read-only reviewers,
  `readonly-guard.mjs` + `format-file.mjs` (eslint --fix per file), `.claude/settings.json`.
- Scripts: `scripts/gate.mjs` (`npm run gate -- verify build db`), `scripts/overseer.mjs`.
- Docs: this file, BACKLOG, vision (approved, [GUESS] lines open), ADR-0001/0002, manual checks, overseer,
  telemetry, anthony-log. `.claude/rules/workflow.md` (one-session) removed.

## Next, in order
1. **Next session: review and audit of the whole app.** Anthony pastes the prompt after `/clear`; wait for it.
2. Click counts (ADR-0003, on `main`): Book now / Call tap counts in Supabase plus a 6-month admin table. Gates green,
   both reviews PASS. Still to do: the admin table check and a real count on staging (manual-checks).
3. B12 staging and release: blocked on the owner's accounts and costs ([release checklist](release-checklist.md)
   section 1). B02c (real Supabase gateway) runs on the staging project.
4. Owner inputs from `docs/manual-checks.md` (Russian read-through, SEO facts) as they arrive.

## Workflow
- Gates: `npm run gate -- verify build db` (space-separated). `verify` ~15s; `build` for app/route/config changes;
  `db` for database work. UI: Playwright MCP screenshots at 375/768/1280, English and `/ru`.
- Windows: `npm.cmd` / `npx.cmd` when PowerShell blocks the `.ps1` wrappers.
- The scout reads the shared working tree: an uncommitted change looks like existing code. Check with `git grep … HEAD`.
- `/pair`'s peer id may not be reachable; message the ListAgents name.

## Known, not fixed
- Every deferred item, risk and open decision is in `docs/BACKLOG.md`.
- Lint has 1 known warning (`src/app/apple-icon.tsx:16`); it does not fail the gate.
- Never exercised: real Supabase gateway/Auth, live Resend email and webhooks, Vercel cron, GitHub CI.
