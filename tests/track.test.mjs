import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import { test } from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

function load(path, imports, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const context = { exports: {}, URL, TextDecoder, AbortController, Response, Request, setTimeout, clearTimeout, ...globals,
    require: (name) => { assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`); return imports[name]; } };
  new Script(outputText, { filename: path }).runInNewContext(context);
  return context.exports;
}
const persistence = load("src/lib/server/inquiries/persistence.ts", { "server-only": {} });
const abuse = load("src/lib/server/inquiries/abuse-limit.ts",
  { "server-only": {}, "node:crypto": crypto, "node:net": net, "./persistence": persistence });
const track = load("src/lib/server/track.ts", { "server-only": {}, "node:crypto": crypto,
  "./inquiries/abuse-limit": abuse, "./inquiries/persistence": persistence });
const configuration = { url: "https://example.supabase.co", secretKey: "sb_secret_test" };

function fixture(overrides = {}) {
  const state = { recorded: [], logs: [], limited: 0 };
  const dependencies = {
    configuration: () => configuration,
    limit: async () => { state.limited += 1; return { kind: "allowed" }; },
    record: async (_c, target, lang) => { state.recorded.push({ target, lang }); return true; },
    logError: (code) => state.logs.push(code),
    ...overrides,
  };
  return { state, send: (body, headers = {}) => track.handleTrack(new Request("https://restaurant.test/api/track", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body) }), dependencies) };
}

test("a valid tap is counted and answered 204", async () => {
  const { state, send } = fixture();
  for (const body of [{ target: "book", lang: "en" }, { target: "call", lang: "ru" }]) {
    const response = await send(body);
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.deepEqual(state.recorded, [{ target: "book", lang: "en" }, { target: "call", lang: "ru" }]);
});

test("anything else is answered 204 but never counted or sent to the limiter", async () => {
  const { state, send } = fixture();
  const bad = [{ target: "email", lang: "en" }, { target: "book", lang: "fr" }, { target: "book" }, { lang: "en" },
    { target: "book", lang: "en", ip: "203.0.113.7" }, [], null, "not json", "x".repeat(300),
    JSON.stringify({ target: "book", lang: "en", pad: "x".repeat(300) })];
  for (const body of bad) assert.equal((await send(body)).status, 204);
  assert.equal((await send({ target: "book", lang: "en" }, { "Content-Type": "text/plain" })).status, 204);
  assert.equal((await send({ target: "book", lang: "en" }, { "Content-Length": "9999" })).status, 204);
  assert.deepEqual(state.recorded, []);
  assert.equal(state.limited, 0);
});

test("a limited client or an unreachable limiter drops the tap (fail closed) and still answers 204", async () => {
  for (const [kind, code] of [["limited", "track_rate_limited"], ["unavailable", "track_limiter_unavailable"]]) {
    const { state, send } = fixture({ limit: async () => ({ kind, retryAfter: 30 }) });
    assert.equal((await send({ target: "call", lang: "en" })).status, 204);
    assert.deepEqual(state.recorded, []);
    assert.deepEqual(state.logs, [code]);
  }
  const missing = fixture({ configuration: () => null });
  assert.equal((await missing.send({ target: "call", lang: "en" })).status, 204);
  assert.deepEqual(missing.state.logs, ["track_not_configured"]);
});

test("a storage failure is logged as a code only", async () => {
  const { state, send } = fixture({ record: async () => false });
  assert.equal((await send({ target: "call", lang: "ru" })).status, 204);
  assert.deepEqual(state.logs, ["track_storage_unavailable"]);
});

test("the limiter hashes the network, uses its own bucket function and fails closed on a bad reply", async () => {
  const calls = [];
  const reply = (value) => async (url, init) => { calls.push({ url, args: JSON.parse(init.body) });
    return new Response(JSON.stringify(value), { status: 200 }); };
  const request = new Request("https://restaurant.test/api/track", { method: "POST", headers: { "x-vercel-forwarded-for": "203.0.113.7" } });
  const env = { VERCEL: "1" };
  assert.deepEqual(JSON.parse(JSON.stringify(await track.checkTrackLimit(request, configuration, { env, fetch: reply({ allowed: true }) }))), { kind: "allowed" });
  assert.match(calls[0].url, /\/rpc\/check_track_limit$/);
  assert.match(calls[0].args.p_subject, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(calls[0].args).includes("203.0.113.7"));
  assert.deepEqual(JSON.parse(JSON.stringify(await track.checkTrackLimit(request, configuration, { env, fetch: reply({ allowed: false, retryAfter: 9 }) }))), { kind: "limited", retryAfter: 9 });
  assert.deepEqual(JSON.parse(JSON.stringify(await track.checkTrackLimit(request, configuration, { env, fetch: reply("nonsense") }))), { kind: "unavailable" });
  assert.deepEqual(JSON.parse(JSON.stringify(await track.checkTrackLimit(request, configuration, { env, fetch: async () => { throw new Error("down"); } }))), { kind: "unavailable" });
});

test("recordClick sends only the target and language, and reports failure", async () => {
  const sent = [];
  const ok = async (url, init) => { sent.push({ url, init }); return new Response(null, { status: 204 }); };
  assert.equal(await track.recordClick(configuration, "book", "en", ok), true);
  assert.match(sent[0].url, /\/rpc\/record_click$/);
  assert.deepEqual(JSON.parse(sent[0].init.body), { p_target: "book", p_lang: "en" });
  assert.equal(await track.recordClick(configuration, "book", "en", async () => new Response(null, { status: 500 })), false);
  assert.equal(await track.recordClick(configuration, "book", "en", async () => { throw new Error("down"); }), false);
});

// The browser listener: which clicks it sends, and exactly what it sends.
function listener(pathname = "/", lang = "en") {
  const handlers = {};
  const beacons = [];
  const site = { reservationUrl: "https://www.opentable.com/r/test?restref=1&lang=en-US" };
  const globals = {
    Blob, Element: class {},
    document: { documentElement: { lang }, addEventListener: (_type, fn) => { handlers.click = fn; }, removeEventListener: () => {} },
    navigator: { sendBeacon: (url, blob) => { beacons.push({ url, blob }); return true; } },
  };
  const { ClickTracker } = load("src/components/layout/click-tracker.tsx", {
    react: { useEffect: (fn) => fn() }, "next/navigation": { usePathname: () => pathname },
    "@/lib/data/site": { site },
  }, globals);
  ClickTracker();
  const anchor = (href) => { const element = new globals.Element(); element.closest = () => ({ getAttribute: () => href }); return element; };
  return { click: (href) => handlers.click?.({ target: anchor(href) }), beacons };
}

test("the listener beacons Call and Book now taps with target and language only", async () => {
  const page = listener("/ru", "ru");
  page.click("tel:+17185551234");
  page.click("https://www.opentable.com/r/test?restref=2&ot_source=x");
  page.click("/menu");
  page.click("https://www.yelp.com/biz/x");
  assert.equal(page.beacons.length, 2);
  assert.equal(page.beacons[0].url, "/api/track");
  assert.equal(page.beacons[0].blob.type, "application/json");
  assert.deepEqual(JSON.parse(await page.beacons[0].blob.text()), { target: "call", lang: "ru" });
  assert.deepEqual(JSON.parse(await page.beacons[1].blob.text()), { target: "book", lang: "ru" });
});

test("the listener is not attached on staff pages", () => {
  const page = listener("/admin/content");
  page.click("tel:+17185551234");
  assert.equal(page.beacons.length, 0);
});
