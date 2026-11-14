import { NextResponse, type NextRequest } from "next/server";

import { site } from "@/lib/data/site";

/**
 * English is served at the site root and Russian under /ru, both from the app/[lang] folder:
 * "/menu" is rewritten to the internal "/en/menu", and a visible "/en/..." is sent back to the root
 * so each page has one English address.
 */
export function proxy(request: NextRequest) {
  const url = request.nextUrl.clone();
  const { pathname } = url;

  // ADR-0005: with ADMIN_HOST set, staff pages live only on that host and public pages only elsewhere, so a
  // script on the public site is cross-origin to the staff pages. The redirect target comes from site.url,
  // never from the Host header. Unset (local, tests) = one host serves both.
  const adminHost = process.env.ADMIN_HOST?.trim().toLowerCase();
  if (adminHost) {
    const onAdminHost = request.headers.get("host")?.toLowerCase() === adminHost;
    // /en/admin and /ru/admin too: /ru/* passes through below, and a Server Action would run before the layout check.
    const isAdminPath = /^(\/(en|ru))?\/admin(\/|$)/.test(pathname);
    if (isAdminPath && !onAdminHost) return new NextResponse(null, { status: 404 });
    if (!isAdminPath && onAdminHost) {
      // Set pathname and search on the origin; parsing "//evil.test/x" as a URL would leave the site.
      const target = new URL(site.url);
      target.pathname = pathname;
      target.search = url.search;
      return NextResponse.redirect(target, 307);
    }
  }

  if (pathname === "/ru" || pathname.startsWith("/ru/")) return NextResponse.next();

  if (pathname === "/en" || pathname.startsWith("/en/")) {
    url.pathname = pathname.slice(3) || "/";
    return NextResponse.redirect(url, 308);
  }

  url.pathname = pathname === "/" ? "/en" : `/en${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  // Everything except API routes, Next internals, public media, metadata files and anything with a file extension.
  matcher: ["/((?!api|_next|media|icon\\.svg|apple-icon|opengraph-image|robots\\.txt|sitemap\\.xml|.*\\..*).*)"],
};
