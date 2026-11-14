import { requestLogger } from "@/lib/server/ops";
import { getPersistenceConfiguration } from "@/lib/server/inquiries/persistence";
import { liveSecurity } from "@/lib/server/security/record";
import { checkTrackLimit, handleTrack, recordClick } from "@/lib/server/track";

/** Counts Book now and Call taps (ADR-0003). Settings are read per request. */
export async function POST(request: Request) {
  return handleTrack(request, {
    configuration: getPersistenceConfiguration,
    limit: checkTrackLimit,
    record: recordClick,
    logError: requestLogger("track", request),
    security: liveSecurity,
  });
}
