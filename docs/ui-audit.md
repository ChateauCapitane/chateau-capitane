# UI/UX audit (T-GM2)

Date: 2026-11-14. Branch at time of audit: `fix/gallery-menu` (working tree, dev server at http://localhost:3000).
Method: Playwright MCP (Chromium) driving the dev server, plus reading the source lines named below. Report only; no
application code changed. Screenshots are in `docs/ui-audit/`.

## 1. Assessment

The site is in good shape. The automated sweep across 17 routes × 6 widths found no rounded corners, shadows or
gradients, only the two brand fonts, no missing alt text, no broken images, no unnamed controls, no touch target under
24px, one `h1` per page and no text below WCAG AA contrast. Every internal link and anchor resolves. Keyboard focus is
visible at every tab stop sampled, the skip link comes first, the mobile menu closes on Escape and returns focus, and
reduced motion stops the hero animation.

What needs attention: (1) at 320px every page scrolls sideways and, in Russian, the menu button is pushed half off
screen; (2) the contact form drops keyboard focus on submit and gives a generic "check the form" error that doesn't say
which field; (3) em dashes remain in site copy (mostly banquet menus and Russian strings), against `docs/design.md`;
(4) the staff login shows the public header, whose RU switch leads to a 404. No critical findings.

## 2. What was inspected

**Pages (EN and `/ru`):** home, menu, private events, gallery, about, contact, testimonials, 404 (`/does-not-exist`),
plus `/admin/login` (EN only by design; `/ru/admin/login` returns 404).

**Viewports:** 320, 375, 768, 1024, 1280, 1440px (all routes, automated). Screenshots at 320/375/768/1024/1280/1440 for
the pages named in each finding.

**Journeys:** home → menu (section index, lunch anchor `#lunch-special`), home → private events (package anchors),
private events → contact `?event=kids` (preselects the package), contact form submit (empty, success, invalid, failure,
EN and RU), mobile menu open/Tab/Escape, language switch on every page, 404 recovery links, staff sign-in (empty submit).

**States:** focus (Tab through `/`, `/menu`, `/contact` at 1280), sending/disabled, success, error (400 and 500),
native required-field validation, reduced motion on and off, mobile menu open/closed, `aria-current` in both navs.

**Automated checks (script, every route × width):** horizontal overflow, elements past the viewport edge, interactive
targets < 24×24px, border-radius, box-shadow, gradients, font families, missing/empty alt, broken images, controls
without an accessible name, em dashes in rendered text, `h1` count, HTTP status. Contrast (text vs. composited
background, AA thresholds) on all EN routes at 1280. Link crawl (47 internal hrefs + anchors). CLS and LCP via
`PerformanceObserver` on `/`, `/menu`, `/ru`, `/contact`.

**Coverage gaps (not run / not checked):**
- Signed-in `/admin` pages (inquiries, content editor, media, security): sign-in can't complete locally without a
  database, and I did not submit credentials so no auth provider is contacted. Only `/admin/login` was audited.
- The inKind pop-up never appeared: its script loads, but its call to `app.localhost:3000/api/v4/capture_modals` fails
  with a CORS error locally. Its dialog focus, labelling and Escape behaviour are **not checked**.
- Contact submissions were mocked in the browser (`page.route`) at 202/400/500; no request reached `/api/contact`.
  The real 400 triggers and the 429/413 paths were not exercised.
- Contrast was measured on EN at 1280 only and skips text over photos; RU was spot-checked by screenshot.
- Hover and active styles were checked in code (`hover:` classes) and not visually captured.
- Screen-reader output (NVDA/VoiceOver) was not run; accessibility notes come from the DOM and accessibility tree.
- Performance numbers are from the dev server on localhost: CLS is meaningful, LCP is not (labelled as such below).
- Firefox/Safari were not run (Chromium only). Real devices were not used.

**In-progress items, current state only:** the gallery renders its section headings with empty gold-framed placeholder
tiles, no photos (`gallery-1280-view.png`). Menu prices were not assessed.

## 3. Findings

Each finding says whether it was found **automated** (script) or **by hand** (looked at the page or the code), and
whether it is a **defect** or a **design suggestion**.

### Critical

None.

### High

#### H1. Header overflows at 320px; RU menu button half off screen — defect, automated + by hand

- **Where:** shared header, every public page and `/admin/login`.
- **Repro:** set the viewport to 320px; open `/ru` (or any page). Scroll sideways.
- **Expected:** no horizontal scrolling at 320 CSS px (WCAG 2.2 SC 1.4.10 Reflow); menu button fully visible.
- **Actual:** EN pages are 322px wide (2px sideways scroll). RU pages are 346px wide: the "Открыть меню" button ends at
  346px, so about half of it is cut off until the visitor scrolls sideways.
  Screenshots: `ui-audit/ru-home-320-header-overflow.png`, `ui-audit/home-320-header-overflow.png`.
- **Impact:** on the smallest phones (and at 400% zoom on desktop) Russian visitors may not see the menu button, which
  is the only way to reach Menu, Private Events, Contact and the header Book now on inner pages.
- **Source:** `src/components/layout/header.tsx:29-44` (logo, two lines below `xs`) and `:58-80` (mobile cluster:
  Call text + language switch + menu button with `-mr-2`); RU label `src/lib/i18n/ru.ts:26` ("Звонок").
- **Fix:** below `xs`, replace the "Call"/"Звонок" text in the mobile cluster with a phone icon (24px glyph in the same
  44px target, `aria-label` unchanged), which frees ~40px EN / ~65px RU. Alternatively move the language switch into
  the open mobile menu below `xs`. Re-run the 320px sweep for EN and RU.

### Medium

#### M1. Contact form loses keyboard focus on submit; results look the same for success and error — defect, by hand

- **Where:** `/contact`, `/ru/contact`.
- **Repro:** Tab to "Send message", press Enter (or click). Check `document.activeElement` after the result appears.
- **Expected:** focus stays on the button or moves to the result message; an error is visibly distinct from success.
- **Actual:** the button becomes `disabled` while sending, so the browser drops focus to `<body>` (measured on 202, 400
  and 500 responses, EN and RU). Success ("Thank you…"), invalid and failure messages all render in the same muted
  ivory (`rgb(183,179,168)`) small text under the button, with no icon or heading.
  Screenshots: `ui-audit/contact-375-202.png`, `ui-audit/contact-375-400.png`, `ui-audit/contact-375-500.png`.
- **Impact:** keyboard and screen-reader users lose their place after sending (the next Tab starts from the top of the
  page). Sighted guests can miss that a message failed, and an unnoticed failure is a lost inquiry.
- **Source:** `src/components/contact/contact-form.tsx:176-181` (`disabled={status === "sending"}`), `:184-203`
  (one `aria-live="polite"` paragraph, `text-ivory-muted` for every state).
- **Fix:** use `aria-disabled="true"` plus the existing `sending` ref guard instead of `disabled`, so focus stays on the
  button; or give the result paragraph `tabIndex={-1}` and focus it when the status settles. Render failure and
  invalid states with `role="alert"` and a stronger treatment (ivory text with a gold left rule, for example), keeping
  success as it is.

#### M2. Form error doesn't say which field is wrong — defect, by hand

- **Where:** `/contact`, `/ru/contact`.
- **Repro:** paste a message longer than 5,000 characters (or a name over 200, a phone over 40) and submit. The browser
  accepts it; the server returns 400.
- **Expected:** the field in error is identified in text (WCAG 3.3.1), ideally before sending.
- **Actual:** the form shows "Some details didn't look right. Please check the form and try again." with no field
  named and no `aria-invalid` on any field (400 response mocked; the server limits are read from code).
  Screenshot: `ui-audit/contact-375-400.png`.
- **Impact:** a guest with a long banquet description can't find what to fix and may give up.
- **Source:** server limits `src/lib/server/inquiries/contact-input.ts:113-115`; client fields have no `maxLength`
  `src/components/contact/contact-form.tsx:112, 116-124, 128, 160`.
- **Fix:** mirror the server limits in the browser: `maxLength={200}` on name, `254` on email, `40` on phone,
  `5000` on message (native validation then names the field). Keep the generic 400 text as the fallback.

#### M3. Em dashes in site copy — defect against `docs/design.md`, automated

- **Where:** rendered text on `/menu` (2), `/private-events` (14), `/testimonials` (2, inside guest quotes), and in RU on
  `/ru`, `/ru/menu`, `/ru/private-events`, `/ru/about`, `/ru/contact`, `/ru/testimonials`, including the RU contact
  failure message ("…(718) 339-2800 — мы всё уладим.").
- **Repro:** search the rendered page text for "—".
- **Expected:** no em dashes in site copy (`docs/design.md`, "Copy is elegant… avoid em dashes").
- **Actual:** em dashes come from data and dictionaries:
  `src/lib/data/private-events.ts` (15, e.g. `:88`, `:146`, `:176`), `src/lib/data/menu.ts:362`,
  `src/lib/i18n/ru.ts` (10: `:67, 86, 109, 117, 128, 132, 136, 173, 186, 190`), `src/lib/i18n/content-ru.ts` (15),
  `src/lib/data/testimonials.ts` (2, guest quotes), `src/lib/data/gallery.ts` (2).
- **Impact:** brand-voice inconsistency; low guest impact.
- **Fix:** EN: replace with a colon for lists ("Mixed kebab: kebab po karski, …") or commas. Leave guest quotes verbatim
  (they are the reviewer's words). RU: the dash is grammatical in Russian ("Château Capitaine — бар и гриль"), so this
  needs a planner decision: either allow it in Russian copy and say so in `docs/design.md`, or rewrite those sentences.

#### M4. Staff login shows the public header; its RU switch leads to a 404 — defect, by hand

- **Where:** `/admin/login` (and every staff page, by the shared shell).
- **Repro:** open `/admin/login`, click "RU" in the header.
- **Expected:** staff pages carry no public language switch (staff pages are English only, `AGENTS.md`).
- **Actual:** the full public header and footer render, including RU (`href="/ru/admin/login"`, which returns 404),
  Call and Book now. Screenshots: `ui-audit/admin-login-375.png`, `ui-audit/admin-login-1280.png`.
- **Impact:** a staff member who taps RU lands on "This page has moved on"; the guest-facing Book now/Call in the staff
  area is noise.
- **Source:** `src/components/layout/document.tsx:65-68` (always renders `<Header />` and `<Footer />`), used by
  `src/app/[lang]/(staff)/layout.tsx:13`.
- **Fix:** give `Document` a `staff` flag (or a `header` slot) so the staff root layout renders a slim header: logo
  linking to `/admin` and nothing else. At minimum hide `LanguageSwitch` when the path starts with `/admin`.

### Low

#### L1. 404 page keeps the home page's browser title — defect, automated

- **Repro:** open `/does-not-exist`. Browser tab reads "Russian Seafood Restaurant in Brooklyn | Château Capitaine".
- **Expected:** "Page not found | Château Capitaine" (`meta.notFoundTitle` exists in `en.ts`/`ru.ts`).
- **Source:** `src/app/[lang]/(site)/not-found.tsx:10-12` exports `generateMetadata`, which the version-matched Next.js
  docs only document for the root `app/not-found.js` (`node_modules/next/dist/docs/01-app/01-getting-started/10-error-handling.md:190`).
- **Impact:** screen-reader users hear the home title on a 404; the tab is misleading.
- **Fix:** add the same `generateMetadata` to `src/app/[lang]/(site)/[...rest]/page.tsx` (the matched route).
  Unverified: whether this nested `not-found` should honour metadata in this Next version; confirm with a run.
  Screenshot: `ui-audit/404-1280.png`.

#### L2. Typo on the 404 page — defect, by hand

- **Where:** `/does-not-exist`. **Actual:** "The menu and our banquet packages are the two people usually want."
- **Source:** `src/lib/i18n/en.ts:200`. **Fix:** "…are the two things people usually want."
  Screenshot: `ui-audit/404-1280.png`.

#### L3. RU header Call label is a noun — defect (copy), by hand

- **Actual:** the header shows "Звонок" ("a call"); the hero and 404 buttons say "Позвонить" ("Call", the verb).
- **Source:** `src/lib/i18n/ru.ts:26`. **Fix:** "Позвонить" (also check it after H1, since it is longer).
  Screenshot: `ui-audit/ru-home-1024.png`.

#### L4. Photos load a 1200px file into a 312px slot — defect (performance), automated

- **Repro:** `/` at 375px, scroll to Signature dishes; `currentSrc` is `/_next/image?…&w=1200` for each photo (the
  source JPEGs are 800px wide).
- **Source:** `src/components/ui/placeholder-image.tsx:30-39` (`width={1200}`, no `sizes`).
- **Impact:** more bytes than needed on mobile data (estimate; not measured on a throttled network).
- **Fix:** add a `sizes` prop to `PlaceholderImage` (default `"(min-width: 1024px) 33vw, 100vw"`) and pass it to
  `Image`, so the browser picks a 640/750 variant on phones.

#### L5. "Borsh" on the lunch card, "Borscht" elsewhere — content check, by hand

- **Where:** home lunch card and menu lunch section (`src/lib/data/menu.ts:420`) vs. menu soups (`:258`) and hero copy.
- **Fix:** confirm against the printed lunch menu (menu content is being checked in this branch); if not intentional,
  use "Borscht".

#### L6. OpenTable link details — content check, by hand

- The Book now link uses `lang=en-US` on `/ru` too, and its `ot_source` value reads `Restaurantebsite`
  (`src/lib/data/site.ts:76`). Both are marked as the verified link from the current site, so I did not treat them as
  defects. Suggest the owner confirm the attribution value with OpenTable and whether a Russian-language booking page
  exists. Link, `target="_blank"` and `rel="noopener noreferrer"` are correct on every Book now.

### Design suggestions (not defects)

- **S1. Private events hero at 768px** — narrow text column (headline wraps to three lines) beside a small,
  bottom-aligned placeholder, leaving a large empty block. `src/components/private-events/private-events-view.tsx:24`
  switches to 12 columns at `md`; stacking until `lg` would read better on tablets. Screenshot: `ui-audit/events-768.png`.
- **S2. Section index scrollers** (`/menu`, `/private-events` below `lg`) show the native OS scrollbar with arrow
  buttons under the links (`ui-audit/menu-375-index.png`). A thin `scrollbar-color: gold/ink` or an edge fade would fit
  the identity better and signal "more to the right". `src/components/ui/section-index.tsx:20`.
- **S3. Testimonials is reachable only from the footer.** Fine if intended; otherwise add it to the About page as a
  link.
- **S4. Language switch drops `?event=` and `#hash`** (`/contact?event=kids` → `/ru/contact`). This is documented as
  intended (`src/components/layout/language-switch.tsx:11`); keeping the query on `/contact` would preserve a package
  choice for a guest switching language mid-inquiry.

### Checks that passed (for the record)

| Check | Result | How |
| --- | --- | --- |
| Square corners, no shadows, no gradients | 0 hits on 17 routes × 6 widths | automated |
| Fonts | Albert Sans and Bodoni Moda only | automated |
| Alt text / broken images | none missing, none broken | automated |
| Targets ≥ 24×24px (SC 2.5.8) | no failures outside inline text links | automated |
| Accessible names | no unnamed links, buttons or fields | automated |
| Text contrast AA (EN, 1280) | all pass on 9 routes (text over photos not measured) | automated |
| Internal links and anchors | 47 links 200; all `#` targets exist; one 404 (M4) | automated |
| Focus visible | gold or ivory 2px outline at every tab stop on `/`, `/menu`, `/contact` | automated |
| Skip link | first tab stop, targets `#main` | automated |
| Mobile menu | `aria-expanded`, Escape closes and returns focus, `aria-current` correct EN and RU | by hand |
| `?event=kids` preselects the package | yes | by hand |
| Reduced motion | no animations; without it, `chart-in` and `rise` run once | automated |
| Layout shift | CLS 0.000 on `/`, `/menu`, `/ru`, `/contact` | measured (dev server) |
| LCP | 164 to 376ms, a text paragraph | measured on localhost dev server: not representative of production |
| Book now / Call | present in header (desktop), mobile menu, hero, contact; `tel:+17183392800` everywhere | by hand |

## 4. Quick wins and implementation order

Quick wins (copy or one-attribute changes, under an hour together): L2 typo, L3 RU label, M2 `maxLength` attributes,
L1 404 title, the EN half of M3.

Suggested order:
1. **H1** header at 320px (visible defect, Russian guests, shared component). UI Builder; recheck 320/375 EN+RU.
2. **M1 + M2** contact form focus, error treatment and limits (one file, one slice). UI Builder; recheck with mocked
   202/400/500 as in this audit.
3. **M4** staff header without the public language switch (touches the shared `Document`; coordinate with ADR-0005).
4. **Quick wins:** L1, L2, L3, EN em dashes from M3. Planner decides the Russian dash rule first.
5. **L4** image `sizes`.
6. Design suggestions S1 to S4 as BACKLOG items, and a follow-up check of the inKind pop-up on a deployed preview
   (coverage gap).

## Screenshots

All in `docs/ui-audit/`: `home-320-header-overflow.png`, `ru-home-320-header-overflow.png`, `home-375.png`,
`home-768.png`, `home-1024.png`, `home-1280.png`, `home-1440.png`, `ru-home-375.png`, `ru-home-1024.png`,
`ru-home-1280.png`, `menu-375.png`, `menu-375-index.png`, `menu-768-index.png`, `menu-1280.png`, `ru-menu-375.png`,
`events-375.png`, `events-375-index.png`, `events-768.png`, `events-1280.png`, `gallery-1280-empty.png`,
`gallery-1280-view.png`, `about-375.png`, `testimonials-1280.png`, `contact-375.png`, `contact-1280.png`,
`contact-1280-map.png`, `contact-375-empty-submit.png`, `contact-375-202.png`, `contact-375-400.png`,
`contact-375-500.png`, `contact-375-ru-400.png`, `contact-375-ru-500.png`, `mobile-nav-open-375.png`,
`404-375.png`, `404-1280.png`, `admin-login-375.png`, `admin-login-1280.png`, `home-375-signature-blank.png`
(signature photos after scroll; the full-page `home-375.png` shows two of them blank only because lazy images had not
loaded in the full-page capture).
