# Anthony's problem and decision log

The problems Anthony found in Château Capitaine, his reasoning, and the fixes he chose. It exists so he can show his
own thinking (resume, interviews). The rules for each entry:
- **Found:** what Anthony noticed, in his words where possible.
- **His thinking:** what he concluded, asked for, chose or rejected. Only his own contribution goes here; what the
  agents proposed is marked as such.
- **Result:** what was built or decided, with the ADR or branch, and its status.

Newest first. Written by the planner at every READY TO SHIP and whenever Anthony gives a new report or decision.
Earlier history (B01-B12, SEO, Russian version) is in git (`git log -p -- next.md`) and was not backfilled.

## 2026-11-14: predeployment security audit and its fixes
- **Found:** before any deployment he wanted the whole app reviewed and audited for security. Midway, one Claude
  account hit its rate limit; he resumed on another account and asked how to continue exactly where it stopped.
- **His thinking:** he approved the plan of independent code and security reviews, then fixing only what breaks
  correctness or security. When the paired builder was unreachable he named which builder session to use. At the
  two-review-round stop he chose to fix the last finding and finish without a third round, with the live-server
  checks moved to staging.
- **Result (agents):** `docs/security-audit.md` (SEC-01 to SEC-10), ADR-0004 (monitoring and response), ADR-0005
  (headers, staff pages kept away from inKind, `ADMIN_HOST`), branch `fix/security-audit`. Reviews PASS WITH CONCERNS,
  fixes in, gates green. Privacy notice (SEC-09) and staging checks still open. Not committed yet.

## 2026-11-13: the vision's open questions answered
- **Found:** the vision draft had 4 guesses that decide what gets built next.
- **His thinking:** about 90% of guests prefer Russian; banquets are the biggest revenue line; analytics is fine if free.
- **Result (agents):** `docs/vision.md` updated: banquets rank first, Russian is treated as the main site, analytics
  added to BACKLOG with research and an ADR first. He then approved counting taps ourselves (free, no cookies):
  ADR-0003, branch `feat/click-counts`. Gates green, code and security reviews PASS. Not committed yet.

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
