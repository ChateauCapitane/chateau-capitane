import Script from "next/script";

/** inKind rewards pop-up for guests. Mounted only by the public root layout; the staff root layout has no
 * such script, so no staff page can ever share a document with it (ADR-0005). */
export function InkindPopup() {
  return <Script src="https://inkindscript.com/inkind.js" strategy="afterInteractive" />;
}
