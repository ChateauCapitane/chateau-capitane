/** The rule catalogue (ADR-0004, docs/incident-response.md). Detection itself lives in one SQL function
 * (supabase/migrations/202611140001_security_monitoring.sql); this file adds what a person or an investigating
 * agent needs to read next to an incident. Every string here is fixed text written by us, so an incident
 * never carries request text. A rule added to the SQL needs an entry here (tests/security-monitoring.test.mjs checks).
 */
export const SEVERITIES = ["info", "low", "medium", "high"] as const;
export type Severity = (typeof SEVERITIES)[number];
export type Action = "block_subject";

export type Rule = Readonly<{
  severity: Severity;
  services: readonly string[];
  endpoints: readonly string[];
  technique: string;
  uncertainty: string;
  investigation: readonly string[];
  /** Predefined actions the owner may take from /admin/security for this rule. */
  actions: readonly Action[];
  containment: readonly string[];
  rollback: string;
  /** Steps that always need Anthony's yes in that moment. */
  approvalRequired: readonly string[];
}>;

const LIFT = "Lift the action on /admin/security; it also expires on its own (1 to 24 hours).";

export const RULES = {
  R0_synthetic: {
    severity: "info", services: ["security monitoring"], endpoints: ["/api/cron/security"],
    technique: "Synthetic test incident from the security cron's test call. Not an attack.",
    uncertainty: "None; created on purpose to check detection, alerts and health.",
    investigation: ["Confirm it appears in the read API, on /admin/security and (if configured) as a [TEST] email"],
    actions: [], containment: ["None; set the status to resolved"], rollback: "Nothing to undo.", approvalRequired: [],
  },
  R1_password_guessing: {
    severity: "high", services: ["staff sign-in"], endpoints: ["/admin/login"],
    technique: "Credential guessing or stuffing against staff sign-in",
    uncertainty: "A staff member who forgot a password looks the same; one network may be shared by the whole office.",
    investigation: ["Ask staff whether anyone struggled to sign in", "Check Supabase Auth logs for the window",
      "Look for other open incidents from the same subject"],
    actions: ["block_subject"], containment: ["block_subject for 1 hour when one network; sign-in is already rate limited"],
    rollback: LIFT, approvalRequired: ["password resets", "turning on multi-factor sign-in", "staff removal"],
  },
  R2_login_lockout: {
    severity: "medium", services: ["staff sign-in"], endpoints: ["/admin/login"],
    technique: "Repeated sign-in lockouts: guessing, or a deliberate attempt to lock a staff member out",
    uncertainty: "Staff mistyping repeatedly looks the same.",
    investigation: ["Confirm staff can sign in from another network", "Check for an R1 incident from the same subject"],
    actions: ["block_subject"], containment: ["block_subject for 1 hour if the network is not the staff's own"],
    rollback: LIFT, approvalRequired: [],
  },
  R3_non_staff_admin: {
    severity: "medium", services: ["staff sign-in"], endpoints: ["/admin/login"],
    technique: "A valid Supabase Auth user who is not on the staff list signed in (removed staff, or sign-up left open)",
    uncertainty: "A recently removed staff member signing in by habit looks the same.",
    investigation: ["Check that Supabase sign-up is off", "Ask whether a staff member was removed recently",
      "Check Supabase Auth logs for the new user"],
    actions: [], containment: ["None on the site; the user was signed straight back out and saw no staff data"],
    rollback: "Nothing to undo.", approvalRequired: ["banning the Auth user in Supabase", "turning sign-up off"],
  },
  R4_forged_webhook: {
    severity: "medium", services: ["email delivery webhook"], endpoints: ["/api/webhooks/resend"],
    technique: "Forged delivery events sent to the Resend webhook",
    uncertainty: "A rotated RESEND_WEBHOOK_SECRET that was not updated in Vercel looks the same.",
    investigation: ["Compare the webhook secret in Vercel with the Resend dashboard", "Check Resend account activity"],
    actions: [], containment: ["None needed: forged events are rejected before they are read"],
    rollback: "Nothing to undo.", approvalRequired: ["rotating the webhook secret"],
  },
  R5_secret_probing: {
    severity: "medium", services: ["cron, health and monitoring routes"],
    endpoints: ["/api/cron/*", "/api/health", "/api/security/incidents"],
    technique: "Guessing CRON_SECRET, HEALTH_TOKEN or MONITOR_TOKEN",
    uncertainty: "An uptime monitor still holding an old token looks the same.",
    investigation: ["Check the uptime monitor's token", "Check Vercel request logs for the window"],
    actions: [], containment: ["None needed: wrong tokens are refused"],
    rollback: "Nothing to undo.", approvalRequired: ["rotating a token (brief cron pause)"],
  },
  R7_disguised_upload: {
    severity: "medium", services: ["staff photo upload"], endpoints: ["/admin/content"],
    technique: "A staff session uploading files that are not real photos",
    uncertainty: "Staff uploading HEIC or unusual files by mistake looks the same.",
    investigation: ["Ask the staff member what they uploaded", "Check recent content versions and sign-ins"],
    actions: [], containment: ["None automatic; refused files are never stored"],
    rollback: "Nothing to undo.", approvalRequired: ["removing a staff member and revoking their sessions"],
  },
} as const satisfies Record<string, Rule>;

export type RuleName = keyof typeof RULES;
export const isRuleName = (value: unknown): value is RuleName => typeof value === "string" && Object.hasOwn(RULES, value);
