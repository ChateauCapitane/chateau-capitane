---
description: Record an architecture decision
argument-hint: <the decision being made>
---

Write an ADR for: $ARGUMENTS

Check `docs/decisions/` for the highest existing number and use the next one.
Filename: `ADR-<nnnn>-<kebab-slug>.md`.

Follow the structure of the existing ADRs:

- **Status** — Accepted/Superseded, with the date.
- **Context** — the actual situation that forced a decision, including anything
  discovered by testing rather than assumed. If this supersedes an earlier
  decision, say which and why it turned out to be wrong.
- **Decision** — what we are doing, concretely enough to implement from.
- **Rationale** — why, including what the alternative genuinely wins at. An ADR
  that makes the rejected option sound stupid is not useful later.
- **Consequences** — what this costs, what it forecloses, what must not be
  changed without revisiting this, and what would trigger a revisit.

Keep it under a page. Write for someone six months from now who has forgotten
the discussion and is wondering whether they can just change it.

Do not commit.
