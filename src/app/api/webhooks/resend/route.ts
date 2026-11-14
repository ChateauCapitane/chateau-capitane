import { requestLogger } from "@/lib/server/ops";
import { getPersistenceConfiguration } from "@/lib/server/inquiries/persistence";
import { handleResendWebhook } from "@/lib/server/inquiries/delivery-webhook";
import { recordSecurityEvent } from "@/lib/server/security/record";

/** Resend delivery events, signed with the endpoint's `whsec_` secret (RESEND_WEBHOOK_SECRET). */
export async function POST(request: Request) {
  const { status, body } = await handleResendWebhook(request, {
    configuration: getPersistenceConfiguration(),
    secret: process.env.RESEND_WEBHOOK_SECRET?.trim(),
    logError: requestLogger("resend_webhook", request),
  });
  // 401 is only ever a failed signature check (nothing was parsed): count it for the forged-webhook rule.
  if (status === 401) await recordSecurityEvent(request, "webhook_bad_signature");
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
