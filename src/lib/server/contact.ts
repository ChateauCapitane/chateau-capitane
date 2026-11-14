import type { BanquetTier } from "@/lib/data/private-events";
import { parseContactInput } from "./inquiries/contact-input";
import type { checkContactLimit } from "./inquiries/abuse-limit";
import type { Configuration, recordContactInquiry } from "./inquiries/persistence";
import type { Security } from "./security/record";

type ContactConfiguration = { persistence: Configuration | null; from?: string; to: string };

export type ContactDependencies = {
  getConfiguration: () => ContactConfiguration;
  limit: typeof checkContactLimit;
  record: typeof recordContactInquiry;
  logError: (code: string) => void;
  /** Packages guests can ask about; defaults to the built-in list. */
  packages?: () => Promise<readonly BanquetTier[]>;
  /** Security monitoring (ADR-0004): blocks, the contact pause and event counts. Optional so tests stay small. */
  security?: Security;
};

function reply(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

/** Records an inquiry and its notification job; 202 means stored for staff follow-up, never a booking.
 * Email is sent later by the notification worker (src/app/api/cron/notifications).
 */
export async function handleContact(request: Request, dependencies: ContactDependencies): Promise<Response> {
  let input: Awaited<ReturnType<typeof parseContactInput>>;
  try { input = await parseContactInput(request, dependencies.packages); }
  catch {
    // Only the package list can fail here (published content unreadable).
    dependencies.logError("contact_content_unavailable");
    return reply(503, { error: "The message could not be confirmed. Please try again or call us." });
  }
  if (input.kind === "invalid") return reply(input.status, { error: input.error });
  // Same reply as a recorded inquiry so bots cannot tell they were discarded.
  if (input.kind === "discard") {
    await dependencies.security?.event(request, "contact_honeypot");
    return reply(202, { ok: true });
  }
  const configuration = dependencies.getConfiguration();
  const from = configuration.from?.trim();
  const to = configuration.to.trim();
  if (!configuration.persistence || !from || !to) {
    dependencies.logError("contact_not_configured");
    return reply(503, { error: "The form is unavailable right now." });
  }
  // An owner-approved block or pause (ADR-0004) answers before the limiter counts anything.
  const gate = await dependencies.security?.gate(request, "contact", configuration.persistence);
  if (gate?.kind === "blocked") {
    return reply(429, { error: "Too many messages right now. Please try again later or call us." },
      { "Retry-After": String(gate.retryAfter) });
  }
  if (gate?.kind === "paused") {
    return reply(503, { error: "The form is paused for a while. Please call us instead." });
  }
  // After the cheap local checks above; before any storage write.
  const limit = await dependencies.limit(request, input.submissionKey, configuration.persistence);
  if (limit.kind === "limited") {
    dependencies.logError("contact_rate_limited");
    await dependencies.security?.event(request, "contact_limited", configuration.persistence);
    return reply(429, { error: "Too many messages right now. Please try again later or call us." },
      { "Retry-After": String(limit.retryAfter) });
  }
  if (limit.kind === "unavailable") {
    // Fail closed: never accept unlimited intake while the shared limiter is unreachable.
    dependencies.logError("contact_limiter_unavailable");
    return reply(503, { error: "The message could not be confirmed. Please try again or call us." });
  }
  const result = await dependencies.record(input.inquiry, input.submissionKey, { from, to },
    { configuration: configuration.persistence });
  if (result.kind === "recorded") return reply(202, { ok: true });
  if (result.kind === "conflict") {
    dependencies.logError("contact_key_conflict");
    return reply(409, { error: "This submission changed. Please send it again." });
  }
  // May follow a commit; an unchanged retry with the same key is deduplicated.
  dependencies.logError("contact_storage_unavailable");
  return reply(503, { error: "The message could not be confirmed. Please try again or call us." });
}
