# Privacy notice: facts for counsel (not a policy, not published)

Purpose: give the owner's lawyer the facts a privacy notice needs (CalOPPA, Cal. B&P 22575, likely applies; see
`docs/security-audit.md` §6). Facts come from the code at 2026-11-14. **[OWNER]** marks what only the owner knows.
Do not publish any text built from this until counsel approves it; then the page needs EN and RU (AGENTS.md).

| Topic | Fact | Source |
| --- | --- | --- |
| Who | Château Capitaine, Coney Island Avenue, Brooklyn NY; legal entity name **[OWNER]** | `src/lib/data/site.ts` |
| Collected from guests | Name, email, optional phone, optional event date and party size, message; only when they send the form | `contact-input.ts`, migration 202610090001 |
| Not collected | No guest accounts, payments, IP addresses (a keyed hash of the network is kept up to 10 minutes for spam limits), cookies set by our code on public pages | migrations 202610090004, 202611130001; `session.ts` (staff-only cookie, `/admin`) |
| Counts | Anonymous daily counts of Book now and Call taps, by language; no identifiers | ADR-0003 |
| Use | Answer the inquiry; staff email notification | `notification-worker.ts` |
| Shared with (service providers) | Vercel (hosting), Supabase (database), Resend (email delivery); all US regions planned | `docs/plans/backend-provider-decision.md` |
| Third parties on our pages | inKind script (public pages) and Google Maps embed (contact page) may collect data and set cookies under their own policies; not inventoried in a browser yet | `inkind-popup.tsx`, `map-embed.tsx` |
| OpenTable | Book now leaves the site; OpenTable's policy applies | `site.ts` |
| Retention | Resolved inquiries 24 months after resolution, then deleted; open inquiries kept until resolved; backups 7 days | `docs/backend-operations.md` |
| Do Not Track | Our code does nothing different for DNT; nothing of ours tracks across sites. inKind/Google behaviour unknown | code |
| Requests (access, deletion) | Staff can find an inquiry; deletion is by database operator today **[OWNER: who handles requests, contact address]** | — |
| Selling or sharing for ads | None by our code **[OWNER confirms inKind arrangement]** | — |
| Children | Not directed at children | — |
| Security | Summary only; do not overstate | `docs/security-audit.md` |
| Changes and effective date | **[COUNSEL]** | — |
