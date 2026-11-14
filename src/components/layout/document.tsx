import type { Metadata, Viewport } from "next";
import { Albert_Sans, Bodoni_Moda } from "next/font/google";
import type { ReactNode } from "react";

import { Footer } from "@/components/layout/footer";
import { Header } from "@/components/layout/header";
import { site } from "@/lib/data/site";
import { getDictionary } from "@/lib/i18n/dictionary";
import { getLocale } from "@/lib/i18n/get-locale";
import { locales } from "@/lib/i18n/locales";
import "@/app/globals.css";

const albertSans = Albert_Sans({
  variable: "--font-albert-sans",
  subsets: ["latin"],
  display: "swap",
});

// The optical-size axis thickens Bodoni's hairlines at small sizes, so one
// family holds up from menu item names to the hero.
const bodoniModa = Bodoni_Moda({
  variable: "--font-bodoni-moda",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
  display: "swap",
});

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = getDictionary(await getLocale());
  return {
    metadataBase: new URL(site.url),
    title: {
      default: t.meta.defaultTitle(site.name),
      template: `%s | ${site.name}`,
    },
    description: t.meta.siteDescription,
  };
}

export const viewport: Viewport = {
  themeColor: "#0d0d0d",
  colorScheme: "dark",
};

/**
 * The page shell shared by the two root layouts (ADR-0005): the public one passes the third-party and
 * tracking scripts as `scripts`; the staff one passes none. Two root layouts make every move between
 * /admin and a public page a full page load, so a script can never outlive that move.
 */
export async function Document({ children, scripts }: { children: ReactNode; scripts?: ReactNode }) {
  const locale = await getLocale();
  const t = getDictionary(locale);
  return (
    <html
      lang={locale}
      className={`${albertSans.variable} ${bodoniModa.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col font-sans">
        <a
          href="#main"
          className="sr-only bg-gold px-4 py-3 text-sm font-semibold text-ink-950 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
        >
          {t.skipToContent}
        </a>
        <Header />
        <main id="main" className="flex-1">
          {children}
        </main>
        <Footer />
        {scripts}
      </body>
    </html>
  );
}
