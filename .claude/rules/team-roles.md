# Team roles: four sessions

The model sets the role; `/pair planner` and `/pair builder` connect planner and builder. Find the others with
`ListAgents` and talk with `SendMessage`. `/pair`'s peer id may not be a `SendMessage` name; use the name from `ListAgents`.
Every report back goes by `SendMessage` to `Planner` (or the sender's `from`); plain text in your own session reaches nobody.

| Session | Model, effort | Does | Never |
|---|---|---|---|
| **planner** (local) | Opus 5.5, medium | Reads NEXT.md, ADRs; plans slices (IN/OUT, files, budget); briefs builders; reviews diffs; runs reviewers; says READY TO SHIP. Reads summaries and handoff blocks, never full logs. | Edits `src/`, `tests/`, config. |
| **builder** (local) | Sonnet 5.5, medium | All code edits outside the UI Builder's slice. Runs gates with `npm run gate -- <steps>` in its own session, once per change, and reports the handoff block. Reads only the files in the brief, plus what the LSP points to. | Changes scope without the planner; skips a gate. |
| **scout** (local) | Haiku 5.5, low | Maps the repo, greps, summarises docs, library docs (context7), versions. LSP (`workspaceSymbol`/`findReferences`) before Grep before Read. Short findings with paths and lines. | Edits files; design or security decisions. |
| **UI Builder** (local) | Fable 5.2, xhigh (set in its session with `/model fable`; Anthony, 2026-11-10) | Token-heavy UI work the planner hands it, on its `ui/U#-*` branch in this working tree; reports the handoff block by `SendMessage`. | Commits, pushes or merges; touches `src/lib/server`, `src/app/api`, `supabase/`, deps, or config (`next.config.ts`, `vercel.json`, `src/proxy.ts`); runs build or db gates (it runs `npm run verify` before its handoff). |
| reviewers | medium | `code-reviewer`, `security-auditor`, `ui-reviewer`: diff + criteria + gate report. | Edit anything. |

Effort is `high` only when the planner escalates and says why (not the UI Builder). The UI Builder runs Fable 5.2 (Anthony, 2026-11-10);
project `modelSettings` keeps claude-opus-5-5 at medium for the planner, and the UI Builder runs
`/effort xhigh` in its own session.

**Briefing a Fable 5.2 session** (Anthropic's Fable 5.2 guide, 2026-11-12): it follows briefs literally. Name the files
it may edit and say "report, don't fix" for anything outside them. Never tell it that it owns or maintains the codebase:
in Anthropic's tests that sentence brought unrequested changes, sometimes to existing behaviour, and summaries that leave
small changes out. Don't ask it to write out its reasoning (a safety classifier can refuse that).

## Delegation: the sessions, not subagents
- Lookups go to the scout, code to the builder or UI Builder; the planner spawns no `Explore`, `general-purpose` or other
  subagents for that, and gate runs are never a subagent. The only subagents are the three reviewers, and only the planner starts them (never the builder or UI Builder).
- The UI Builder shares this working tree with the builder: one of them edits at a time, the planner says who, unless
  the planner gives each a disjoint file list for the same slice (Anthony, 2026-10-31: use the UI Builder in parallel
  where it helps). Then neither touches the other's files, the UI Builder's `verify` failures in the builder's files are
  not its own, and the builder runs the gates once both report. The planner reads `git diff` before the gates.
- **Keep idle sessions busy** (Anthony, 2026-11-12): while one session works, give the idle ones work that fits their
  role from anywhere in BACKLOG or planned future phases (vision, roadmap), not only NEXT.md, when it runs in parallel without touching the busy session's files
  (scout lookups for coming slices; the builder or UI Builder on a disjoint file list). Parallel work on the same
  branch is kept as its own logical commit at `READY TO SHIP`.
- A session that is missing or unreachable is a `⚠ WORKFLOW ALERT` (`session-workflow.md`), never a subagent fallback.

## Token rules
- Nobody reads whole folders; ask the scout and read only the lines it points to. Briefs carry scope and references,
  not file contents. Opus thinks, Sonnet types, Haiku fetches.
- Do not switch a session's model mid-session (it rebuilds the prompt cache). Effort changes are fine.
- The builder opens the files it edits in VS Code (`code <path>`, or `/ide`) so Anthony can watch.
