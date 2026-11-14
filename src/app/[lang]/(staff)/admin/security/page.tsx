import Link from "next/link";
import { notFound } from "next/navigation";
import { changeStatus, lift, takeAction } from "@/app/[lang]/(staff)/admin/security/actions";
import { PageHeader } from "@/components/ui/page-header";
import { linkClasses } from "@/components/ui/styles";
import { requireStaff } from "@/lib/server/auth/session";
import { getPersistenceConfiguration } from "@/lib/server/inquiries/persistence";
import { formatTime } from "@/lib/server/inquiries/staff-inbox";
import { readIncidentsAsOwner, STATUSES, type IncidentRecord } from "@/lib/server/security/incidents";
import { actionsDisabled } from "@/lib/server/security/record";
import { RULES, type RuleName } from "@/lib/server/security/rules";

const headingClasses = "font-serif text-3xl text-ivory";
const smallButton = "min-h-11 border border-gold/60 px-4 text-sm text-ivory hover:border-gold hover:text-gold-bright focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";
const field = "min-h-11 border border-ivory/30 bg-transparent px-3 text-sm text-ivory";

const notices: Record<string, string> = {
  created: "Done. It stays in force until the time shown, or until you lift it.",
  lifted: "Lifted. It no longer applies.",
  not_active: "That action had already ended.",
  updated: "Status saved.",
  not_found: "That incident no longer exists.",
  conflict: "Another active incident already covers this rule and network, so this one cannot be reopened.",
  invalid: "That request was not valid. Nothing was changed.",
  unavailable: "That could not be done right now. Please try again shortly.",
  "refused-disabled": "The emergency stop is on, so new actions are refused.",
  "refused-bad_expiry": "Choose between 1 and 24 hours.",
  "refused-incident_not_active": "That incident is closed. Reopen it first.",
  "refused-unattributed": "This incident has no known network, so there is nothing to block.",
  "refused-invalid_subject": "This incident has no network that can be blocked.",
  "refused-not_incident_subject": "That network does not belong to this incident.",
  "refused-own_network": "That is your own network. Blocking it would lock you out.",
  "refused-too_many_blocks": "Twenty blocks are already active. Lift one first.",
  "refused-already_active": "The contact form is already paused.",
  "refused-rate_limited": "Twenty actions were taken in the last hour. Try again later.",
};

const label = (value: string) => value.replaceAll("_", " ");
const active = (a: IncidentRecord["actions"][number]) => a.outcome === "active";

function Incident({ incident }: { incident: IncidentRecord }) {
  const rule = RULES[incident.rule as RuleName];
  const live = incident.status === "open" || incident.status === "investigating" || incident.status === "contained";
  const blockable = live && (rule.actions as readonly string[]).includes("block_subject") && incident.subject !== "-";
  const pausable = live && (rule.actions as readonly string[]).includes("pause_contact");
  return (
    <li className="border-b border-ivory/15 py-6">
      <h3 className="font-serif text-2xl text-ivory">{incident.id}{incident.test ? " (test)" : ""}</h3>
      <p className="mt-1 text-sm text-ivory-muted">
        {label(incident.rule)} · {incident.severity} severity · {label(incident.status)} · {incident.environment}
      </p>
      <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
        <dt className="text-xs font-semibold uppercase tracking-caps text-ivory-muted">First and last seen</dt>
        <dd className="text-ivory">{formatTime(incident.first_seen)} to {formatTime(incident.last_seen)}</dd>
        <dt className="text-xs font-semibold uppercase tracking-caps text-ivory-muted">Counts</dt>
        <dd className="text-ivory">{Object.entries(incident.evidence.counts).map(([code, n]) => `${label(code)}: ${n}`).join(", ") || "none"}
          {" "}(last {incident.evidence.window_minutes} minutes at its peak)</dd>
        <dt className="text-xs font-semibold uppercase tracking-caps text-ivory-muted">Network</dt>
        <dd className="text-ivory">{incident.subject === "-" ? "Not tied to one network" : `Network ${incident.subject.slice(0, 8)}`}</dd>
        <dt className="text-xs font-semibold uppercase tracking-caps text-ivory-muted">What it may be</dt>
        <dd className="text-ivory">{incident.technique}. {incident.uncertainty}</dd>
        <dt className="text-xs font-semibold uppercase tracking-caps text-ivory-muted">What to check</dt>
        <dd className="text-ivory">{incident.investigation.join("; ")}</dd>
      </dl>

      {incident.actions.length ? (
        <ul className="mt-4 grid gap-2 text-sm">
          {incident.actions.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 text-ivory">
              <span>{label(a.kind)} until {formatTime(a.expires_at)} ({a.outcome})</span>
              {active(a) ? (
                <form action={lift}>
                  <input type="hidden" name="action" value={a.id} />
                  <button type="submit" className={smallButton} aria-label={`Lift ${label(a.kind)} on ${incident.id}`}>Lift</button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-4">
        {blockable ? (
          <form action={takeAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="kind" value="block_subject" />
            <input type="hidden" name="incident" value={incident.id} />
            <input type="hidden" name="subject" value={incident.subject} />
            <label className="grid gap-1 text-xs text-ivory-muted">Hours (1 to 24)
              <input type="number" name="hours" min={1} max={24} defaultValue={1} className={`${field} w-24`} />
            </label>
            <button type="submit" className={smallButton}>Block this network</button>
          </form>
        ) : null}
        {pausable ? (
          <form action={takeAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="kind" value="pause_contact" />
            <input type="hidden" name="incident" value={incident.id} />
            <label className="grid gap-1 text-xs text-ivory-muted">Hours (1 to 24)
              <input type="number" name="hours" min={1} max={24} defaultValue={1} className={`${field} w-24`} />
            </label>
            <button type="submit" className={smallButton}>Pause the contact form</button>
          </form>
        ) : null}
        <form action={changeStatus} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="incident" value={incident.id} />
          <label className="grid gap-1 text-xs text-ivory-muted">Status
            <select name="status" defaultValue={incident.status} className={field}>
              {STATUSES.map((status) => <option key={status} value={status} className="bg-black">{label(status)}</option>)}
            </select>
          </label>
          <button type="submit" className={smallButton}>Save status</button>
        </form>
      </div>
    </li>
  );
}

export default async function SecurityPage({ searchParams }: PageProps<"/[lang]/admin/security">) {
  const staff = await requireStaff("/admin/security");
  // Only the owner acts on incidents; everyone else sees a normal "not found".
  if (staff.role !== "owner") notFound();
  const { notice } = await searchParams;
  const configuration = getPersistenceConfiguration();
  const incidents = configuration ? await readIncidentsAsOwner(configuration, staff, 50) : undefined;
  const message = typeof notice === "string" ? notices[notice] : undefined;
  const back = <p className="mt-6 text-sm"><Link href="/admin" className={linkClasses}>Back to dashboard</Link></p>;
  return (
    <>
      <PageHeader eyebrow="Staff" title="Security"
        intro="Signs of attacks on the website, grouped by what they look like. You can block one network or pause the contact form for a short time; both end by themselves." />
      {back}
      <p role="status" className="mt-6 min-h-6 text-sm text-gold-bright">{message}</p>
      {actionsDisabled() ? (
        <p role="alert" className="mt-2 max-w-3xl text-sm text-ivory">
          The emergency stop is on: no block or pause applies right now, and new ones are refused.
        </p>
      ) : null}
      <section aria-labelledby="incidents" className="mt-6 max-w-4xl">
        <h2 id="incidents" className={headingClasses}>Incidents</h2>
        {!incidents ? (
          <p role="alert" className="mt-4 text-ivory-muted">Incidents are unavailable right now. Please try again shortly.</p>
        ) : incidents.length === 0 ? (
          <p className="mt-4 text-ivory-muted">No incidents recorded.</p>
        ) : (
          <ol className="mt-4 border-t border-ivory/15">
            {incidents.map((incident) => <Incident key={incident.id} incident={incident} />)}
          </ol>
        )}
      </section>
    </>
  );
}
