# Telemetry (docs/telemetry.jsonl)

At `READY TO SHIP` the planner appends one JSON line to `docs/telemetry.jsonl` (`.claude/rules/session-workflow.md`,
*Telemetry*), measured values only:

`{ slice, date, tier, risk, models (role:model/effort), files_changed (git diff --stat count), gate_ms (from the gate
report), first_pass (gates green on the first run), review_findings {high,medium,low}, rework_rounds, tokens }`

`tokens` is null unless taken from `/session-report`. Unknown = null, never a guess.
