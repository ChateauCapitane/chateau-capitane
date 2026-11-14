# NEXT: read this first, then AGENTS.md

Rewrite, do not append. Under 40 lines; history is in git. No merge or push status here (AGENTS.md, Working with Anthony).
**Updated:** 2026-11-14. Branch `fix/security-audit` holds the predeployment security audit and its fixes on top of
`main` (click counts, ADR-0003). Four sessions (`.claude/rules/team-roles.md`); this stretch ran with
`herdr chateau builder`. Use the name ListAgents shows; `/pair`'s peer id may not be reachable.
**Return gate: away** (`docs/manual-checks.md`).

## On this branch
- Audit: `docs/security-audit.md` (scope, threat model, SEC-01 to SEC-10, legal matrix, section 8 status and decision).
- ADR-0004 security monitoring and response (events, detection cron, owner page `/admin/security`, incident API),
  ADR-0005 security headers and staff isolation (separate `(site)` / `(staff)` root layouts, `ADMIN_HOST`).
- Migration `202611140001_security_monitoring.sql`; new routes `/api/cron/security`, `/api/security/*`.
- Docs: `docs/incident-response.md`, `docs/privacy-notice-facts.md`, release checklist and backend operations updated.
- Reviews: code review, security audit (opus) and re-audit (opus) all PASS WITH CONCERNS; their fixes are in.

## Next, in order
1. Nothing in code is pending for this audit. Start the next stretch with `/go`.
2. SEC-09 privacy notice: owner or counsel, facts in `docs/privacy-notice-facts.md`. Blocks public launch.
3. B12 staging and release, blocked on the owner's accounts ([release checklist](release-checklist.md)). Staging
   runs the Security row (headers, staff host, SHAs), SEC-10, B02c and the incident checks.
4. Owner inputs from `docs/manual-checks.md` as they arrive.

## Workflow
- Gates: `npm run gate -- verify build db` (space-separated). UI: Playwright MCP at 375/768/1280, EN and `/ru`.
- Windows: `npm.cmd` / `npx.cmd` when PowerShell blocks the `.ps1` wrappers.
- The scout reads the shared working tree: an uncommitted change looks like existing code. Check with `git grep … HEAD`.
- Builder handoffs can claim an edit that did not apply (2026-11-14): grep for the call before accepting.

## Known, not fixed
- Every deferred item, risk and open decision is in `docs/BACKLOG.md`.
- Lint has 1 known warning (`src/app/apple-icon.tsx:16`); it does not fail the gate.
- Never exercised: real Supabase gateway/Auth, live Resend email and webhooks, Vercel cron, GitHub CI, served headers.
