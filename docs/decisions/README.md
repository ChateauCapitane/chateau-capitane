# Architecture decision records

Write an ADR **before** code that changes architecture, the database schema, security, dependencies or build config
(AGENTS.md, *Modifying the architecture*). Research comes first; the ADR records the outcome. Use `/adr <decision>`:
one file per decision, `ADR-<nnnn>-<kebab-slug>.md`, numbered in order, structured Status · Context · Decision ·
Rationale · Consequences. Never edit an accepted ADR's decision; write a new one that supersedes it.

Older decisions made before this folder existed live in `docs/plans/` (for example
[backend-provider-decision.md](../plans/backend-provider-decision.md)).

## Index

- [ADR-0001. Four-session agent workflow and the `npm run verify` gate](ADR-0001-agent-workflow.md)
- [ADR-0002. Upgrade Next.js to 16.4.6 for security advisories](ADR-0002-upgrade-next-16-4-6.md)
- [ADR-0003. Count Book now and Call taps ourselves, in Supabase](ADR-0003-first-party-click-counts.md)
- [ADR-0004. Security monitoring, incident records and owner-approved response](ADR-0004-security-monitoring-and-response.md)
- [ADR-0005. Security headers, staff-area isolation and a separate monitoring token](ADR-0005-security-headers-and-admin-isolation.md)
