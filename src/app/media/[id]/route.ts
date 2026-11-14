import { getPersistenceConfiguration } from "@/lib/server/inquiries/persistence";
import { isMediaId, readMedia } from "@/lib/server/content/media";

/** A gallery photo, only while the live version of the gallery lists it. */
export async function GET(_request: Request, { params }: RouteContext<"/media/[id]">) {
  const { id } = await params;
  const configuration = getPersistenceConfiguration();
  // A minute of shared (CDN) caching for misses, so a flood of made-up ids does not each reach the database.
  const miss = () => new Response(null, { status: 404, headers: { "Cache-Control": "public, s-maxage=60" } });
  if (!isMediaId(id) || !configuration) return miss();
  const photo = await readMedia(configuration, id);
  if (photo === undefined) return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (photo === null) return miss();
  return new Response(new Uint8Array(photo.data), {
    // An hour, in the browser and in the CDN (the image optimizer matches it in next.config.ts): a photo taken
    // off the gallery stops being served within about two.
    headers: { "Content-Type": photo.type, "Cache-Control": "public, max-age=3600, s-maxage=3600", "X-Content-Type-Options": "nosniff" },
  });
}
