import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { Document } from "@/components/layout/document";
import { isStaffHost } from "@/lib/server/auth/staff-auth";

export { generateMetadata, generateStaticParams, viewport } from "@/components/layout/document";

/** Root layout of the staff pages: no inKind, no click counter. A separate root layout from the public
 * pages, so moving between them is always a full page load and no public script reaches a staff page (ADR-0005). */
export default async function StaffLayout({ children }: LayoutProps<"/[lang]">) {
  if (!isStaffHost((await headers()).get("host"))) notFound();
  return <Document>{children}</Document>;
}
