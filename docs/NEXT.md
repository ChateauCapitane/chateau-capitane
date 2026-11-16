# NEXT: read this first, then AGENTS.md

Rewrite, do not append. Under 40 lines; history is in git. No merge or push status here (AGENTS.md, Working with Anthony).
**Updated:** 2026-11-14. Branch `fix/gallery-menu` holds sharp gallery photos, a menu price check, the staff
guide and a UI audit, on top of the security audit on `main`. Four sessions (`.claude/rules/team-roles.md`);
use the names ListAgents shows. **Return gate: away** (`docs/manual-checks.md`).

## On this branch
- 11 sharp, text-free restaurant-posted Instagram photos (`docs/photo-sources.md`, rule by Anthony); 6 blurry ones
  deleted. Home signature dishes and the schema images use the sharp ones.
- The public gallery hides slots with no photo and empty groups ("The rooms" is hidden); the staff editor still
  shows empty slots. Gallery intro and signature intro reworded to match.
- `site.url` is `https://www.chateaudecapitaine.com` (the old domain did not resolve).
- Menu: all 174 prices match chateaudecapitaine.com; 4 owner questions in BACKLOG.
- `docs/staff-guide.md` (sign in, edit, publish; linked from README). `docs/ui-audit.md` + screenshots (report only).

## Next, in order
1. UI audit fixes in the BACKLOG order (H1 320px overflow and RU menu button first). Start with `/go`.
2. Owner: answer the 4 menu questions; supply real room and banquet photos.
3. SEC-09 privacy notice: owner or counsel, facts in `docs/privacy-notice-facts.md`. Blocks public launch.
4. B12 staging and release, blocked on the owner's accounts ([release checklist](release-checklist.md)).

## Workflow
- Gates: `npm run gate -- verify build db` (space-separated). UI: Playwright MCP at 375/768/1280, EN and `/ru`.
- Windows: `npm.cmd` / `npx.cmd` when PowerShell blocks the `.ps1` wrappers.
- The scout reads the shared working tree: an uncommitted change looks like existing code. Check with `git grep … HEAD`.
- Builder handoffs can claim an edit that did not apply (2026-11-14): grep for the call before accepting.

## Known, not fixed
- Every deferred item, risk and open decision is in `docs/BACKLOG.md`.
- Lint has 1 known warning (`src/app/apple-icon.tsx:16`); it does not fail the gate.
- Never exercised: real Supabase gateway/Auth, live Resend email and webhooks, Vercel cron, GitHub CI, served headers.
