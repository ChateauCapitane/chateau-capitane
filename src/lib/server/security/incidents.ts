import "server-only";
import { site } from "@/lib/data/site";
import type { Staff } from "../auth/staff-auth";
import { callRpc, type Configuration } from "../inquiries/persistence";
import { RULES, isRuleName, type Action } from "./rules";
import { EVENT_CODES, actionsDisabled } from "./record";

export const INCIDENT_ID = /^INC-\d{8}-\d{4}$/;
export const STATUSES = ["open", "investigating", "contained", "resolved", "false_positive"] as const;
export type Status = (typeof STATUSES)[number];
export const isStatus = (value: unknown): value is Status => STATUSES.includes(value as Status);
const LIST_MAX_BYTES = 512 * 1024;
const HASH = /^[0-9a-f]{64}$/;
const ENVIRONMENTS = ["production", "preview", "local"];
const SEVERITY_VALUES = ["info", "low", "medium", "high"];
const CONFIDENCE_VALUES = ["low", "medium", "high"];

type Options = { env?: NodeJS.ProcessEnv; fetch?: typeof fetch };

export type ActionRecord = Readonly<{ id: number; kind: Action; created_at: string; expires_at: string; lifted_at: string | null;
  by: "owner"; outcome: "active" | "lifted" | "expired" }>;

/** Schema v1 (docs/incident-response.md): a database row merged with the rule catalogue. */
export type IncidentRecord = Readonly<{
  schema_version: 1; id: string; environment: string; status: Status; test: boolean;
  created_at: string; updated_at: string; first_seen: string; last_seen: string;
  rule: string; severity: string; confidence: string; subject: string;
  affected: { services: readonly string[]; endpoints: readonly string[]; accounts: readonly [] };
  evidence: { provenance: "db:security_event_counts"; window_minutes: number; counts: Record<string, number>; log_refs: readonly string[] };
  event_count: number;
  technique: string; uncertainty: string; investigation: readonly string[]; containment: readonly string[]; rollback: string;
  actions: readonly ActionRecord[]; approval_required: readonly string[]; escalation_contact: "configured" | "not configured";
}>;

/** VERCEL_ENV decides the label; anything that is not a Vercel deployment is local. */
export function securityEnvironment(env: NodeJS.ProcessEnv = process.env) {
  return env.VERCEL_ENV === "production" ? "production" : env.VERCEL_ENV === "preview" ? "preview" : "local";
}

export function alertConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const apiKey = env.RESEND_API_KEY?.trim(), to = env.SECURITY_ALERT_EMAIL?.trim(), from = env.CONTACT_FROM_EMAIL?.trim();
  return apiKey && to && from ? { apiKey, to, from } : null;
}

const isTime = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));

/** Validates a database row and merges the catalogue. A row that does not fit is dropped (never passed on). */
export function toIncident(row: unknown, env: NodeJS.ProcessEnv = process.env, now = Date.now()): IncidentRecord | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || !INCIDENT_ID.test(r.id) || r.schema_version !== 1 || !isRuleName(r.rule) || !isStatus(r.status) ||
      typeof r.environment !== "string" || !ENVIRONMENTS.includes(r.environment) ||
      typeof r.severity !== "string" || !SEVERITY_VALUES.includes(r.severity) ||
      typeof r.confidence !== "string" || !CONFIDENCE_VALUES.includes(r.confidence) ||
      typeof r.test !== "boolean" || typeof r.subject !== "string" || (r.subject !== "-" && !HASH.test(r.subject)) ||
      !Number.isInteger(r.event_count) || !isTime(r.created_at) || !isTime(r.updated_at) || !isTime(r.first_seen) || !isTime(r.last_seen)) return null;
  const evidence = r.evidence as Record<string, unknown> | null;
  if (!evidence || typeof evidence !== "object" || evidence.provenance !== "db:security_event_counts" ||
      !Number.isInteger(evidence.window_minutes) || !evidence.counts || typeof evidence.counts !== "object") return null;
  const counts: Record<string, number> = {};
  for (const [code, value] of Object.entries(evidence.counts)) {
    if ((EVENT_CODES as readonly string[]).includes(code) && Number.isInteger(value)) counts[code] = value as number;
  }
  const actions: ActionRecord[] = [];
  for (const a of Array.isArray(r.actions) ? r.actions : []) {
    if (!a || typeof a !== "object") return null;
    const { id, kind, created_at, expires_at, lifted_at } = a as Record<string, unknown>;
    if (!Number.isInteger(id) || kind !== "block_subject" || !isTime(created_at) || !isTime(expires_at) ||
        (lifted_at !== null && !isTime(lifted_at))) return null;
    const outcome = lifted_at ? "lifted" : Date.parse(expires_at) <= now ? "expired" : "active";
    actions.push({ id: id as number, kind, created_at, expires_at, lifted_at: lifted_at as string | null, by: "owner", outcome });
  }
  const rule = RULES[r.rule];
  return {
    schema_version: 1, id: r.id, environment: r.environment, status: r.status, test: r.test,
    created_at: r.created_at, updated_at: r.updated_at, first_seen: r.first_seen, last_seen: r.last_seen,
    rule: r.rule, severity: r.severity, confidence: r.confidence, subject: r.subject,
    affected: { services: rule.services, endpoints: rule.endpoints, accounts: [] },
    evidence: { provenance: "db:security_event_counts", window_minutes: evidence.window_minutes as number, counts, log_refs: [] },
    event_count: r.event_count as number,
    technique: rule.technique, uncertainty: rule.uncertainty, investigation: rule.investigation, containment: rule.containment,
    rollback: rule.rollback, actions, approval_required: rule.approvalRequired,
    escalation_contact: alertConfiguration(env) ? "configured" : "not configured",
  };
}

/** Newest first; undefined when storage is unavailable. With an id, at most one record. */
export async function readIncidents(configuration: Configuration, query: { id?: string; limit?: number } = {},
  options: Options = {}): Promise<IncidentRecord[] | undefined> {
  if (query.id !== undefined && !INCIDENT_ID.test(query.id)) return [];
  const rows = await callRpc(configuration, "security_incidents_read",
    { p_id: query.id ?? null, p_limit: query.limit ?? 50 }, LIST_MAX_BYTES, options.fetch);
  if (!Array.isArray(rows)) return undefined;
  return rows.map((row) => toIncident(row, options.env)).filter((row): row is IncidentRecord => row !== null);
}

/** Owner page read: the database re-checks that `staff.userId` is an owner (security_owner_incidents_read). */
export async function readIncidentsAsOwner(configuration: Configuration, staff: { userId: string }, limit = 50,
  options: Options = {}): Promise<IncidentRecord[] | undefined> {
  const rows = await callRpc(configuration, "security_owner_incidents_read",
    { p_staff: staff.userId, p_id: null, p_limit: limit }, LIST_MAX_BYTES, options.fetch);
  if (!Array.isArray(rows)) return undefined;
  return rows.map((row) => toIncident(row, options.env)).filter((row): row is IncidentRecord => row !== null);
}

export type Alert = { id: string; rule: string; severity: string; eventCount: number; test: boolean; counts: Record<string, number> };

/** Runs detection (and the synthetic test when asked). `alerts` are the ones that fit the hourly budget. */
export async function runDetection(configuration: Configuration, input: { synthetic: boolean; claimAlerts: boolean },
  options: Options = {}): Promise<{ alerts: Alert[] } | undefined> {
  const result = await callRpc(configuration, "security_detect", { p_environment: securityEnvironment(options.env),
    p_synthetic: input.synthetic, p_claim_alerts: input.claimAlerts }, 64 * 1024, options.fetch);
  if (!result || typeof result !== "object" || !Array.isArray((result as { alerts?: unknown }).alerts)) return undefined;
  const alerts: Alert[] = [];
  for (const a of (result as { alerts: unknown[] }).alerts) {
    if (!a || typeof a !== "object") continue;
    const { id, rule, severity, eventCount, test, counts } = a as Record<string, unknown>;
    if (typeof id !== "string" || !INCIDENT_ID.test(id) || !isRuleName(rule) || typeof severity !== "string" ||
        !SEVERITY_VALUES.includes(severity) || !Number.isInteger(eventCount) || typeof test !== "boolean") continue;
    const clean: Record<string, number> = {};
    for (const [code, value] of Object.entries(counts && typeof counts === "object" ? counts : {})) {
      if ((EVENT_CODES as readonly string[]).includes(code) && Number.isInteger(value)) clean[code] = value as number;
    }
    alerts.push({ id, rule, severity, eventCount: eventCount as number, test, counts: clean });
  }
  return { alerts };
}

function reviewLink(env: NodeJS.ProcessEnv) {
  const host = env.ADMIN_HOST?.trim();
  return host && /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? `https://${host}/admin/security` : `${site.url}/admin/security`;
}

/** One alert email through Resend. The body holds the id, rule, severity, counts and a link: no network hash,
 * no guest data. Never throws; false means it was not sent (an `.invalid` address is skipped on purpose).
 */
export async function sendAlert(alert: Alert, settings: { apiKey: string; to: string; from: string },
  options: Options = {}): Promise<boolean> {
  if (/\.invalid>?$/i.test(settings.to) || /\.invalid>?$/i.test(settings.from)) return false;
  const counts = Object.entries(alert.counts).map(([code, n]) => `${code}: ${n}`).join(", ") || "none";
  const lines = [`Incident ${alert.id}`, `Rule: ${alert.rule}`, `Severity: ${alert.severity}`,
    `Events in the window: ${counts}`, ...(alert.test ? ["This is a test incident."] : []), "",
    `Review: ${reviewLink(options.env ?? process.env)}`];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await (options.fetch ?? fetch)("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ from: settings.from, to: settings.to,
        subject: `${alert.test ? "[TEST] " : ""}Security incident ${alert.id} (${alert.severity})`, text: lines.join("\n") }),
    });
    void response.body?.cancel().catch(() => {});
    return response.ok;
  } catch { return false; }
  finally { clearTimeout(timer); }
}

export type ActionResult = { kind: "created" } | { kind: "refused"; reason: string } | { kind: "unavailable" };

/** Owner-only (re-checked in the database). `actorSubject` is the owner's own network hash, which may not be blocked. */
export async function createAction(configuration: Configuration, staff: Staff,
  input: { kind: Action; incident: string; subject: string | null; hours: number; actorSubject: string }, options: Options = {}): Promise<ActionResult> {
  if (staff.role !== "owner" || !INCIDENT_ID.test(input.incident)) return { kind: "unavailable" };
  const result = await callRpc(configuration, "security_create_action", { p_staff: staff.userId, p_kind: input.kind,
    p_incident: input.incident, p_subject: input.subject, p_hours: input.hours, p_actor_subject: input.actorSubject,
    p_disabled: actionsDisabled(options.env) }, 1024, options.fetch);
  const answer = result as { result?: unknown; reason?: unknown } | undefined;
  if (answer?.result === "created") return { kind: "created" };
  if (answer?.result === "refused" && typeof answer.reason === "string" && /^[a-z_]{1,40}$/.test(answer.reason)) {
    return { kind: "refused", reason: answer.reason };
  }
  return { kind: "unavailable" };
}

export async function liftAction(configuration: Configuration, staff: Staff, actionId: number,
  options: Options = {}): Promise<"lifted" | "not_active" | "unavailable"> {
  if (staff.role !== "owner" || !Number.isSafeInteger(actionId) || actionId < 1) return "unavailable";
  const result = await callRpc(configuration, "security_lift_action", { p_staff: staff.userId, p_action: actionId }, 1024, options.fetch);
  const answer = (result as { result?: unknown } | undefined)?.result;
  return answer === "lifted" || answer === "not_active" ? answer : "unavailable";
}

export async function setIncidentStatus(configuration: Configuration, staff: Staff, incident: string, status: Status,
  options: Options = {}): Promise<"updated" | "not_found" | "conflict" | "unavailable"> {
  if (staff.role !== "owner" || !INCIDENT_ID.test(incident) || !isStatus(status)) return "unavailable";
  const result = await callRpc(configuration, "security_set_status", { p_staff: staff.userId, p_incident: incident, p_status: status }, 1024, options.fetch);
  const answer = (result as { result?: unknown } | undefined)?.result;
  return answer === "updated" || answer === "not_found" || answer === "conflict" ? answer : "unavailable";
}
