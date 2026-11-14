import "server-only";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { callRpc, type Configuration } from "./inquiries/persistence";

/** Constant-time bearer check; a missing or short (under 16 characters) secret never matches. */
function hasBearer(request: Request, secret: string | undefined) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return !!secret && secret.length >= 16 &&
    timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`));
}

/** Bearer `CRON_SECRET`: the cron workers only. */
export function hasCronSecret(request: Request, env: NodeJS.ProcessEnv = process.env) {
  return hasBearer(request, env.CRON_SECRET?.trim());
}

/** Bearer `HEALTH_TOKEN`: the uptime monitor's read-only readiness check (ADR-0005). Not the cron secret. */
export function hasHealthToken(request: Request, env: NodeJS.ProcessEnv = process.env) {
  return hasBearer(request, env.HEALTH_TOKEN?.trim());
}

/** One JSON line per problem, tied to the request. `code` must be a fixed word, never guest text. */
export function requestLogger(source: string, request: Pick<Request, "headers">) {
  const requestId = request.headers.get("x-vercel-id") ?? randomUUID();
  return (code: string) => console.error(JSON.stringify({ level: "error", source, code, requestId }));
}

/** Bearer `MONITOR_TOKEN`: read-only access to security incidents for the investigating agent (ADR-0004). Cannot act. */
export function hasMonitorToken(request: Request, env: NodeJS.ProcessEnv = process.env) {
  return hasBearer(request, env.MONITOR_TOKEN?.trim());
}

// Mail that should have gone out minutes ago but has not is the failure owners notice first.
export const STALE_QUEUE_SECONDS = 600;
// Detection runs every 5 minutes; three missed runs means monitoring itself is down.
export const STALE_DETECTION_SECONDS = 900;
/** `securityLastRunSeconds` is null when detection has never run; the keys are absent only on an older database. */
type Snapshot = { jobs: Record<string, number>; oldestDueJobSeconds: number; deliveryProblems7d: number;
  unmatchedDeliveryEvents: number; inquiries24h: number; loginHitsNow: number;
  securityHighOpen?: number; securityLastRunSeconds?: number | null };

/** Turns a database snapshot into plain problem codes; empty means healthy. */
export function findProblems(s: Snapshot): string[] {
  const problems: string[] = [];
  if (s.oldestDueJobSeconds > STALE_QUEUE_SECONDS) problems.push("notification_queue_stale");
  if ((s.jobs.failed ?? 0) > 0) problems.push("notification_jobs_failed");
  if ((s.jobs.uncertain ?? 0) > 0) problems.push("notification_jobs_uncertain");
  if (s.deliveryProblems7d > 0) problems.push("email_delivery_problems");
  if (s.unmatchedDeliveryEvents > 5000) problems.push("delivery_event_backlog");
  if ((s.securityHighOpen ?? 0) > 0) problems.push("security_incident_open");
  // No heartbeat is a telemetry failure, not "no attacks".
  if (s.securityLastRunSeconds === null || (s.securityLastRunSeconds ?? 0) > STALE_DETECTION_SECONDS) problems.push("security_detection_stale");
  return problems;
}

/** Readiness: reads the snapshot (counts only). `down` = storage unreachable. */
export async function readiness(configuration: Configuration | null, fetchImpl?: typeof fetch,
  env: NodeJS.ProcessEnv = process.env) {
  const raw = configuration ? await callRpc(configuration, "ops_snapshot", {}, 4096, fetchImpl) : undefined;
  if (!raw || typeof raw !== "object" || !("jobs" in raw)) return { status: "down" as const, problems: ["storage_unreachable"] };
  const snapshot = raw as Snapshot;
  const problems = findProblems(snapshot);
  // Without ADMIN_HOST the staff pages answer on the public host (ADR-0005), so production must name it.
  if (env.VERCEL_ENV === "production" && !env.ADMIN_HOST?.trim()) problems.push("staff_host_unset");
  return { status: problems.length ? "attention" as const : "ok" as const, problems, snapshot };
}
