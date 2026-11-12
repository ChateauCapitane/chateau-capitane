# Architecture decision records

Write an ADR **before** code that changes architecture, the database schema, security, dependencies or build config. Research comes first; the ADR records the outcome. One file per decision: `NNNN-short-title.md`, numbered in order. Never edit an accepted ADR's decision; write a new one that supersedes it.

Older decisions made before this folder existed live in `docs/plans/` (for example [backend-provider-decision.md](../plans/backend-provider-decision.md)).

## Template

```markdown
# NNNN. Title

Date: YYYY-MM-DD · Status: proposed | accepted | superseded by NNNN

## Context
What forces the decision: the problem, the evidence, the constraints.

## Decision
What we will do, stated plainly.

## Consequences
What gets easier, what gets harder, what we give up, what must be watched.
```

## Index

- [0001. One-session workflow and `npm run verify` gate](0001-single-session-workflow-and-verify-gate.md)
- [0002. Upgrade Next.js to 16.4.6 for security advisories](0002-upgrade-next-16-4-6.md)
