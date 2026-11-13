# Manual checks for Anthony

Things only Anthony (or the restaurant owner) can do or provide by hand, collected so they run in one sitting. Agents
add an item whenever something cannot be tested automatically, and tick it off only when Anthony says it is done. Keep
each item to what to do and what to expect.

**Return gate: away**

While this says `away`, nothing is blocked. When Anthony says "I'm back", the planner changes it to `back`; then the
only work is his checks and fixing what they find (`/go`, `.claude/rules/session-workflow.md`, *Start*) until no box
under *Open* is still `- [ ]`. A box counts as done as `- [x]` (passed) or `- [!]` (failed; the problem goes to
`docs/BACKLOG.md` in the same edit). Only Anthony's word ticks a box or drops an item. No agent changes this line except
on his "I'm back" or "I'm away". Only items under *Open* block; *Later* waits for the release (B12).

Dev from PowerShell: `npm.cmd run dev`, then http://localhost:3000 (English) and http://localhost:3000/ru (Russian).

## Open

- [ ] **Russian read-through.** A native Russian speaker reads every `/ru` page. Check the names (Стэнли, Алик,
  "Шеф Стэн"), the "Звонок" button, dish names and the banquet wording. Expect: nothing reads as machine-translated.
- [ ] **Neighborhood name.** Tell us which name guests use: Sheepshead Bay or Gravesend. It then goes into the home
  "Visit us" heading and the menu and contact copy.
- [ ] **Facts to confirm** before they appear on the site: parking, nearest subway, delivery, vegetarian or gluten-free
  dishes, happy hour.
- [ ] **Ratings.** Star ratings and review counts for Yelp, Google and OpenTable. Shown as text with links, never in
  Google markup.
- [ ] **Schema details.** Confirm the price range ($$$), and whether the restaurant email goes into the schema.
- [ ] **Photos and wording.** Real photos with provenance for the About page; the owner's wording for well-known dishes.

## Later (outside accounts; wait for the release)

- [ ] **Google Business Profile:** primary category Russian restaurant, plus Seafood restaurant and Banquet hall; one
  spelling of the name everywhere (site, Yelp and OpenTable differ today).
- [ ] **inKind (ask Nasima):** does the script need the final domain, should it show on the Russian pages, is a
  staging check wanted? The owner agrees to its guest-data terms.
- [ ] **Release accounts and costs** ([release checklist](release-checklist.md) section 1): Vercel Pro + Supabase Pro
  (about $45/month), Resend with a verified domain, an uptime monitor, first staff names and emails.

## Done

- [x] **Push rule** (2026-11-12, changed 2026-11-13). Anthony allowed Claude to push, `main` included, only when he
  asks in that moment; every push asks first. Force pushes, `--all` and `--mirror` stay denied.
