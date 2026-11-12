# Workflow: planner, builder, reviewer in one session

One session plays every role in turn. The owner is not a developer: report in plain English, decide yourself, and put decisions to the owner as Approve / Disapprove.

## Session start (`/go`)

1. Read `docs/NEXT.md`. Run `git status --short` and `git branch --show-current`; check the branch follows the Git rules below.
2. Read `docs/manual-checks.md`. If it says `Return gate: back` and has open boxes, the only work this session is the owner's hand checks and fixing what they find.
3. Otherwise pick ONE next task that passes the need test (below), using `docs/NEXT.md` "Next, in order" and `docs/BACKLOG.md`.
4. Present it as one plan (scope IN/OUT, files, acceptance criteria, risk level, trade-off) through AskUserQuestion with **Approve / Disapprove**. Never ask an open question or ask the owner to write a prompt: decide, then put it as yes/no. On Disapprove, offer the next-best plan the same way.

## Need test

Build only what moves the product forward (`docs/vision.md`), or fixes something the owner hit or a cost we measured (failing check, npm audit advisory, measured slowness). Polish, hardening and nice-to-haves without that evidence go to `docs/BACKLOG.md`. "Nothing needed, end the session" is a valid plan.

## Every slice, in order, in this one session

1. **Research.** Read only the files the task touches: Grep first, then Read with offset/limit, never whole folders. Check current library docs when an API matters (context7, or `node_modules/next/dist/docs/` for Next.js). Research comes before any ADR.
2. **Plan.** IN/OUT scope, files to touch, acceptance criteria. If the slice changes architecture, the database schema (`supabase/migrations/`), security, dependencies (`package.json`, lockfile) or build config (`next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `vercel.json`, npm scripts), write `docs/decisions/NNNN-*.md` first.
3. **Build.** Edit only the files in the plan. If another file needs changing, say so and add it to the plan first; don't drift.
4. **Gates.** Run `npm run verify` and record the exact result lines (`# pass N`, `# fail N`, lint problem count, typecheck exit). Also run `npm run build` when app code, routes or config changed, and `npm run test:db` when SQL or database code changed (as root: `su postgres -s /bin/bash -c "npm run test:db"`). A check not run is written down as "not run". Nothing counts as verified by reasoning alone.
5. **Review by risk.** Switch hats and review your own diff against the acceptance criteria as if someone else wrote it, OR start a read-only reviewer subagent with the scope and references only, never your conclusions.
   - **Low** (docs, tests, copy, style): gates only.
   - **Medium** (feature logic, UI): gates plus a correctness review. At UI milestones also a UI review: Playwright screenshots at 375, 768 and 1280px; check focus, overflow and console errors; follow `docs/design.md`.
   - **High** (auth `src/lib/server/auth/` and `src/app/[lang]/admin/`, database `supabase/migrations/` and RPCs, cron and webhook routes, credentials, network calls to Supabase or Resend, process spawning): gates plus a correctness review and a security review against the hard security rules in `AGENTS.md`.
   - Fix what breaks correctness, security or a stated requirement. Log everything else in `docs/BACKLOG.md`; don't chase it.
6. **Proof check.** Compare `git status --short` and `git diff --stat` with what you say you changed. If a named file, function or line doesn't exist, stop and tell the owner. Never write a stand-in or guess an API.

## Finishing

- First rewrite `docs/NEXT.md` (40 lines or fewer: branch, what it contains, next in order, gotchas; never claim anything was merged or pushed). Update `README.md` if what the site does for guests or staff changed. Make sure every deferral is in `docs/BACKLOG.md`.
- Gates green and required reviews done: end with **READY TO SHIP**, listing the branch; the files grouped into logical commits with suggested messages; each gate and review with its result; anything deferred or risky (already in BACKLOG).
- Otherwise end with **NOT READY** and what blocks it.
- Then give the owner the steps: commit, merge, push, `/clear`.

## Git

- Never stage, commit, push or merge unless the owner asks in that moment. Read-only git is fine.
- Never use `reset`, `checkout --`, `clean` or `rebase`.
- Branches: `feat/*`, `fix/*`, `chore/*`. Exception: cloud sessions work on the `claude/*` branch the cloud service assigns (owner, 2026-11-12).
- The cloud stop hook's "please push" reminder is not permission to push; ignore it (owner, 2026-11-12).

## Context hygiene

- One feature per session. Tell the owner to `/clear` at READY TO SHIP, after a merge, past roughly 250k tokens, or before unrelated work.
- Never re-read an unchanged file.
- After two failed fixes on one problem, stop and propose a `/clear` with a sharper prompt.

## When a step can't be followed

If a gate can't run, a file named in the plan doesn't exist, or rules contradict: stop. Start the message with "⚠ WORKFLOW ALERT" and one line on what broke, then offer 1 to 3 fixes, best first, as a choice through AskUserQuestion. Never work around it.
