import "server-only";

export type Configuration = Readonly<{ url: string; secretKey: string }>;
/** Server-only routes: staff, content, track, health and cron. */
export function getPersistenceConfiguration(env: NodeJS.ProcessEnv = process.env): Configuration | null {
  const secretKey = env.SUPABASE_SECRET_KEY?.trim();
  if (!env.SUPABASE_URL || !secretKey?.startsWith("sb_secret_")) return null;
  try {
    const url = new URL(env.SUPABASE_URL);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
        url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return { url: url.origin, secretKey };
  } catch { return null; }
}

/** One no-store PostgREST RPC POST with a bounded body and ten-second timeout.
 * Returns the parsed JSON, or undefined on any failure. Never retries or logs bodies.
 */
export async function callRpc(
  configuration: Configuration, name: string, args: unknown, maxBytes: number, fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(`${configuration.url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: configuration.secretKey },
      body: JSON.stringify(args),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      return undefined;
    }
    // Bound reads even if a proxy returns an unexpected body.
    const bytes = await readBounded(response.body, maxBytes);
    if (!bytes) return undefined;
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch { return undefined; }
  finally { clearTimeout(timeout); }
}

/** Reads a body up to maxBytes; null when missing or larger (stops reading at the limit). */
export async function readBounded(body: ReadableStream<Uint8Array> | null, maxBytes: number): Promise<Uint8Array | null> {
  const reader = body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { void reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}
