# Anthony's problem and decision log

The problems Anthony found in Château Capitaine, his reasoning, and the fixes he chose. It exists so he can show his
own thinking (resume, interviews). The rules for each entry:
- **Found:** what Anthony noticed, in his words where possible.
- **His thinking:** what he concluded, asked for, chose or rejected. Only his own contribution goes here; what the
  agents proposed is marked as such.
- **Result:** what was built or decided, with the ADR or branch, and its status.

Newest first. Written by the planner at every READY TO SHIP and whenever Anthony gives a new report or decision.
Earlier history (B01-B12, SEO, Russian version) is in git (`git log -p -- next.md`) and was not backfilled.

## 2026-11-12: the SteamRoller four-session workflow, and the Next.js security bundle
- **Found:** this project ran a one-session workflow, set up by a cloud session earlier the same day, while his
  SteamRoller project runs a tested four-session team.
- **His thinking:** he asked for the same process here, copied from SteamRoller's live files and adapted rather than
  invented, with SteamRoller-only parts left out. He listed which memories carry over. He approved the setup plan,
  including fast-forwarding main onto the cloud session's 5-commit bundle (the agents proposed doing that first so the
  critical Next.js fix came along), and approved the vision draft with its [GUESS] lines still open.
- **Result (agents):** ADR-0001 (four-session workflow, supersedes the one-session version), ADR-0002 (Next.js 16.4.6
  closes two critical and one high advisory). Rules, commands, reviewers, hooks, `scripts/gate.mjs` and
  `scripts/overseer.mjs` ported from SteamRoller; 12 memories adapted. Not committed yet.
