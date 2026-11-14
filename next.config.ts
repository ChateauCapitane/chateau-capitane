import type { NextConfig } from "next";

/**
 * Permanent redirects from the previous WordPress site's URLs. These only take
 * effect if the existing domain is pointed at this site; they're harmless
 * otherwise. Banquet pages collapse into /private-events, anchored to their
 * tier where it still exists.
 */
const legacyRedirects = [
  { source: "/food-and-restaurant-menu", destination: "/menu" },
  { source: "/food-and-restaurant-lunch-specials", destination: "/menu#lunch-special" },
  { source: "/food-and-restaurant-about-us", destination: "/about" },
  { source: "/food-and-restaurant-contact-us", destination: "/contact" },
  { source: "/food-and-restaurant-gallery", destination: "/gallery" },
  { source: "/food-and-restaurant-testimonials", destination: "/testimonials" },
  { source: "/kids-banquet-75", destination: "/private-events#kids" },
  { source: "/memorial-banquet-90", destination: "/private-events#memorial" },
  { source: "/banquet-100", destination: "/private-events#sunday-brunch" },
  { source: "/food-and-restaurant-banquet-135", destination: "/private-events" },
  { source: "/banquet-140", destination: "/private-events#banquet-140" },
  { source: "/banquet-170", destination: "/private-events#banquet-170" },
  { source: "/banquet-185", destination: "/private-events#banquet-185" },
  { source: "/banquet-230", destination: "/private-events#banquet-230" },
  { source: "/sitemap", destination: "/" },
  { source: "/sitemap.html", destination: "/" },
];

/**
 * ADR-0005. Every route gets the basic hardening headers; /admin also gets a script CSP that blocks every
 * third-party script. 'unsafe-inline' stays because Next's hydration uses inline scripts. Only development
 * adds 'unsafe-eval' (React's dev build needs it). Public pages get no script CSP yet: inKind's requests
 * are not inventoried. HSTS is one day at first deploy; raised after the release checklist passes.
 */
function securityHeaders() {
  const adminCsp = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `connect-src 'self'`,
    `frame-src 'none'`,
    `form-action 'self'`,
    `base-uri 'none'`,
    `object-src 'none'`,
    `frame-ancestors 'none'`,
  ].join("; ");
  return [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "Strict-Transport-Security", value: "max-age=86400" },
      ],
    },
    {
      // Matched on the visible path, before the proxy rewrites /admin to /en/admin. It also matches /admin itself.
      source: "/admin/:path*",
      headers: [
        { key: "Content-Security-Policy", value: adminCsp },
        { key: "Cache-Control", value: "private, no-store" },
      ],
    },
  ];
}

const nextConfig: NextConfig = {
  // Gallery photo uploads; Vercel itself rejects request bodies over 4.5 MB.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  // Gallery photos are served with a one-hour cache; the image optimizer would otherwise keep a photo taken
  // off the gallery for four hours.
  images: { minimumCacheTTL: 3600 },
  async headers() {
    return securityHeaders();
  },
  async redirects() {
    return legacyRedirects.map((redirect) => ({ ...redirect, permanent: true }));
  },
};

export default nextConfig;
