# Manual checks

Things only the owner can check or provide. Tick a box when done, adding a short note on what you found; Claude fixes whatever the checks turn up.

Return gate: away

`away` means Claude may work the next task. When you come back with results, set it to `back`: while any box below is open, the session's only work is your checks and fixing what they find.

## Site content

- [ ] A native Russian speaker reads the `/ru` pages: names (Стэнли, Алик, "Шеф Стэн"), the "Звонок" button, dish names, banquet wording.
- [ ] Neighborhood name guests use: Sheepshead Bay or Gravesend.
- [ ] Facts to confirm before they appear: parking, nearest subway, delivery, vegetarian/gluten-free dishes, happy hour.
- [ ] Star ratings and review counts for Yelp, Google and OpenTable (shown as text with links, never in Google markup).
- [ ] Schema price range ($$$), and whether to add the restaurant email to the schema.
- [ ] Real photos with provenance for the About page; your wording for well-known dishes.

## Outside accounts

- [ ] Google Business Profile: primary category Russian restaurant, plus Seafood restaurant and Banquet hall; one spelling of the name everywhere.
- [ ] inKind (ask Nasima): does the script need the final domain, should it show on Russian pages, is a staging check wanted? Agree to its guest-data terms.
- [ ] Release accounts and costs ([release checklist](release-checklist.md) section 1): Vercel Pro + Supabase Pro (about $45/month), Resend with a verified domain, an uptime monitor, first staff names and emails.

## Repository access

- [ ] Change `.claude/settings.json` so Claude may push only to `claude/*` branches. Claude can't edit its own permissions, so approve the edit in Default mode or make it yourself.
