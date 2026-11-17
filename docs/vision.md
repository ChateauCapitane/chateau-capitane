# Vision: what moves the product forward

Drafted 2026-11-12 from the repository; owner answers added 2026-11-13 (Anthony).

## Who it serves

- **Guests:** people in south Brooklyn looking for dinner, a celebration or a banquet hall. About 90% prefer Russian (Anthony, 2026-11-13), so `/ru` is the main site in practice: a Russian gap or mistake counts as much as a broken English page.
- **Staff and owner:** keep the menu, hours and photos current without a developer.

## The product moves forward when

1. **Banquet and private-event calls grow.** Banquets are the biggest revenue line (Anthony, 2026-11-13), so they rank above table bookings.
2. **More visitors take an action:** tap Book now (OpenTable) or Call, including from a banquet package (no guest forms since ADR-0006).
3. **More people find the site:** local search, the Google Business Profile and maps listings, and Russian-language search.
4. **Staff need the developer less:** they handle the menu, hours and photos themselves.
5. **The site goes live safely.** Everything built so far earns nothing until the release (B12). Once the owner's accounts exist, this outranks new features.
6. **Guests can trust what they see:** real facts, real photos, correct hours and prices.

## Does not move it forward (goes to BACKLOG unless there's evidence)

- Visual polish, refactors and extra hardening with no measured problem behind them.
- Out of scope unless the owner asks separately: payments, online ordering, a custom booking engine (OpenTable stays), customer accounts, marketing campaigns, POS or inventory.

## Evidence that counts

- Something the owner, staff or a guest actually hit.
- A measured cost or risk, for example an npm audit advisory, a failing check, or a slow page with numbers.
- Once live: booking-link clicks and calls per month, split by English and Russian. Analytics is approved if it is free (Anthony, 2026-11-13); no paid tier or expiring trial. Not installed yet (BACKLOG).
