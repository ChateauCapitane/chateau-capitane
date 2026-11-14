"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { site } from "@/lib/data/site";

// OpenTable link without its query string, so the tracking parameters can change freely.
const booking = site.reservationUrl.split("?")[0];

/** Counts Book now and Call taps (ADR-0003). One delegated listener; it sends the target and the page
 * language only, and never changes or delays the link. Not mounted on staff pages.
 */
export function ClickTracker() {
  const onAdmin = usePathname().startsWith("/admin");
  useEffect(() => {
    if (onAdmin) return;
    const onClick = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      const href = link?.getAttribute("href") ?? "";
      const target = href.startsWith("tel:") ? "call" : href.split("?")[0] === booking ? "book" : null;
      if (!target) return;
      const lang = document.documentElement.lang === "ru" ? "ru" : "en";
      navigator.sendBeacon?.("/api/track", new Blob([JSON.stringify({ target, lang })], { type: "application/json" }));
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [onAdmin]);
  return null;
}
