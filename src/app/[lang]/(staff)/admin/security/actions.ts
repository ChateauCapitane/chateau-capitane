"use server";

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/server/auth/session";
import { getPersistenceConfiguration } from "@/lib/server/inquiries/persistence";
import { createAction, INCIDENT_ID, isStatus, liftAction, setIncidentStatus } from "@/lib/server/security/incidents";
import { securitySubject } from "@/lib/server/security/record";

// Server Functions are public POST endpoints: each one re-checks that the signed-in person is the owner (the staff
// role gets a 404, and the database checks again) and validates every field. Results come back as ?notice=.
async function owner() {
  const staff = await requireStaff("/admin/security");
  if (staff.role !== "owner") notFound();
  return staff;
}
function back(notice: string): never {
  redirect(`/admin/security?notice=${notice}`);
}
const text = (form: FormData, name: string, max: number) => {
  const value = form.get(name);
  return typeof value === "string" && value.length <= max ? value : "";
};

/** Blocks one network (from an incident's subject) or pauses the contact form, for 1 to 24 hours. */
export async function takeAction(form: FormData): Promise<void> {
  const staff = await owner();
  const kind = text(form, "kind", 20), incident = text(form, "incident", 32);
  const hours = Number(text(form, "hours", 3));
  if ((kind !== "block_subject" && kind !== "pause_contact") || !INCIDENT_ID.test(incident) ||
      !Number.isInteger(hours) || hours < 1 || hours > 24) back("invalid");
  const configuration = getPersistenceConfiguration();
  if (!configuration) back("unavailable");
  const result = await createAction(configuration, staff, {
    kind: kind as "block_subject" | "pause_contact", incident, hours,
    subject: kind === "block_subject" ? text(form, "subject", 64) : null,
    actorSubject: securitySubject({ headers: await headers() }, configuration),
  });
  back(result.kind === "created" ? "created" : result.kind === "refused" ? `refused-${result.reason}` : "unavailable");
}

export async function lift(form: FormData): Promise<void> {
  const staff = await owner();
  const id = Number(text(form, "action", 15));
  const configuration = getPersistenceConfiguration();
  if (!configuration) back("unavailable");
  back(await liftAction(configuration, staff, id));
}

export async function changeStatus(form: FormData): Promise<void> {
  const staff = await owner();
  const incident = text(form, "incident", 32), status = text(form, "status", 20);
  if (!INCIDENT_ID.test(incident) || !isStatus(status)) back("invalid");
  const configuration = getPersistenceConfiguration();
  if (!configuration) back("unavailable");
  back(await setIncidentStatus(configuration, staff, incident, status));
}
