import { getPersistenceConfiguration } from "@/lib/server/inquiries/persistence";
import { hasMonitorToken } from "@/lib/server/ops";
import { INCIDENT_ID, readIncidents } from "@/lib/server/security/incidents";
import { recordBadBearer } from "@/lib/server/security/record";

const headers = { "Cache-Control": "no-store" };

/** One incident as schema v1 JSON; same bearer rules as the list. */
export async function GET(request: Request, { params }: RouteContext<"/api/security/incidents/[id]">) {
  if (!hasMonitorToken(request)) {
    await recordBadBearer(request);
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  const { id } = await params;
  if (!INCIDENT_ID.test(id)) return Response.json({ error: "Not found" }, { status: 404, headers });
  const configuration = getPersistenceConfiguration();
  const incidents = configuration ? await readIncidents(configuration, { id }) : undefined;
  if (!incidents) return Response.json({ error: "Incidents are unavailable." }, { status: 503, headers });
  if (incidents.length === 0) return Response.json({ error: "Not found" }, { status: 404, headers });
  return Response.json(incidents[0], { headers });
}
