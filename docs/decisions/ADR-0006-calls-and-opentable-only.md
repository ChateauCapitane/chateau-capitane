# ADR-0006. Calls and OpenTable only: remove the guest inquiry system

Date: 2026-11-16 · Status: accepted (Anthony approved the removal 2026-11-16; planner wrote the scope)

## Context
Anthony decided on 2026-11-16 that guests only call or book on OpenTable (BACKLOG, "Remove the guest inquiry forms").
The site still has a contact form (`src/components/contact/contact-form.tsx`), and Private Events sends guests to it
with `?event=` (`private-events-view.tsx:32`, `tier-section.tsx:44`). Behind the form are: the `POST /api/contact`
route, the staff inbox at `/admin/inquiries`, a notification email cron (`/api/cron/notifications`, every minute), a
Resend delivery webhook (`/api/webhooks/resend`), and inquiry tables that hold guest names, emails, phones and
messages. The scout map at HEAD 99677ba lists every part (S1, 2026-11-16). None of this has ever run live.

## Decision
1. **Remove the intake.** Delete the contact form, the `/api/contact` route, `src/lib/server/contact.ts`,
   `inquiries/contact-input.ts`, `checkContactLimit` + `CONTACT_LIMITS`, and `recordContactInquiry`. The contact page
   keeps its address, map, Book now and Call buttons. The Private Events links that went to the form now go to the
   Call button (`CallCta`). The `contact.form` strings go from `en.ts` and `ru.ts`, and the copy that offers to "send a
   note" or an enquiry is reworded to call or book (EN and RU, no em dashes).
2. **Remove the staff inbox.** Delete `/admin/inquiries` (both pages and its actions) and `inquiries/staff-inbox.ts`.
   `formatTime` moves to `src/lib/server/format-time.ts` (used by the admin content and security pages). The admin home loses its inbox link
   and the "Inquiries" column in the click table.
3. **Remove inquiry email.** Delete the notifications cron route and its worker, the Resend webhook route and
   `delivery-webhook.ts`, and the `notifications` entry in `vercel.json`. Remove the dev dependency `svix` (only its
   test used it). `CONTACT_TO_EMAIL` and `RESEND_WEBHOOK_SECRET` are no longer read.
4. **Keep Resend for security alerts.** `security/incidents.ts` still emails the owner through Resend with
   `RESEND_API_KEY`, `SECURITY_ALERT_EMAIL` and `CONTACT_FROM_EMAIL`. The env var keeps its name, so nothing needs
   reconfiguring.
5. **Remove the contact parts of security monitoring in the app code.** The `contact_limited` / `contact_honeypot`
   codes, the `contact` surface, the contact rule in `rules.ts` and the "Pause the contact form" action and button all
   go. The database check constraints that still allow those values stay. They are harmless with no writer, and
   loosening them would only add churn.
6. **One new migration drops the inquiry data.** It drops `inquiry_private.inquiries`, `submission_keys`,
   `notification_jobs`, `delivery_events`, `inquiry_notes`, the `job_delivery_status` view, and the functions only
   they use (`record_contact_inquiry`, `claim_notification_jobs`, `complete_notification_job`,
   `record_delivery_event`, `check_contact_limit`, `staff_list_inquiries`, `staff_get_inquiry`,
   `staff_set_inquiry_status`, `staff_add_inquiry_note`, `notification_summary`, `delivery_rank`,
   `protect_notification_payload`, `is_calendar_date` if unused). It redefines `ops_snapshot` and the retention
   function without them. It **keeps** `staff_members`, `staff_role`, `audit_events`, `require_staff`,
   `rate_limit_hits` / `hit_rate_limit`, the login and track limits, and the `inquiry_private` schema name (renaming
   it would touch every staff function). Earlier migrations are never edited.
7. **Kept as-is:** every Call button, OpenTable Book now, click counts (`/api/track`), staff sign-in, content and photo
   publishing, health, the security and retention crons, and `CRON_SECRET`.

## Rationale
Fewer moving parts before launch: no guest personal data is stored, and two public endpoints, one every-minute cron,
one webhook secret and one dependency go away. Dropping the tables, rather than leaving them empty, means the
privacy notice can truthfully say the site keeps no guest messages. The constraint values (point 5) and the schema
name (point 6) stay because changing them costs more than the dead names do.

## Consequences
- The privacy notice facts, release checklist (no inquiry email or webhook checks), README, technical/backend docs,
  staff guide and manual checks are updated in the same slice. Older `docs/plans/` files are history and stay.
- Guests who want a private event must call. Booking a table stays on OpenTable.
- Bringing forms back later would mean a new ADR and new migrations. The deleted code stays in git history.
- Not done: removing the dead `contact` values from the security check constraints (logged in BACKLOG).
