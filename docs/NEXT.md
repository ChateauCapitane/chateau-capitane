# NEXT: read this first, then AGENTS.md

Rewrite, do not append. Under 40 lines; history is in git. No merge or push status here (AGENTS.md, Working with Anthony).
**Updated:** 2026-11-16. Branch `feat/calls-only` removes the guest inquiry system (ADR-0006): guests only call or
book on OpenTable. Four sessions (`.claude/rules/team-roles.md`); this stretch used `herdr chateau scout` and
`herdr chateau builder` (names from ListAgents). **Return gate: away** (`docs/manual-checks.md`).

## On this branch
- Gone: the contact form, `/api/contact`, the staff inbox, the inquiry email cron and worker, the Resend webhook,
  dev dependency `svix`. Private Events package buttons are now Call buttons; contact copy says book or call (EN+RU).
- Migration `202611160001_remove_inquiries.sql` drops the inquiry tables and functions and redefines `ops_snapshot`,
  `run_retention` and `staff_click_summary`. Staff access, content, click counts and security stay.
- Resend stays only for security alert emails (`CONTACT_FROM_EMAIL` keeps its name).
- Contact page: the Visit panel is full width, info left and map right from 768px.
- Docs: README, AGENTS.md, technical, vision, privacy notice facts, release checklist, operations, incident
  response, staff guide, supabase/README; `docs/backend.md` marked superseded.

## Next, in order
1. Apply the owner answers in BACKLOG, then the UI audit fixes (H1 320px overflow and RU menu button first).
   Anthony's answers live in the [launch roadmap](https://claude.ai/artifact/2knxWr3TM1zwZEfhbmiHiJ); read it with
   ArtifactData (`answers`, `progress/ticks`).
2. SEC-09 privacy notice: agents draft from `docs/privacy-notice-facts.md` (now no forms), owner approves.
3. B12 staging and release ([release checklist](release-checklist.md)). Anthony has Supabase, Vercel and GitHub
   open in Claude in Chrome. The new domain `chateaucapitaine.com` is still to be bought (BACKLOG, Domain); its
   domain host is needed before launch, not before staging.

## Workflow
- Gates: `npm run gate -- verify build db` (space-separated). UI: Playwright MCP at 375/768/1280, EN and `/ru`.
- Windows: `npm.cmd` / `npx.cmd` when PowerShell blocks the `.ps1` wrappers. No `python` on this machine.
- The scout reads the shared working tree: an uncommitted change looks like existing code. Check with `git grep … HEAD`.
- Builder handoffs can claim an edit that did not apply (2026-11-14): grep for the call before accepting.
- The builder's session cannot read `.env*` files (correct); env-example edits go to Anthony.

## Known, not fixed
- Every deferred item, risk and open decision is in `docs/BACKLOG.md` (calls-only leftovers listed there).
- Lint has 1 known warning (`src/app/apple-icon.tsx:16`); it does not fail the gate.
- Never exercised: real Supabase gateway/Auth, live Resend alert email, Vercel cron, GitHub CI, served headers.
