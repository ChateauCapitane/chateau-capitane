# ADR-0004. Security monitoring, incident records and owner-approved response

Date: 2026-11-14 · Status: accepted (planner's recommendation, Anthony reviews after; see `adr-trust` memory)

## Context
- The predeployment audit (`docs/security-audit.md`, 2026-11-14) asked for monitoring that detects credible attacks,
  writes structured incident records a future coding agent can investigate, and a controlled response workflow.
- What exists at HEAD: `/api/health` with `ops_snapshot()` (counts only), one-line JSON error logs with fixed codes
  (`src/lib/server/ops.ts`), fixed-window rate limits keyed by an HMAC of the client network for contact, login and
  click beacons (`inquiry_private.rate_limit_hits`), CRON_SECRET bearer checks, Resend webhook signature checks.
  Nothing records *security* events, groups them, or tells anyone.
- `staff_members` is deliberately read-only to every website code path (migration 202610100001, lines 2-12). A response
  action that edits staff membership would undo that decision, so it stays a manual, owner-approved step.
- The site is small (one restaurant, a few staff). Free services only (`free-services-only` memory); Resend and Supabase
  are already in the plan, Vercel Pro already needed for the per-minute cron.

## Decision
**1. Events (append-only counts, bounded).** Table `inquiry_private.security_event_counts (minute timestamptz, code
text, subject text, count int, primary key (minute, code, subject))`, RLS on, no anon/authenticated grants. `subject`
is one purpose-independent key per client network, `HMAC("block:" + network)` computed once per request (the three
limiters hash different strings, so their hashes cannot be reused), or `'-'` when the network is `"unattributed"`;
never an IP, email, name or message. At most 200 distinct subjects per minute; beyond that, counts fold into `'-'`
so rows stay bounded under IPv6 rotation. Codes (check constraint):
`login_failed`, `login_limited`, `staff_denied` (signed-in Auth user who is not staff), `webhook_bad_signature`,
`cron_bad_secret` (cron, retention, security cron and health bearer), `contact_limited`, `contact_honeypot`,
`track_limited`, `upload_refused`, `blocked_request`. One service_role function `public.record_security_event(p_code,
p_subject)` upserts +1. Recording is best-effort: a failure logs `security_event_failed` and never changes the reply.

**2. Detection (fixed rules, in code, versioned).** Cron `/api/cron/security` every 5 minutes (CRON_SECRET) calls
`public.security_detect()`, which applies the rule table below over the last window, writes a heartbeat, and upserts
incidents. Rules live in one SQL function and one TS catalogue (`src/lib/server/security/rules.ts`) that carries each
rule's technique, uncertainty, investigation steps, containment options and rollback text. Starting thresholds, not tuned:

| Rule | Fires when | Severity |
| --- | --- | --- |
| `R1_password_guessing` | `login_failed` ≥ 10 in 15 min from one subject, or ≥ 30 site-wide | high |
| `R2_login_lockout` | `login_limited` ≥ 3 in 15 min | medium |
| `R3_non_staff_admin` | any `staff_denied` (valid Auth token, no `staff_members` row; Supabase sign-up must be off, release checklist) | medium |
| `R4_forged_webhook` | `webhook_bad_signature` ≥ 5 in 15 min | medium |
| `R5_secret_probing` | `cron_bad_secret` ≥ 5 in 15 min | medium |
| `R6_spam_wave` | `contact_limited` ≥ 20 or `contact_honeypot` ≥ 50 in 60 min | low |
| `R7_disguised_upload` | `upload_refused` ≥ 3 in 60 min | medium |
| `R0_synthetic` | only from the synthetic test call | info |

**3. Incident records.** Table `inquiry_private.security_incidents`: `id` (`INC-YYYYMMDD-NNNN`), `schema_version` (1),
`environment`, `status` (`open`, `investigating`, `contained`, `resolved`, `false_positive`), `rule`, `severity`,
`confidence`, `dedup_key` (rule + subject; one open incident per key, repeats update `last_seen` and counts),
`first_seen`, `last_seen`, `event_count`, `subject`, `evidence` (counts per code per window from the database:
provenance `db:security_event_counts`), `actions` (append-only log), timestamps. Records contain only rule output and
counts, never request text, so there is nothing for an attacker to plant instructions in. The full JSON a reader gets
(`docs/incident-response.md`, schema v1) is that row merged with the rule catalogue. At most 50 open incidents; past
that, new detections fold into one open `R*_overflow`-style incident per rule with subject `'-'`.

**4. Alerts.** New or escalated incidents email `SECURITY_ALERT_EMAIL` through the existing Resend `fetch` path. Budget
is counted in the database (survives serverless instances): 10 emails an hour for low/medium/info and a separate 10
for high, so noise cannot starve a high alert; without a Resend key nothing is sent and the incident still shows in health. `/api/health`
(bearer) gains `security_incident_open` (an open high incident) and `security_detection_stale` (no detection run for
15 minutes = telemetry failure, not "no attacks").

**5. Read access for an investigating agent.** `GET /api/security/incidents` and `/api/security/incidents/<id>` with a
separate bearer `MONITOR_TOKEN` (read-only, held by the investigating agent only; cannot act; constant-time compare,
≥ 16 characters, unset = every request refused). The uptime monitor holds a different `HEALTH_TOKEN` (ADR-0005).
Also an owner-only page
`/admin/security` listing incidents.

**6. Response (predefined, reversible, bounded, owner-approved).** Only an `owner` staff session on `/admin/security`
can act; the read token cannot. Two actions, each with an expiry (1 to 24 hours, default 1), logged in the incident and
in `inquiry_private.security_actions (id, kind, subject, reason, incident_id, created_by, created_at, expires_at,
lifted_at)`:
- `block_subject`: requests from one network hash to contact, login and track get the normal limited reply. At most 20
  active blocks. Never by account name, so an attacker cannot lock a staff member out by typing their email. The
  target must match `^[0-9a-f]{64}$` and be the subject of an existing incident (never free text); `'-'` is refused
  (it would block everyone unattributed); a block matching the acting owner's own network is refused. If the owner is
  locked out anyway, recovery is `SECURITY_ACTIONS_DISABLED=1`, the expiry, or the SQL lift in the runbook.
- `pause_contact`: the form answers 503 and guests see the phone number. Cannot pause sign-in.
Lift early from the same page. Emergency stop: `SECURITY_ACTIONS_DISABLED=1` makes every active action ineffective and
refuses new ones. At most 20 actions an hour. Everything else (removing a staff member, rotating keys, deleting data,
firewall or deploy changes) is a runbook step that needs Anthony's approval in that moment.

**7. Retention.** Event counts 30 days, incidents and actions 12 months, through the existing `run_retention()`.

**8. Synthetic test.** `GET /api/cron/security?synthetic=1` (CRON_SECRET) creates an `R0_synthetic` incident marked
test, which goes through dedup, alert (subject `[TEST]`) and health exactly like a real one.

## Rationale
- Built on the limiter, Resend path, cron and health check already in place: no new service, no new dependency, $0.
- Counts per minute instead of an event log keeps rows bounded under a flood (cost amplification) and holds no
  personal data. Fixed rules generated from code make records safe for an agent to read.
- Owner session for actions plus a separate read token separates monitoring from response credentials.

## Consequences
- The same migration adds a site-wide cap on click beacons (audit SEC-08), alongside the per-network one.
- One migration, three API routes (security cron, two incident reads), one admin page, changes in contact, login,
  track, webhook, cron, health and upload paths. High risk: gates, `test:db`, `code-reviewer`, `security-auditor`.
- Detection gaps (documented in `docs/incident-response.md`): Vercel firewall and edge logs, Supabase Auth and API
  logs, Resend account activity and GitHub are not read; DDoS at the edge is Vercel's. Monitoring is not active until
  verified end to end on staging (release checklist).
- Not done (BACKLOG): automatic actions, staff suspension from the site, Slack or SMS alerts, threshold tuning.
- Revisit if alerts are noisy for two weeks, or the site gains guest accounts or payments.

## As built (B-SEC2, 2026-11-14)
- Migration `202611140001_security_monitoring.sql`; server code in `src/lib/server/security/`; owner page
  `/admin/security`; cron `/api/cron/security` every 5 minutes (`vercel.json`).
- Per-subject vs site-wide: R1 per subject (10) and site-wide (30); R2, R3, R7 per subject; R4, R5 site-wide; R6 both.
  A site-wide incident is raised only when no per-subject one was. Severity is fixed per rule (no escalation).
- Overflow past 50 open incidents keeps the rule name, with `dedup_key` `<rule>:overflow`, subject `-` and
  `evidence.overflow = true`.
- Alerts are claimed inside `security_detect()` (10/h other, 10/h high), only for incidents under 2 hours old or
  test incidents; a repeated synthetic call re-arms its alert.
- Both actions require an incident; the reason is copied from the rule, never typed. `pause_contact` is allowed on
  any active incident.
- `public.security_gate` is one extra RPC on contact, sign-in and click beacons. It fails **open** (a database error
  does not block guests), while the existing rate limiters still fail closed. A block gives the normal limited reply
  (contact 429, sign-in "too many attempts", beacon 204).
- `upload_refused` counts only wrong-format or unreadable files. Click-beacon site-wide cap (SEC-08): 600 per
  10 minutes (`track-all` bucket).
- `ops_snapshot` gains `securityHighOpen`, `securityLastRunSeconds`; `run_retention` gains `securityRecords`.
