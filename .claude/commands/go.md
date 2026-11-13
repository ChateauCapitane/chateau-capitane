---
description: Start a session from docs/NEXT.md and propose the next step for a yes/no
---

Read `docs/NEXT.md`, then run `git status`, check the branch, and run `node scripts/overseer.mjs`. If a
budget flag is raised, or NEXT.md disagrees with `git log`, state the mismatch in the proposal (`docs/overseer.md`);
no agent does this check. Decide the next task yourself, but only one that passes the **need test**: it moves the
product forward (`docs/vision.md`), or fixes something Anthony has hit or a cost that was measured. A
polish, hardening or "could be better" item with no such evidence is skipped, not built. If nothing on NEXT.md or
BACKLOG passes, the plan is "nothing needed, end the session"; that is a valid result. Name the evidence in the plan
and put it to the user as one plan with Approve / Disapprove (AskUserQuestion or ExitPlanMode).
Do not ask open questions and do not ask the user to type anything. Never commit, merge or push unprompted.
