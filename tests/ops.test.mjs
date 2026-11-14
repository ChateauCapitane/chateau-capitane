import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { test } from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

function load(path, imports) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const context = { exports: {}, console, JSON, Response, process: { env: {} },
    require: (name) => { assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`); return imports[name]; } };
  new Script(outputText).runInNewContext(context);
  return context.exports;
}
const persistence = { callRpc: async (_c, _name, _a, _m, fetchImpl) => fetchImpl() };
const ops = load("src/lib/server/ops.ts", { "server-only": {}, "node:crypto": { createHash, randomUUID, timingSafeEqual }, "./inquiries/persistence": persistence });
const healthy = { jobs: { accepted: 4 }, oldestDueJobSeconds: 0, deliveryProblems7d: 0, unmatchedDeliveryEvents: 0, inquiries24h: 1, loginHitsNow: 0 };
const secret = "s".repeat(20);
const request = (authorization) => ({ headers: new Headers(authorization ? { authorization } : {}) });

test("cron secret: exact bearer only, and a short or missing secret never matches", () => {
  assert.equal(ops.hasCronSecret(request(`Bearer ${secret}`), { CRON_SECRET: secret }), true);
  assert.equal(ops.hasCronSecret(request(`Bearer ${secret}x`), { CRON_SECRET: secret }), false);
  assert.equal(ops.hasCronSecret(request(), { CRON_SECRET: secret }), false);
  assert.equal(ops.hasCronSecret(request("Bearer short"), { CRON_SECRET: "short" }), false);
  assert.equal(ops.hasCronSecret(request("Bearer "), {}), false);
});

test("health token: exact bearer only, never the cron secret, short or unset never matches", () => {
  assert.equal(ops.hasHealthToken(request(`Bearer ${secret}`), { HEALTH_TOKEN: secret }), true);
  assert.equal(ops.hasHealthToken(request(`Bearer ${secret}`), { CRON_SECRET: secret }), false);
  assert.equal(ops.hasHealthToken(request(`Bearer ${secret}x`), { HEALTH_TOKEN: secret }), false);
  assert.equal(ops.hasHealthToken(request("Bearer short"), { HEALTH_TOKEN: "short" }), false);
  assert.equal(ops.hasHealthToken(request("Bearer "), {}), false);
  assert.equal(ops.hasCronSecret(request(`Bearer ${secret}`), { HEALTH_TOKEN: secret }), false);
});

test("problems: healthy is empty; stale queue, failed, uncertain, delivery and backlog are named", () => {
  assert.deepEqual([...ops.findProblems(healthy)], []);
  assert.deepEqual([...ops.findProblems({ ...healthy, oldestDueJobSeconds: 600 })], []);
  assert.deepEqual([...ops.findProblems({ ...healthy, oldestDueJobSeconds: 601, jobs: { failed: 1, uncertain: 2 },
    deliveryProblems7d: 1, unmatchedDeliveryEvents: 5001 })],
  ["notification_queue_stale", "notification_jobs_failed", "notification_jobs_uncertain", "email_delivery_problems", "delivery_event_backlog"]);
});

test("readiness: down without storage or on a bad answer, attention on problems, ok otherwise", async () => {
  const down = await ops.readiness(null);
  assert.equal(down.status, "down");
  assert.deepEqual([...down.problems], ["storage_unreachable"]);
  const cfg = { url: "https://x.example", secretKey: "sb_secret_x" };
  assert.equal((await ops.readiness(cfg, async () => undefined)).status, "down");
  assert.equal((await ops.readiness(cfg, async () => ({ nope: 1 }))).status, "down");
  assert.equal((await ops.readiness(cfg, async () => healthy)).status, "ok");
  const stale = await ops.readiness(cfg, async () => ({ ...healthy, oldestDueJobSeconds: 9999 }));
  assert.equal(stale.status, "attention");
  assert.deepEqual([...stale.problems], ["notification_queue_stale"]);
});

test("readiness: production without ADMIN_HOST is staff_host_unset; set, blank-free or non-production is not", async () => {
  const cfg = { url: "https://x.example", secretKey: "sb_secret_x" };
  const run = (env) => ops.readiness(cfg, async () => healthy, env);
  const bad = await run({ VERCEL_ENV: "production" });
  assert.equal(bad.status, "attention");
  assert.deepEqual([...bad.problems], ["staff_host_unset"]);
  assert.deepEqual([...(await run({ VERCEL_ENV: "production", ADMIN_HOST: "   " })).problems], ["staff_host_unset"]);
  assert.deepEqual([...(await run({ VERCEL_ENV: "production", ADMIN_HOST: "admin.example.test" })).problems], []);
  assert.equal((await run({ VERCEL_ENV: "preview" })).status, "ok");
  assert.equal((await run({})).status, "ok");
});
