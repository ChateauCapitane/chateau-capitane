import assert from "node:assert/strict";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

// Regression tests for the predeployment audit (ADR-0005). Synthetic data only.
function load(path, imports = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const context = { exports: {}, URL, Response, Request, Headers, console, ...globals,
    require: (name) => { assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`); return imports[name]; } };
  new Script(outputText, { filename: path }).runInNewContext(context);
  return context.exports;
}
const token = "t".repeat(20);
const bearer = (value) => ({ headers: { authorization: `Bearer ${value}` } });

// --- /api/health: HEALTH_TOKEN unlocks readiness, CRON_SECRET does not ---
function health(env) {
  const process = { env };
  const ops = load("src/lib/server/ops.ts", { "server-only": {}, "node:crypto": { createHash, randomUUID, timingSafeEqual },
    "./inquiries/persistence": { callRpc: async () => undefined } }, { process });
  return load("src/app/api/health/route.ts", {
    "@/lib/server/inquiries/persistence": { getPersistenceConfiguration: () => null }, "@/lib/server/ops": ops,
    "@/lib/server/security/record": { recordBadBearer: async () => {} } });
}
test("health: the health token opens readiness, the cron secret and no token only say the site is up", async () => {
  const route = health({ HEALTH_TOKEN: token, CRON_SECRET: "c".repeat(20) });
  const ready = await route.GET(new Request("http://x.test/api/health", bearer(token)));
  assert.equal(ready.status, 503); // no storage in this test: readiness answers "down"
  assert.equal((await ready.json()).status, "down");
  for (const request of [new Request("http://x.test/api/health", bearer("c".repeat(20))), new Request("http://x.test/api/health")]) {
    const response = await route.GET(request);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  }
  // Unset HEALTH_TOKEN: readiness is refused even for the cron secret.
  const unset = await health({ CRON_SECRET: "c".repeat(20) }).GET(new Request("http://x.test/api/health", bearer("c".repeat(20))));
  assert.deepEqual(await unset.json(), { ok: true });
});

// --- admin/refresh: only same-origin (or no header) may renew or end a session ---
function refresh(adminHost) {
  const calls = [];
  const route = load("src/app/[lang]/(staff)/admin/refresh/route.ts", {
    "next/navigation": { redirect: (to) => { throw Object.assign(new Error("redirect"), { to }); },
      notFound: () => { throw Object.assign(new Error("notFound"), { to: "notFound" }); } },
    "@/lib/server/auth/session": {
      clearSession: async () => calls.push("clear"), endSession: async () => calls.push("end"),
      readTokens: async () => { calls.push("read"); return { refreshToken: undefined }; }, saveSession: async () => calls.push("save") },
    "@/lib/server/auth/staff-auth": { refreshSession: async () => ({ kind: "unavailable" }), safeAdminPath: () => "/admin",
      isStaffHost: (host) => !adminHost || host === adminHost },
    "@/lib/server/inquiries/persistence": { getPersistenceConfiguration: () => ({}) },
  });
  const run = async (query, site, host = "x.test") => {
    calls.length = 0;
    const headers = { ...(site ? { "sec-fetch-site": site } : {}), host };
    try { await route.GET(new Request(`http://${host}/admin/refresh${query}`, { headers })); } catch (error) { return { to: error.to, calls: [...calls] }; }
    throw new Error("expected a redirect");
  };
  return run;
}
test("refresh: a cross-site or same-site request changes nothing; same-origin, none and absent still work", async () => {
  const run = refresh();
  for (const site of ["cross-site", "same-site"]) {
    for (const query of ["?end=1", "?next=/admin"]) {
      assert.deepEqual(await run(query, site), { to: "/admin/login", calls: [] }, `${site} ${query}`);
    }
  }
  for (const site of ["same-origin", "none", undefined]) {
    assert.deepEqual(await run("?end=1", site), { to: "/admin/login?reason=signed-out", calls: ["end"] }, String(site));
    assert.deepEqual((await run("", site)).calls, ["read"], String(site)); // reaches the renewal path
  }
});

// --- proxy: ADMIN_HOST routing ---
function proxy(env) {
  class FakeResponse {
    constructor(_body, init) { this.kind = "plain"; this.status = init?.status; }
    static next() { return { kind: "next" }; }
    static rewrite(url) { return { kind: "rewrite", to: url.pathname }; }
    static redirect(url, status) { return { kind: "redirect", to: String(url), status }; }
  }
  const { proxy: run } = load("src/proxy.ts", {
    "next/server": { NextResponse: FakeResponse }, "@/lib/data/site": { site: { url: "https://www.example.test" } },
  }, { process: { env } });
  return (host, path) => {
    const nextUrl = new URL(`http://${host}${path}`);
    return run({ nextUrl: { clone: () => new URL(nextUrl.href) }, headers: new Headers({ host }) });
  };
}
test("proxy with ADMIN_HOST: staff pages only on the staff host, public pages only elsewhere", () => {
  const go = proxy({ ADMIN_HOST: "Admin.Example.Test" });
  assert.deepEqual(go("admin.example.test", "/admin/content"), { kind: "rewrite", to: "/en/admin/content" });
  assert.equal(go("www.example.test", "/admin").status, 404);
  assert.equal(go("www.example.test", "/admin/login").status, 404);
  assert.deepEqual(go("www.example.test", "/menu"), { kind: "rewrite", to: "/en/menu" });
  assert.deepEqual(go("www.example.test", "/ru/menu"), { kind: "next" });
  // The redirect target comes from site.url, never from the Host header.
  assert.deepEqual(go("admin.example.test", "/menu?x=1"), { kind: "redirect", to: "https://www.example.test/menu?x=1", status: 307 });
  assert.deepEqual(go("admin.example.test", "/"), { kind: "redirect", to: "https://www.example.test/", status: 307 });
});
test("proxy: a protocol-relative or backslash path on the staff host cannot redirect off site.url", () => {
  const go = proxy({ ADMIN_HOST: "admin.example.test" });
  for (const path of ["//evil.test/x", "/\\evil.test/x"]) {
    const r = go("admin.example.test", path);
    assert.equal(r.kind, "redirect", path);
    assert.equal(new URL(r.to).origin, "https://www.example.test", path);
  }
});
test("isStaffHost: unset or blank allows any host; set compares case-insensitively", () => {
  const { isStaffHost } = load("src/lib/server/auth/staff-auth.ts", { "server-only": {}, "node:crypto": { createHmac: () => ({}) },
    "../inquiries/abuse-limit": {}, "../inquiries/persistence": {} });
  assert.equal(isStaffHost("anything", {}), true);
  assert.equal(isStaffHost("anything", { ADMIN_HOST: "  " }), true);
  assert.equal(isStaffHost("admin.example.test", { ADMIN_HOST: "admin.example.test" }), true);
  assert.equal(isStaffHost("ADMIN.Example.test", { ADMIN_HOST: " Admin.Example.Test " }), true);
  assert.equal(isStaffHost("www.example.test", { ADMIN_HOST: "admin.example.test" }), false);
  assert.equal(isStaffHost(null, { ADMIN_HOST: "admin.example.test" }), false);
});
test("proxy with ADMIN_HOST: /ru/admin and /en/admin are staff paths too", () => {
  const go = proxy({ ADMIN_HOST: "admin.example.test" });
  for (const path of ["/ru/admin/login", "/en/admin", "/en/admin/content", "/ru/admin"]) {
    assert.equal(go("www.example.test", path).status, 404, path);
  }
  assert.deepEqual(go("admin.example.test", "/ru/admin/login"), { kind: "next" });
  assert.deepEqual(go("www.example.test", "/ru/administrator"), { kind: "next" });
});
test("refresh GET off the staff host: notFound, no session touched", async () => {
  const run = refresh("admin.example.test");
  assert.deepEqual(await run("?end=1", "same-origin", "www.example.test"), { to: "notFound", calls: [] });
  assert.deepEqual(await run("?end=1", "same-origin", "admin.example.test"), { to: "/admin/login?reason=signed-out", calls: ["end"] });
});
test("proxy without ADMIN_HOST: one host serves both, as before", () => {
  for (const env of [{}, { ADMIN_HOST: "  " }]) {
    const go = proxy(env);
    assert.deepEqual(go("localhost:3000", "/admin"), { kind: "rewrite", to: "/en/admin" });
    assert.deepEqual(go("localhost:3000", "/menu"), { kind: "rewrite", to: "/en/menu" });
    assert.deepEqual(go("localhost:3000", "/ru"), { kind: "next" });
  }
});

// --- next.config headers ---
test("headers: hardening on every route, a script CSP and no-store on /admin, eval only in development", async () => {
  const headersFor = async (NODE_ENV) => (await load("next.config.ts", {}, { process: { env: { NODE_ENV } } }).default.headers());
  const production = await headersFor("production");
  const all = production.find((rule) => rule.source === "/:path*").headers;
  const value = (rules, key) => rules.find((header) => header.key === key)?.value;
  assert.equal(value(all, "X-Content-Type-Options"), "nosniff");
  assert.equal(value(all, "Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(value(all, "Permissions-Policy"), "camera=(), microphone=(), geolocation=(), payment=()");
  assert.equal(value(all, "X-Frame-Options"), "DENY");
  assert.equal(value(all, "Content-Security-Policy"), "frame-ancestors 'none'");
  assert.equal(value(all, "Strict-Transport-Security"), "max-age=86400");
  const admin = production.find((rule) => rule.source === "/admin/:path*").headers;
  assert.equal(value(admin, "Content-Security-Policy"),
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "connect-src 'self'; frame-src 'none'; form-action 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'");
  assert.equal(value(admin, "Cache-Control"), "private, no-store");
  const development = await headersFor("development");
  const devCsp = value(development.find((rule) => rule.source === "/admin/:path*").headers, "Content-Security-Policy");
  assert.match(devCsp, /script-src 'self' 'unsafe-inline' 'unsafe-eval';/);
});
