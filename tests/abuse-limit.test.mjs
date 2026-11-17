import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import net from "node:net";
import { test } from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

function load(path, imports) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const context = { exports: {}, URL, TextDecoder, AbortController, Response, setTimeout, clearTimeout,
    require: (name) => { assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`); return imports[name]; } };
  new Script(outputText).runInNewContext(context);
  return context.exports;
}
const { clientNetwork, parseLimitResult } = load("src/lib/server/inquiries/abuse-limit.ts",
  { "server-only": {}, "node:net": net });
const vercel = { VERCEL: "1" };
const request = (headers = {}) => new Request("https://restaurant.test/api/track", { method: "POST", headers });

test("only Vercel's own header identifies the client; forged forwarding headers are ignored", () => {
  const forged = { "x-forwarded-for": "198.51.100.9", "x-real-ip": "198.51.100.9", "forwarded": "for=198.51.100.9" };
  assert.equal(clientNetwork(request({ ...forged, "x-vercel-forwarded-for": "203.0.113.7" }), vercel), "203.0.113.7");
  assert.equal(clientNetwork(request(forged), vercel), "unattributed");
  // Off Vercel nothing is trusted, even Vercel's header name.
  assert.equal(clientNetwork(request({ "x-vercel-forwarded-for": "203.0.113.7" }), {}), "unattributed");
  assert.equal(clientNetwork(request({ "x-vercel-forwarded-for": "not an ip" }), vercel), "unattributed");
});

test("IPv6 clients share one bucket per /64; mapped IPv4 is treated as IPv4", () => {
  const net6 = (ip) => clientNetwork(request({ "x-vercel-forwarded-for": ip }), vercel);
  assert.equal(net6("2001:db8:a:b:1:2:3:4"), "2001:0db8:000a:000b::/64");
  assert.equal(net6("2001:DB8:A:B::9"), "2001:0db8:000a:000b::/64");
  assert.equal(net6("2001:db8::1"), "2001:0db8:0000:0000::/64");
  assert.equal(net6("::ffff:203.0.113.7"), "203.0.113.7");
  assert.equal(net6("::ffff:cb00:7107"), "203.0.113.7");
  assert.equal(net6("0:0:0:0:0:FFFF:CB00:7107"), "203.0.113.7");
  assert.equal(net6("2001:db8:a:b::1.2.3.4"), "2001:0db8:000a:000b::/64");
});

test("limited replies carry retry guidance; anything unexpected fails closed", () => {
  assert.deepEqual({ ...parseLimitResult({ allowed: true }) }, { kind: "allowed" });
  assert.deepEqual({ ...parseLimitResult({ allowed: false, retryAfter: 42 }) }, { kind: "limited", retryAfter: 42 });
  for (const reply of [{ allowed: false }, { allowed: false, retryAfter: 0 }, { allowed: false, retryAfter: 86401 },
    { allowed: "yes" }, null, undefined, "x"]) {
    assert.deepEqual({ ...parseLimitResult(reply) }, { kind: "unavailable" });
  }
});
