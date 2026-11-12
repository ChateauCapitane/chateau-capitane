---
description: Start a session - read status, check git and the return gate, propose ONE task for Approve/Disapprove
---

Run the session start from `.claude/rules/workflow.md`:

1. Read `docs/NEXT.md` and `docs/manual-checks.md`. Run `git status --short` and `git branch --show-current`.
2. If anything doesn't match the rules (wrong branch pattern, rules contradict, a gate can't run, NEXT.md names a file that doesn't exist), stop with "⚠ WORKFLOW ALERT" and offer 1 to 3 fixes, best first, through AskUserQuestion.
3. If manual-checks says `Return gate: back` with open boxes, the plan is: work through the owner's results and fix what they found.
4. Otherwise apply the need test (`docs/vision.md`) to "Next, in order" in `docs/NEXT.md` and to `docs/BACKLOG.md`, and pick ONE task. "Nothing needed, end the session" is allowed.
5. In two or three plain-English lines, report the branch, uncommitted files and the gate state.
6. Put the plan to the owner through AskUserQuestion with the options **Approve** and **Disapprove**. Give the task, why it passes the need test, IN/OUT scope, files, acceptance criteria, risk level (low/medium/high), whether an ADR is needed, and a one-line trade-off. No open questions.
7. On Approve, run the slice steps from the workflow. On Disapprove, offer the next-best plan the same way, or end the session.
