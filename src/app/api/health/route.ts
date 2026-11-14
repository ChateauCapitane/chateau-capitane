import { getPersistenceConfiguration } from "@/lib/server/inquiries/persistence";
import { hasHealthToken, readiness } from "@/lib/server/ops";
import { recordBadBearer } from "@/lib/server/security/record";

const headers = { "Cache-Control": "no-store" };

/** Public: "the site is up", no storage touched unless an Authorization header is sent (then one capped security-event write). With `Authorization: Bearer $HEALTH_TOKEN`:
 * readiness (queue age, failed jobs, delivery problems, open high security incidents, stale detection); 503 unless
 * everything is fine, so any uptime monitor that checks the status code can alert. The cron secret does not unlock
 * this. A wrong bearer is counted as a security event (writes capped per instance); a request with no Authorization header is not. */
export async function GET(request: Request) {
  if (!hasHealthToken(request)) {
    await recordBadBearer(request);
    return Response.json({ ok: true }, { headers });
  }
  const result = await readiness(getPersistenceConfiguration());
  return Response.json(result, { status: result.status === "ok" ? 200 : 503, headers });
}
