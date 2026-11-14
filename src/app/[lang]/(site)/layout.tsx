import { ClickTracker } from "@/components/layout/click-tracker";
import { Document } from "@/components/layout/document";
import { InkindPopup } from "@/components/layout/inkind-popup";

export { generateMetadata, generateStaticParams, viewport } from "@/components/layout/document";

/** Root layout of the public pages: the only one that loads inKind and the click counter (ADR-0005). */
export default function SiteLayout({ children }: LayoutProps<"/[lang]">) {
  return (
    <Document
      scripts={
        <>
          <InkindPopup />
          <ClickTracker />
        </>
      }
    >
      {children}
    </Document>
  );
}
