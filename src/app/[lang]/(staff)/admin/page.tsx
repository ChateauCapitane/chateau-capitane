import { logout } from "@/app/[lang]/(staff)/admin/actions";
import { ctaClassName } from "@/components/ui/cta-class";
import { CtaLink } from "@/components/ui/cta-link";
import { PageHeader } from "@/components/ui/page-header";
import { requireStaff } from "@/lib/server/auth/session";
import { getMonthlySummary } from "@/lib/server/click-summary";
import { getPersistenceConfiguration } from "@/lib/server/inquiries/persistence";

export default async function AdminPage() {
  const staff = await requireStaff("/admin");
  const configuration = getPersistenceConfiguration();
  const months = configuration ? await getMonthlySummary(configuration, staff) : undefined;
  return (
    <>
      <PageHeader eyebrow="Staff" title="Dashboard"
        intro={`Signed in as ${staff.email || "staff member"} (${staff.role}).`} />
      <div className="mt-10 flex flex-wrap gap-4">
        <CtaLink href="/admin/inquiries">Open inquiries</CtaLink>
        <CtaLink href="/admin/content" variant="secondary">Website content</CtaLink>
        {staff.role === "owner" ? <CtaLink href="/admin/security" variant="secondary">Security</CtaLink> : null}
        <form action={logout}>
          <button type="submit" className={ctaClassName("secondary")}>Sign out</button>
        </form>
      </div>

      <h2 id="activity" className="mt-16 font-serif text-3xl text-ivory">Guest activity by month</h2>
      <p className="mt-3 max-w-2xl text-sm text-ivory-muted">
        Book now and Call are taps on the website buttons, counted by us. A tap is not a completed booking or call.
        Inquiries and private-event requests are the messages guests sent. Months use New York time.
      </p>
      {months ? (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-gold/30 text-ivory-muted">
                <th scope="col" className="py-2 pr-4 font-medium">Month</th>
                <th scope="col" className="py-2 pr-4 font-medium">Book now (EN / RU)</th>
                <th scope="col" className="py-2 pr-4 font-medium">Call (EN / RU)</th>
                <th scope="col" className="py-2 pr-4 font-medium">Inquiries</th>
                <th scope="col" className="py-2 font-medium">Banquet requests</th>
              </tr>
            </thead>
            <tbody>
              {months.map((row) => (
                <tr key={row.month} className="border-b border-gold/10">
                  <th scope="row" className="py-2 pr-4 font-medium">{row.month}</th>
                  <td className="py-2 pr-4">{row.bookEn} / {row.bookRu}</td>
                  <td className="py-2 pr-4">{row.callEn} / {row.callRu}</td>
                  <td className="py-2 pr-4">{row.inquiries}</td>
                  <td className="py-2">{row.events}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 text-sm">The monthly counts are unavailable right now.</p>
      )}
    </>
  );
}
