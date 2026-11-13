# Session workflow

Cost is dominated by re-reading context (~76% of weighted cost, ~480k tokens a request, measured 2026-10-05). Keep
sessions short, clear at feature boundaries.

## Start
Read `docs/NEXT.md`, then `git status` and the branch, before touching anything.
If `docs/manual-checks.md` says `Return gate: back` with open boxes, the only work is Anthony's hand checks and fixing what they find.

## Need test: good enough beats perfect
Build only what moves the product forward (`docs/vision.md`) or fixes something Anthony hit or we measured. Polish,
hardening and review nits without that evidence go to BACKLOG, not into a slice. "Nothing needed" is a valid `/go`
answer. Review findings: fix what breaks correctness, security or a stated requirement; the rest is logged, not chased.

## Routing
- **T0** docs, NEXT, memory or an answer: planner, directly; never `src/`, `tests/`, `supabase/` or config.
- **T1** isolated change, known files: builder.
- **T2** repo uncertainty: scout, then builder.
- **T3** visual or UI-heavy: UI Builder; the local builder runs the gates.
- **T4** cross-cutting: scout, then the planner writes the ADR or brief, then the specialist.
- **T5** DB/migrations, staff auth, API routes, webhooks/cron, deps: builder, gates, `code-reviewer`, `security-auditor`.

## Review by risk
Reviewers start as soon as the code is final, in parallel with the builder's gates, not after them (2026-10-27).
A fix round reruns only the failed gate step or test; one full gate runs before `READY TO SHIP`.
- **low** (docs, tests, copy, style): gates only.
- **medium** (feature logic, UI): gates + `code-reviewer`; `ui-reviewer` at UI milestones.
- **high** (migrations/RLS, staff session/auth, API routes, webhooks, cron, secrets, deps): gates + `code-reviewer` +
  `security-auditor` (opus for major audits).
- Reviewers get scope and references only, never conclusions. They start from the acceptance criteria, `git diff` and
  `.gates/report.json`, and rerun a gate only when the report's commit+tree differ from `node scripts/gate.mjs --tree`
  or a finding needs a specific run. They report only gaps that affect correctness, a stated requirement or a
  documented rule. The implementation side decides what to act on; a PASS is not permission to commit.

## Handoff block
Every builder or scout report back is this block, one line per field: `task_id · agent · status (done|blocked|failed) ·
branch@commit · files_changed · verification (gate report summary) · risks · decisions · next_action`.

**Proof, not claims** (Fable 5.2 guidance, 2026-11-12: it states inferences as facts and, rarely, invents a stand-in for a
missing file). In every handoff:
- `verification` names each command run and its result line, or the gate report's commit+tree. Nothing is "verified"
  by reasoning; a check not run says `not run`.
- Anything believed but not shown by a run goes in `risks` as `unverified: …` (e.g. "look unchanged" without a visual run).
- A file, function or line the brief names that does not exist or does not match: stop and report it. Never write a
  stand-in, stub or guessed API to fill the gap.
- Scout findings follow the same rule: path:line from HEAD for every fact, `not found` rather than a guess.

**Planner check on every handoff, before reviewers or gates:** `git status --short` and `git diff --stat` against
`files_changed` (summaries can omit small changes), and `node scripts/gate.mjs --tree` against the report's commit+tree.
A file not in the report, or a stale report, is `NOT READY` until explained. Each `unverified:` item becomes a reviewer
question or a gate run, never a READY TO SHIP claim.

## Finishing a feature: always say so
When fully ready, end with `READY TO SHIP`: the branch; files grouped into logical commits with suggested messages;
gates passed (`npm run verify`, plus `npm run build` if app, routes or config changed, plus `npm run test:db` if database work, plus Playwright MCP screenshots at 375/768/1280 in EN and `/ru` if UI changed) and reviews run, with verdicts; anything not done,
deferred or risky. Only when verify is green and the required reviews ran; otherwise `NOT READY` and what blocks it.
Before it, rewrite `docs/NEXT.md` in the working tree, append the telemetry line and update `docs/anthony-log.md`
(Anthony's problems, his reasoning and the fix; his resume record, credit only what he did). When the feature
changes what the app does for the user, update `README.md` in the same slice (Anthony, 2026-11-12); fixes and
internals don't need it. If the one-line pitch changes, put the new GitHub description in the `READY TO SHIP` block
for Anthony to paste (Settings → General on the repo page; `gh` isn't installed). Then give Anthony the steps:
commit, merge, push, `/clear`. Never commit, merge or push unprompted (AGENTS.md, Git rules).

## Telemetry
At `READY TO SHIP` the planner appends one JSON line to `docs/telemetry.jsonl`: measured values only, unknown = null,
never a guess. Fields: `docs/telemetry.md`.

## NEXT.md follows every commit
When Anthony asks for a commit, update `docs/NEXT.md` first (branch, contents, next) and include it. Never write that
something was merged or pushed. Under 40 lines, no hashes. If it reads wrong afterwards, fix it in a new commit; never
amend. One owner per stretch (AGENTS.md, Working with Anthony).

## Backlog: nothing deferred gets lost
`docs/BACKLOG.md` is the single list of deferred work. Whatever a slice defers (ADR "not done", unfixed finding,
`ponytail:` shortcut, known risk) is added there in the same commit. A built item's line is deleted in the slice that
builds it; only Anthony moves an item to *Dropped*. NEXT.md never holds the only copy.

## Context hygiene, and workflow breaks
- Read big files with `offset`/`limit` or Grep first; never re-read an unchanged file. Batch independent calls; keep
  output small. Prefer Write for files over ~80 lines. Exploration goes to the scout, gate runs to the builder.
- After two failed corrections on one problem, stop and propose `/clear` with a sharper prompt. Suggest `/clear` (or
  `/compact` at a natural break) past ~250k tokens or on unrelated work.
- **If a workflow step can't be followed** (peer unreachable, message undelivered, gate or reviewer can't run, rules
  contradict, a role doing another's work): stop that step and never work around it. Start with `⚠ WORKFLOW ALERT` and
  one line on what broke and why; give 1 to 3 fixes, best first, each with the exact command, session and effect; put
  the choice to Anthony with `AskUserQuestion`, recommended first. If the fix changes the workflow, update this rule,
  `team-roles.md` or the memory.
