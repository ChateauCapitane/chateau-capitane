import "server-only";
import { createHmac } from "node:crypto";
import { clientNetwork } from "../inquiries/abuse-limit";
import { callRpc, getPersistenceConfiguration, type Configuration } from "../inquiries/persistence";
import { requestLogger } from "../ops";

/** Matches the check constraint on inquiry_private.security_event_counts. */
export const EVENT_CODES = ["login_failed", "login_limited", "staff_denied", "webhook_bad_signature", "cron_bad_secret",
  "track_limited", "upload_refused", "blocked_request"] as const;
export type EventCode = (typeof EVENT_CODES)[number];
export type Surface = "login" | "track";
export type Gate = { kind: "clear" } | { kind: "blocked"; retryAfter: number } | { kind: "paused" };

/** What the track and sign-in code receives; tests pass a fake. */
export type Security = {
  gate: (request: Pick<Request, "headers">, surface: Surface, configuration: Configuration) => Promise<Gate>;
  event: (request: Pick<Request, "headers">, code: EventCode, configuration?: Configuration | null) => Promise<void>;
};

type Options = { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; now?: () => number };

/** At most this many writes per event code per minute per instance; the rest are dropped silently. 60 is above the
 * largest per-minute need of any detection rule (the highest threshold is 50, over 60 minutes),
 * so one full minute at the cap still fires every rule. Unauthenticated floods cannot write without bound.
 */
export const EVENT_WRITES_PER_MINUTE = 60;
// ponytail: per-instance cap, shared bucket if instances multiply
const writes = new Map<EventCode, { minute: number; count: number }>();
function underCap(code: EventCode, now: number) {
  const minute = Math.floor(now / 60000);
  const w = writes.get(code);
  if (!w || w.minute !== minute) { writes.set(code, { minute, count: 1 }); return true; }
  return ++w.count <= EVENT_WRITES_PER_MINUTE;
}

/** One key per client network for every security purpose (the limiters each hash a different string, so theirs
 * cannot be reused). "-" when the network is unknown: never blockable, never an IP, email or name.
 */
export function securitySubject(request: Pick<Request, "headers">, configuration: Configuration, env: NodeJS.ProcessEnv = process.env) {
  const network = clientNetwork(request, env);
  if (network === "unattributed") return "-";
  return createHmac("sha256", configuration.secretKey).update(`block:${network}`).digest("hex");
}

/** Emergency stop: every block and pause stops applying and new ones are refused (ADR-0004). */
export function actionsDisabled(env: NodeJS.ProcessEnv = process.env) {
  return /^(1|true)$/i.test(env.SECURITY_ACTIONS_DISABLED?.trim() ?? "");
}

/** Counts one security event. Best-effort: it never throws and never changes the reply; a failure logs
 * `security_event_failed` and nothing else (no network, no guest data).
 */
export async function recordSecurityEvent(request: Pick<Request, "headers">, code: EventCode,
  configuration?: Configuration | null, options: Options = {}): Promise<void> {
  try {
    const target = configuration === undefined ? getPersistenceConfiguration(options.env) : configuration;
    if (!target) return;
    if (!underCap(code, (options.now ?? Date.now)())) return;
    const stored = await callRpc(target, "record_security_event",
      { p_code: code, p_subject: securitySubject(request, target, options.env) }, 64, options.fetch);
    if (stored !== true) requestLogger("security", request)("security_event_failed");
  } catch {
    try { requestLogger("security", request)("security_event_failed"); } catch { /* logging must not throw either */ }
  }
}

/** A request that offered a bearer token that did not match counts as `cron_bad_secret` (cron, retention, security
 * cron, health and incident routes). No Authorization header at all is ordinary traffic (a browser, a crawler)
 * and is not counted. Any Authorization header causes one storage write, capped per instance (see above).
 */
export async function recordBadBearer(request: Pick<Request, "headers">, options: Options = {}): Promise<void> {
  if (request.headers.get("authorization")) await recordSecurityEvent(request, "cron_bad_secret", undefined, options);
}

/** Asks whether this network is blocked. Any failure is "clear": the rate limiters that run
 * next still fail closed, so an outage here never lets unlimited traffic in. A block also counts as an event.
 */
export async function gateRequest(request: Pick<Request, "headers">, surface: Surface, configuration: Configuration,
  options: Options = {}): Promise<Gate> {
  try {
    const result = await callRpc(configuration, "security_gate", {
      p_subject: securitySubject(request, configuration, options.env), p_surface: surface,
      p_disabled: actionsDisabled(options.env) }, 256, options.fetch);
    if (!result || typeof result !== "object") return { kind: "clear" };
    const { blocked, paused, retryAfter } = result as Record<string, unknown>;
    if (blocked === true) {
      await recordSecurityEvent(request, "blocked_request", configuration, options);
      const seconds = Number.isInteger(retryAfter) && (retryAfter as number) >= 1 && (retryAfter as number) <= 86400
        ? retryAfter as number : 3600;
      return { kind: "blocked", retryAfter: seconds };
    }
    if (paused === true) return { kind: "paused" };
  } catch { /* fall through to clear */ }
  return { kind: "clear" };
}

export const liveSecurity: Security = {
  gate: (request, surface, configuration) => gateRequest(request, surface, configuration),
  event: (request, code, configuration) => recordSecurityEvent(request, code, configuration),
};
