# Anthony's problem and decision log

The problems Anthony found in Château Capitaine, his reasoning, and the fixes he chose. It exists so he can show his
own thinking (resume, interviews). The rules for each entry:
- **Found:** what Anthony noticed, in his words where possible.
- **His thinking:** what he concluded, asked for, chose or rejected. Only his own contribution goes here; what the
  agents proposed is marked as such.
- **Result:** what was built or decided, with the ADR or branch, and its status.

Newest first. Written by the planner at every READY TO SHIP and whenever Anthony gives a new report or decision.
Earlier history (B01-B12, SEO, Russian version) is in git (`git log -p -- next.md`) and was not backfilled.

## 2026-11-16: calls and OpenTable only
- **Found:** the site asked guests to fill in contact and banquet forms, which meant storing guest messages, an inbox
  for staff to watch, and inquiry emails to run.
- **His thinking:** guests should just call or book on OpenTable. He approved removing the forms, then approved the
  agents' plan (ADR, real-database migration, both reviews) as a yes/no.
- **Result (agents):** ADR-0006, branch `feat/calls-only`: forms, inbox, inquiry email and the inquiry tables
  removed; Call and Book now kept everywhere; security alert email kept. Gates green, code and security reviews PASS.
  Not committed yet.

## 2026-11-16: launch roadmap, owner answers, and calls only
- **Found:** he wanted one list of everything needed to launch, and a way to answer the open questions there so
  nothing gets lost between sessions.
- **His thinking:** he answered the menu, neighborhood, parking, subway, delivery, price-range and inKind questions
  himself, and decided the site drops its online inquiry forms: guests call or book on OpenTable. Agents draft the
  privacy notice and the owner approves it.
- **Result (agents):** a private launch roadmap page with saved answers (7 phases), the answers logged in BACKLOG,
  form removal queued as the next ADR. Nothing built yet.

## 2026-11-14: gallery, menu prices, staff guide and a UI audit
- **Found:** clicking through the local site, he saw the gallery looking empty and the photos blurry. He wanted the
  menu prices proven against the real ones, plain steps for staff to sign in and change photos and text, and a full
  UI audit to a brief he supplied.
- **His thinking:** "1080p" meant clear, not blurry. Photos had to be food and venue only, never flyers or images with
  text. He widened the sources beyond Instagram and dropped the 2026-only rule when 2026 held almost nothing but
  flyers. He signed in to Instagram himself so full-size files could be used.
- **Result (agents):** all 174 menu prices match the restaurant's own site (chateaudecapitaine.com); 4 owner
  questions logged. The site's address was wrong and is fixed. 11 sharp restaurant-posted photos replace the blurry
  ones, and empty slots are hidden from guests. `docs/staff-guide.md` and `docs/ui-audit.md` (no critical findings)
  written. Branch `fix/gallery-menu`. Not committed yet.

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
