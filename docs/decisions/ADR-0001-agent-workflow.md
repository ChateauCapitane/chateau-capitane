# ADR-0001. Four-session agent workflow and the `npm run verify` gate

**Status:** Accepted, 2026-11-12 (Anthony approved the setup plan). Supersedes the same-day one-session version
(`0001-single-session-workflow-and-verify-gate.md`, commit `6d31b0e`; still in git history).

## Context
- The Codex-to-Claude handover left conflicting rules (`AGENTS.md`: commit only when asked; `CLAUDE.md`: commit
  automatically, owner approval of 2026-10-09). The rolling `next.md` grew past 90 lines of history, and deferred items
  were scattered across it, the roadmap and `supabase/README.md`.
- A cloud session (2026-11-12) consolidated that into a one-session workflow: `AGENTS.md` as the one instruction file,
  `docs/NEXT.md`, `docs/BACKLOG.md`, `docs/vision.md`, `docs/manual-checks.md`, and `npm run verify`.
- Anthony runs a tested four-session workflow in his SteamRoller project (planner, builder, scout, UI Builder, three
  read-only reviewers, a gate runner and an overseer) and asked for the same process here, copied from its live files
  and adapted, not reinvented.

## Decision
- Copy SteamRoller's workflow: `.claude/rules/session-workflow.md` (routing tiers T0-T5, review by risk, handoff block
  with "proof, not claims", READY TO SHIP, telemetry, backlog, workflow alerts) and `.claude/rules/team-roles.md` (the
  four sessions, their models, briefing Fable, keeping idle sessions busy); `/go`, `/scout`, `/adr`; the
  `code-reviewer`, `security-auditor` and `ui-reviewer` agents behind `.claude/hooks/readonly-guard.mjs`;
  `scripts/gate.mjs` and `scripts/overseer.mjs`.
- Adapt to this project: gates are `verify` (`next typegen && tsc --noEmit && npm run lint && npm test`), `build` and
  `db` (`npm run test:db`); UI checks are Playwright MCP screenshots at 375/768/1280px instead of e2e/visual suites. The
  format-on-write hook runs `eslint --fix` on the written file (ESLint is already installed; no Biome or Prettier added).
- Keep from the one-session version: `AGENTS.md` as the single instruction file (`CLAUDE.md` imports it, so Codex reads
  the same rules), `docs/NEXT.md` as the only status file (root `next.md` and `HANDOFF.md` are pointers), BACKLOG,
  vision and manual checks.
- Claude never stages, commits, pushes or merges unless Anthony asks in that moment. The 2026-10-09 auto-commit approval
  is withdrawn. Pushing is an "ask" permission, not an allow.

## Rationale
The one-session loop wins on token cost: one context instead of four, no message passing. The four-session split wins
on review independence, cheaper models for lookups and typing, and parallel work, and it is the process Anthony already
knows and supervises in SteamRoller, so one set of habits covers both projects.

## Consequences
- More sessions to start and keep busy; a missing or unreachable session is a `⚠ WORKFLOW ALERT`, never a subagent
  fallback.
- Build-only failures (static generation, Next config) surface only when `build` runs, so the rules require it for app,
  route or config changes; `db` is required for database work.
- `scripts/overseer.mjs` budgets are SteamRoller's numbers until this repo has about 10 merged slices to recalibrate from.
- Revisit if the four-session overhead outweighs its benefit on this smaller codebase (telemetry in
  `docs/telemetry.jsonl` will show it).
