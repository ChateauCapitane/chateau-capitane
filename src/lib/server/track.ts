import "server-only";
import { createHmac } from "node:crypto";
import { clientNetwork, parseLimitResult, type LimitResult } from "./inquiries/abuse-limit";
import { callRpc, readBounded, type Configuration } from "./inquiries/persistence";
import type { Security } from "./security/record";

export const TRACK_TARGETS = ["book", "call"] as const;
export const TRACK_LANGS = ["en", "ru"] as const;
export const TRACK_MAX_BYTES = 256;
/** Starting thresholds: a guest taps a handful of times a day. Per client network, plus one site-wide cap
 * in the same window (audit SEC-08) so rotating networks cannot inflate the counts. Fail closed. */
export const TRACK_LIMIT = Object.freeze({ limit: 30, seconds: 10 * 60, globalLimit: 600 });

export type TrackDependencies = {
  configuration: () => Configuration | null;
  limit: (request: Request, configuration: Configuration) => Promise<LimitResult>;
  record: (configuration: Configuration, target: string, lang: string) => Promise<boolean>;
  logError: (code: string) => void;
  /** Security monitoring (ADR-0004): blocks and event counts. Optional so tests stay small. */
  security?: Security;
};

/** Always 204, recorded or not, so the page learns nothing and a beacon never shows an error. */
const done = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

/** Counts one Book now or Call tap. Stores no IP, user agent, referrer or cookie; logs codes only. */
export async function handleTrack(request: Request, dependencies: TrackDependencies): Promise<Response> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return done();
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > TRACK_MAX_BYTES) return done();
  const bytes = await readBounded(request.body, TRACK_MAX_BYTES);
  if (!bytes) return done();
  let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return done(); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return done();
  const { target, lang, ...extra } = input as Record<string, unknown>;
  if (Object.keys(extra).length > 0 || !TRACK_TARGETS.includes(target as never) || !TRACK_LANGS.includes(lang as never)) return done();
  const configuration = dependencies.configuration();
  if (!configuration) { dependencies.logError("track_not_configured"); return done(); }
  // A blocked network is dropped quietly, like a limited one.
  if ((await dependencies.security?.gate(request, "track", configuration))?.kind === "blocked") return done();
  const limit = await dependencies.limit(request, configuration);
  if (limit.kind === "limited") {
    dependencies.logError("track_rate_limited");
    await dependencies.security?.event(request, "track_limited", configuration);
    return done();
  }
  // Fail closed: while the shared limiter is unreachable the tap is dropped, never counted unlimited.
  if (limit.kind === "unavailable") { dependencies.logError("track_limiter_unavailable"); return done(); }
  if (!(await dependencies.record(configuration, target as string, lang as string))) dependencies.logError("track_storage_unavailable");
  return done();
}

export async function checkTrackLimit(request: Request, configuration: Configuration,
  options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}): Promise<LimitResult> {
  const subject = createHmac("sha256", configuration.secretKey)
    .update(`track-limit:${clientNetwork(request, options.env)}`).digest("hex");
  const result = await callRpc(configuration, "check_track_limit",
    { p_subject: subject, p_limit: TRACK_LIMIT.limit, p_seconds: TRACK_LIMIT.seconds, p_global_limit: TRACK_LIMIT.globalLimit },
    256, options.fetch);
  return parseLimitResult(result);
}

/** record_click returns void: PostgREST answers 204, which callRpc reads as "no body", so call it directly. */
export async function recordClick(configuration: Configuration, target: string, lang: string,
  fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(`${configuration.url}/rest/v1/rpc/record_click`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: configuration.secretKey },
      body: JSON.stringify({ p_target: target, p_lang: lang }),
      cache: "no-store",
      signal: controller.signal,
    });
    void response.body?.cancel().catch(() => {});
    return response.ok;
  } catch { return false; }
  finally { clearTimeout(timeout); }
}
