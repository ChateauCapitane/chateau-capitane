# Overseer protocol

A slice-boundary check run by the planner, not an agent. It exists so no session over-works one feature, repeats finished
work, or picks the next slice without Anthony's yes/no. Researched basis (read these, do not trust the summary):
- Anthropic, [How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system):
  their research system used ~15x the tokens of one chat (their figure, not a Château measurement); multi-agent wins on
  parallel work, less on tightly coupled coding.
- Anthropic, [Building effective agents](https://www.anthropic.com/research/building-effective-agents): simplest pattern first,
  stop conditions, human checkpoints.
- Cemri et al., [Why Do Multi-Agent LLM Systems Fail?](https://arxiv.org/abs/2503.13657) (MAST): failures cluster in system
  design, inter-agent misalignment and verification/termination, mostly not in the model. Read the paper for the shares;
  they are not repeated here.
- Token cost per extra agent: [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams).
So: no loop, no timer, no polling. A script does the measuring; one cheap read does the judging.
The budget numbers in the script are SteamRoller's (advisory); recalibrate them here after about 10 merged slices with
`git log --first-parent --merges --shortstat`.

## When it runs (only these two moments)
1. Start of a session (`/go`): the context is fresh and small, which is the cheapest moment.
2. Before writing `READY TO SHIP` or `NOT READY`.

## Steps
1. `node scripts/overseer.mjs` (budget per worktree: changed lines).
2. `node scripts/overseer.mjs done <keywords of the proposed next slice>`: commits, ADRs, NEXT.md lines.
   If it was already built, say so and pick the next unbuilt item in `docs/vision.md` / NEXT.md / BACKLOG instead.
3. Read `docs/NEXT.md`. Nothing else; no source files.
4. Write the report in the proposal. Compare NEXT.md with `git log`; if NEXT.md is stale, say so (a stale NEXT.md is how work
   gets repeated).

## Stop rules (these are the "not forever" guard)
- A slice is done when `npm run verify` is green, the build, db and browser checks its brief names have passed, and each
  review AGENTS.md requires has passed or its findings are explicitly resolved or deferred. Completion evidence is the
  revision plus the acceptance and review results; a source commit and a "built" line alone are not enough.
- After **2 review rounds** on a slice: stop and decide. Unresolved correctness, security or required-gate findings
  are never waived (they block READY TO SHIP); findings below medium go to `docs/BACKLOG.md` and are not fixed.
- **Checkpoint without a timer:** after two failed attempts at the same check with no new hypothesis, or when the scope
  grows past the brief, the working session stops, runs the script and reports. Start/end-only checks cannot catch a
  feature that never reaches its end; this can.
- Budget flags (`OVER BUDGET`) mean: propose ship-or-split as the yes/no. Never "keep going".
- Exit code 3 from the script means a measurement was unavailable (a sandbox may not let node spawn git): the
  caller runs the git commands directly and does not read it as "within budget".
- A hit from `done` proves a topic was discussed or changed; `[src]` marks commits that touched `src/`. Only `[src]`
  hits plus a NEXT.md "built" line count as evidence that something was implemented.

## Report (at most 15 lines, plain text)
`Did` (branch, commit or merge hash, gate result, review round; any piece with no
cited evidence is `UNKNOWN`, never assumed) · `Budget` (script verdict; exit 3 or a failed query is `UNKNOWN`, never PASS or 0) ·
`Already built?` (quote the `done` lines verbatim; "built" only with a `[src]` hit or a NEXT.md "built" line) ·
`NEXT.md stale?` · `Proposed next slice` (one, with its ADR/security need and whether its dependencies are built) · `Yes / No`.
This per-task line is the ledger; NEXT.md stays the only status file. A finished task reopens only for a concrete new
regression, a required-gate gap, or Anthony's explicit request. Budget limits are advisory stop-and-decide thresholds,
never an exemption from a blocking gate.

## Decisions
The planner asks Anthony once, as a yes/no (AskUserQuestion). It approves nothing. Commits, merges, pushes, a new
dependency, a schema/auth/security change (ADR first), anything paid or live, and the next slice all wait for Anthony.

## Safety
Read-only: git queries and file reads only. No git writes, no network, no installs, no edits. Reports never quote
file contents at length. The script spawns `git` with an argv array (no shell).

## Who runs it
The planner, in its own session, at the two moments above. There is no overseer agent: in SteamRoller a Haiku one
reported a slice as merged that had no commits. Check any "built" claim against the quoted `done` lines.
