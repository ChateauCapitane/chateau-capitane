import { getPersistenceConfiguration } from "@/lib/server/inquiries/persistence";
import { hasMonitorToken } from "@/lib/server/ops";
import { readIncidents } from "@/lib/server/security/incidents";
import { recordBadBearer } from "@/lib/server/security/record";

const headers = { "Cache-Control": "no-store" };

/** Read-only incident list (schema v1, docs/incident-response.md) for the investigating agent: bearer
 * `MONITOR_TOKEN` only. An unset token refuses everyone; the cron and health tokens do not work here.
 */
export async function GET(request: Request) {
  if (!hasMonitorToken(request)) {
    await recordBadBearer(request);
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  const configuration = getPersistenceConfiguration();
  const incidents = configuration ? await readIncidents(configuration) : undefined;
  if (!incidents) return Response.json({ error: "Incidents are unavailable." }, { status: 503, headers });
  return Response.json({ incidents }, { headers });
}
