# 0001. One-session workflow and `npm run verify` gate

Date: 2026-11-12 · Status: accepted

## Context
- The Codex-to-Claude handover left two conflicting rule sets: `AGENTS.md` said "commit only when asked", while `CLAUDE.md` said "commit automatically after each verified slice" (owner approval of 2026-10-09).
- The rolling handoff `next.md` grew to 90+ lines of history, and deferred items were scattered across it, the roadmap and `supabase/README.md`.
- There was no single check command. Typechecking only happened inside `npm run build`, which is slow, and Next.js deliberately fails the first agent-run build while the installed version has a known advisory.
- The owner wants one session to act as planner, builder and reviewer in turn, and asked for no new dependencies without approval.

## Decision
- `AGENTS.md` is the one instruction file (Codex reads it directly; `CLAUDE.md` only imports it). The detailed loop lives in `.claude/rules/workflow.md`, and `/go` (`.claude/commands/go.md`) starts each session.
- `docs/NEXT.md` (40 lines or fewer, rewritten every time) is the only status file. Root `next.md` and `HANDOFF.md` become pointers to it.
- `docs/BACKLOG.md` is the only deferred-work list. `docs/manual-checks.md` holds the owner's hand checks plus a return gate. `docs/vision.md` defines the need test.
- `npm run verify` = `next typegen && tsc --noEmit && npm run lint && npm test`. It uses only installed tools. `next typegen` creates the route types `tsc` needs without a full build.
- `npm run build` stays outside the gate and runs for slices that touch app code, routes or config. `npm run test:db` stays outside it too and runs for database slices, because it starts a real PostgreSQL and needs a non-root user.

## Consequences
- The owner's 2026-10-09 auto-commit approval is withdrawn: Claude never stages, commits, pushes or merges unless asked in that moment.
- The gate takes about 15 seconds instead of a minute or more for a build. The trade-off: build-only failures (static generation, the Next.js config) surface only when the build is run, so the workflow requires it for app changes.
- `docs/plans/backend-roadmap.md` and the old `next.md` content (still in Git history) become archive and reference, not status.
- The branch rule (`feat/*`, `fix/*`, `chore/*`) conflicts with cloud sessions, where the harness assigns a `claude/*` branch. That conflict is raised to the owner, not settled here.
