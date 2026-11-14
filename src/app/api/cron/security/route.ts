import { getPersistenceConfiguration } from "@/lib/server/inquiries/persistence";
import { hasCronSecret, requestLogger } from "@/lib/server/ops";
import { alertConfiguration, runDetection, sendAlert } from "@/lib/server/security/incidents";
import { recordBadBearer } from "@/lib/server/security/record";

export const maxDuration = 60;

function reply(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Vercel Cron every 5 minutes (vercel.json): applies the detection rules, writes the heartbeat and emails new
 * incidents (ADR-0004). `?synthetic=1` also creates the R0 test incident, to check the whole path end to end.
 */
export async function GET(request: Request) {
  if (!hasCronSecret(request)) {
    await recordBadBearer(request);
    return reply(401, { error: "Unauthorized" });
  }
  const configuration = getPersistenceConfiguration();
  if (!configuration) return reply(503, { error: "Not configured." });
  const log = requestLogger("security_cron", request);
  const settings = alertConfiguration();
  const result = await runDetection(configuration,
    { synthetic: new URL(request.url).searchParams.get("synthetic") === "1", claimAlerts: settings !== null });
  if (!result) {
    log("security_detection_failed");
    return reply(503, { error: "Detection could not run." });
  }
  let sent = 0;
  if (settings) {
    for (const alert of result.alerts) {
      if (await sendAlert(alert, settings)) sent += 1; else log("security_alert_failed");
    }
  }
  return reply(200, { ok: true, alerts: result.alerts.length, sent, alertsConfigured: settings !== null });
}
