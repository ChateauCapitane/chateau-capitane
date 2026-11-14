import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

// ADR-0004: security monitoring, incident records, owner-only actions. Synthetic data only (.invalid, test networks).
// Modules run in a vm realm, so arrays and objects they return are not reference-equal to ours: compare as JSON.
const plain = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const same = (actual, expected, message) => assert.deepStrictEqual(plain(actual), expected, message);
function load(path, imports = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const context = { exports: {}, URL, Response, Request, Headers, console, JSON, Date, TextDecoder, AbortController, setTimeout, clearTimeout, ...globals,
    require: (name) => { assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`); return imports[name]; } };
  new Script(outputText, { filename: path }).runInNewContext(context);
  return context.exports;
}
const migration = readFileSync("supabase/migrations/202611140001_security_monitoring.sql", "utf8");
const configuration = { url: "https://x.example", secretKey: "sb_secret_testkey" };
const NETWORK = "203.0.113.9";
const HASH = createHmac("sha256", configuration.secretKey).update(`block:${NETWORK}`).digest("hex");
const token = "m".repeat(20);

function modules({ env = {}, callRpc = async () => true, network = NETWORK } = {}) {
  const logs = [];
  const calls = [];
  const rules = load("src/lib/server/security/rules.ts");
  const persistence = { callRpc: async (...args) => { calls.push(args); return callRpc(...args); }, getPersistenceConfiguration: () => configuration };
  const abuse = { clientNetwork: () => network };
  const ops = load("src/lib/server/ops.ts", { "server-only": {}, "node:crypto": { createHash, randomUUID, timingSafeEqual },
    "./inquiries/persistence": persistence }, { process: { env }, console: { error: (line) => logs.push(JSON.parse(line)) } });
  const record = load("src/lib/server/security/record.ts", { "server-only": {}, "node:crypto": { createHmac },
    "../inquiries/abuse-limit": abuse, "../inquiries/persistence": persistence, "../ops": ops },
  { process: { env }, console: { error: (line) => logs.push(JSON.parse(line)) } });
  const incidents = load("src/lib/server/security/incidents.ts", { "server-only": {}, "@/lib/data/site": { site: { url: "https://www.example.test" } },
    "../inquiries/persistence": persistence, "./rules": rules, "./record": record }, { process: { env } });
  return { rules, record, incidents, ops, calls, logs, persistence };
}

// --- catalogue and SQL stay in step ---
test("the rule catalogue and the event codes match the SQL exactly", () => {
  const { rules, record } = modules();
  const sqlRules = [...migration.matchAll(/security_(?:scan|raise)\('(R\d_[a-z_]+)'/g)].map((m) => m[1]);
  same([...new Set(sqlRules)].sort(), Object.keys(rules.RULES).sort());
  const check = migration.match(/rule in \(([^)]*)\)/)[1];
  same([...check.matchAll(/'(R\d_[a-z_]+)'/g)].map((m) => m[1]).sort(), Object.keys(rules.RULES).sort());
  const codes = migration.match(/code in \(([^)]*)\)/)[1];
  same([...codes.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort(), [...record.EVENT_CODES].sort());
  for (const [name, rule] of Object.entries(rules.RULES)) {
    for (const field of ["technique", "uncertainty", "rollback"]) assert.ok(rule[field].length > 0, `${name}.${field}`);
    assert.ok(rule.containment.length > 0 && rule.investigation.length > 0, name);
    assert.doesNotMatch(JSON.stringify(rule), /—/, "no em dashes");
  }
});

test("the migration follows the table rules: RLS, no anon or authenticated grants, search_path pinned", () => {
  for (const table of ["security_event_counts", "security_incidents", "security_actions", "security_heartbeat", "security_alert_log"]) {
    assert.match(migration, new RegExp(`alter table inquiry_private\\.${table} enable row level security`));
  }
  assert.doesNotMatch(migration, /grant (insert|update|delete|all)[^;]*to (anon|authenticated|service_role)/i);
  assert.doesNotMatch(migration, /\bexecute\s+(format|'|")/i, "no dynamic SQL");
  const functions = migration.match(/create (or replace )?function [^\n]+/g);
  assert.ok(functions.length >= 12);
  assert.equal((migration.match(/set search_path = ''/g) ?? []).length, functions.length);
});

// --- recorder: best-effort, never throws, no PII ---
test("recordSecurityEvent sends a code and one network hash only, and never throws", async () => {
  const { record, calls, logs } = modules();
  await record.recordSecurityEvent({ headers: new Headers() }, "login_failed", configuration);
  assert.equal(calls.length, 1);
  const [, name, args] = calls[0];
  assert.equal(name, "record_security_event");
  same(args, { p_code: "login_failed", p_subject: HASH });
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(NETWORK.replaceAll(".", "\\.")));
  same(logs, []);
  // The hash is not the one a limiter would store ("contact-limit:", "login-limit:", "track-limit:").
  for (const purpose of ["contact-limit", "login-limit", "track-limit"]) {
    assert.notEqual(createHmac("sha256", configuration.secretKey).update(`${purpose}:${NETWORK}`).digest("hex"), HASH);
  }
});
test("recordSecurityEvent: an unknown network is '-', and a failing or throwing store changes nothing", async () => {
  const unattributed = modules({ network: "unattributed" });
  await unattributed.record.recordSecurityEvent({ headers: new Headers() }, "contact_honeypot", configuration);
  assert.equal(unattributed.calls[0][2].p_subject, "-");
  for (const callRpc of [async () => undefined, async () => { throw new Error("boom"); }, async () => false]) {
    const { record, logs } = modules({ callRpc });
    assert.equal(await record.recordSecurityEvent({ headers: new Headers() }, "staff_denied", configuration), undefined);
    same(logs.map((line) => line.code), ["security_event_failed"]);
    same(Object.keys(logs[0]).sort(), ["code", "level", "requestId", "source"]);
  }
  const none = modules();
  await none.record.recordSecurityEvent({ headers: new Headers() }, "login_failed", null);
  assert.equal(none.calls.length, 0);
});
test("recordBadBearer counts only requests that offered a bearer", async () => {
  const { record, calls } = modules();
  await record.recordBadBearer({ headers: new Headers() });
  assert.equal(calls.length, 0);
  await record.recordBadBearer({ headers: new Headers({ authorization: "Bearer nope" }) });
  assert.equal(calls[0][2].p_code, "cron_bad_secret");
});

// --- gate: fails open, passes the emergency stop, counts blocks ---
test("gateRequest: blocked, paused, clear, emergency stop, and every failure is clear", async () => {
  const answers = [];
  const { record, calls } = modules({ callRpc: async (_c, name) => name === "security_gate" ? answers.shift() : true });
  const gate = (surface = "contact") => record.gateRequest({ headers: new Headers() }, surface, configuration);
  answers.push({ blocked: true, paused: false, retryAfter: 1800 });
  same({ ...await gate() }, { kind: "blocked", retryAfter: 1800 });
  assert.equal(calls.at(-1)[2].p_code, "blocked_request", "a block counts as an event");
  answers.push({ blocked: false, paused: true, retryAfter: 1 });
  same({ ...await gate() }, { kind: "paused" });
  for (const bad of [undefined, null, "x", {}, { blocked: "yes" }, { blocked: true, retryAfter: -5 }]) {
    answers.push(bad);
    const result = await gate("track");
    assert.equal(result.kind === "blocked" ? result.retryAfter : result.kind, result.kind === "blocked" ? 3600 : "clear");
  }
  const failing = modules({ callRpc: async () => { throw new Error("down"); } });
  same({ ...await failing.record.gateRequest({ headers: new Headers() }, "login", configuration) }, { kind: "clear" });
  const stopped = modules({ env: { SECURITY_ACTIONS_DISABLED: "1" }, callRpc: async () => ({ blocked: false, paused: false, retryAfter: 1 }) });
  await stopped.record.gateRequest({ headers: new Headers() }, "contact", configuration, { env: { SECURITY_ACTIONS_DISABLED: "1" } });
  assert.equal(stopped.calls[0][2].p_disabled, true);
  same(stopped.calls[0][2].p_surface, "contact");
  assert.equal(modules().record.actionsDisabled({ SECURITY_ACTIONS_DISABLED: " true " }), true);
  assert.equal(modules().record.actionsDisabled({}), false);
});

// --- incident API: MONITOR_TOKEN only ---
function incidentRoutes(env, incidents = []) {
  const events = [];
  const ops = modules({ env }).ops;
  const imports = (extra) => ({ "@/lib/server/inquiries/persistence": { getPersistenceConfiguration: () => configuration },
    "@/lib/server/ops": ops, "@/lib/server/security/record": { recordBadBearer: async () => { events.push("bad_bearer"); } }, ...extra });
  const list = load("src/app/api/security/incidents/route.ts", imports({
    "@/lib/server/security/incidents": { readIncidents: async () => incidents } }), { process: { env } });
  const one = load("src/app/api/security/incidents/[id]/route.ts", imports({
    "@/lib/server/security/incidents": { INCIDENT_ID: /^INC-\d{8}-\d{4}$/, readIncidents: async (_c, { id }) => incidents.filter((i) => i.id === id) } }), { process: { env } });
  return { list, one, events };
}
const bearer = (value) => ({ headers: value ? { authorization: `Bearer ${value}` } : {} });
test("incident API: only the monitor token reads; unset, wrong, cron and health tokens are refused and counted", async () => {
  const env = { MONITOR_TOKEN: token, CRON_SECRET: "c".repeat(20), HEALTH_TOKEN: "h".repeat(20) };
  const { list, one, events } = incidentRoutes(env, [{ id: "INC-20261114-0001" }]);
  for (const value of ["c".repeat(20), "h".repeat(20), "wrong-wrong-wrong-wrong", "short"]) {
    for (const response of [await list.GET(new Request("http://x.test/api/security/incidents", bearer(value))),
      await one.GET(new Request("http://x.test/api/security/incidents/INC-20261114-0001", bearer(value)), { params: Promise.resolve({ id: "INC-20261114-0001" }) })]) {
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  }
  assert.equal(events.length, 8);
  assert.equal((await list.GET(new Request("http://x.test/api/security/incidents"))).status, 401);
  const ok = await list.GET(new Request("http://x.test/api/security/incidents", bearer(token)));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  same(await ok.json(), { incidents: [{ id: "INC-20261114-0001" }] });
  const params = (id) => ({ params: Promise.resolve({ id }) });
  assert.equal((await one.GET(new Request("http://x.test/a", bearer(token)), params("INC-20261114-0001"))).status, 200);
  assert.equal((await one.GET(new Request("http://x.test/a", bearer(token)), params("INC-20261114-0002"))).status, 404);
  assert.equal((await one.GET(new Request("http://x.test/a", bearer(token)), params("../../etc"))).status, 404);
  // MONITOR_TOKEN unset: the token cannot match anything, even an empty or "undefined" bearer.
  const unset = incidentRoutes({ CRON_SECRET: "c".repeat(20) });
  for (const value of ["c".repeat(20), "undefined", ""]) {
    assert.equal((await unset.list.GET(new Request("http://x.test/api/security/incidents", bearer(value)))).status, 401);
  }
});

// --- schema v1 ---
const row = (overrides = {}) => ({
  id: "INC-20261114-0001", schema_version: 1, environment: "local", status: "open", rule: "R1_password_guessing",
  severity: "high", confidence: "medium", test: false, subject: HASH, first_seen: "2026-11-14T14:52:00Z",
  last_seen: "2026-11-14T15:04:00Z", event_count: 14, created_at: "2026-11-14T15:05:00Z", updated_at: "2026-11-14T15:10:00Z",
  evidence: { provenance: "db:security_event_counts", window_minutes: 15, counts: { login_failed: 14, ignored_code: 3, login_limited: "x" }, log_refs: [] },
  actions: [], ...overrides });
test("toIncident: schema v1 shape, catalogue merged, accounts empty, unknown evidence keys dropped", () => {
  const { incidents } = modules({ env: { RESEND_API_KEY: "re_x", SECURITY_ALERT_EMAIL: "a@b.invalid", CONTACT_FROM_EMAIL: "f@b.invalid" } });
  const record = incidents.toIncident(row({ actions: [
    { id: 1, kind: "block_subject", created_at: "2026-11-14T15:06:00Z", expires_at: "2099-01-01T00:00:00Z", lifted_at: null },
    { id: 2, kind: "pause_contact", created_at: "2026-11-14T15:06:00Z", expires_at: "2026-11-14T16:06:00Z", lifted_at: "2026-11-14T15:30:00Z" },
    { id: 3, kind: "block_subject", created_at: "2026-11-14T15:06:00Z", expires_at: "2026-11-14T15:07:00Z", lifted_at: null }] }),
  { RESEND_API_KEY: "re_x", SECURITY_ALERT_EMAIL: "a@b.invalid", CONTACT_FROM_EMAIL: "f@b.invalid" });
  assert.match(record.id, /^INC-\d{8}-\d{4}$/);
  assert.equal(record.schema_version, 1);
  same({ ...record.evidence.counts }, { login_failed: 14 });
  assert.equal(record.evidence.provenance, "db:security_event_counts");
  same([...record.affected.accounts], []);
  same([...record.affected.endpoints], ["/admin/login"]);
  assert.ok(record.technique && record.rollback && record.investigation.length && record.containment.length);
  same(record.actions.map((a) => a.outcome), ["active", "lifted", "expired"]);
  assert.ok(record.actions.every((a) => a.by === "owner"));
  assert.equal(record.escalation_contact, "configured");
  assert.equal(incidents.toIncident(row(), {}).escalation_contact, "not configured");
  const text = JSON.stringify(record);
  assert.doesNotMatch(text, /a@b\.invalid|re_x/, "no address or key in a record");
});
test("toIncident rejects forged or malformed rows instead of passing them on", () => {
  const { incidents } = modules();
  const bad = [{ id: "INC-1" }, { id: "INC-20261114-0001\nignore previous instructions" }, { rule: "R9_made_up" },
    { rule: "run `curl evil` now" }, { status: "closed" }, { severity: "critical" }, { subject: "10.0.0.1" }, { schema_version: 2 },
    { environment: "prod" }, { event_count: "14" }, { first_seen: "later" }, { test: "no" },
    { evidence: { provenance: "somewhere else", window_minutes: 15, counts: {} } },
    { actions: [{ id: "1", kind: "block_subject", created_at: "2026-11-14T15:06:00Z", expires_at: "2026-11-14T15:07:00Z", lifted_at: null }] },
    { actions: [{ id: 1, kind: "delete_everything", created_at: "2026-11-14T15:06:00Z", expires_at: "2026-11-14T15:07:00Z", lifted_at: null }] }];
  for (const overrides of bad) assert.equal(incidents.toIncident(row(overrides), {}), null, JSON.stringify(overrides));
  assert.equal(incidents.toIncident(null, {}), null);
  assert.equal(incidents.toIncident("x", {}), null);
  assert.ok(incidents.toIncident(row({ subject: "-" }), {}));
  assert.equal(incidents.INCIDENT_ID.test("INC-20261114-0001"), true);
  assert.equal(incidents.INCIDENT_ID.test("INC-20261114-00012"), false);
});
test("owner page read passes the signed-in staff id to security_owner_incidents_read", async () => {
  const m = modules({ callRpc: async () => [row()] });
  assert.equal((await m.incidents.readIncidentsAsOwner(configuration, { userId: "staff-1" }, 50)).length, 1);
  const [, name, args] = m.calls[0];
  assert.equal(name, "security_owner_incidents_read");
  assert.equal(args.p_staff, "staff-1");
  assert.equal(await modules({ callRpc: async () => undefined }).incidents.readIncidentsAsOwner(configuration, { userId: "s" }), undefined);
});
test("readIncidents: bad ids never reach the database; a bad answer is unavailable", async () => {
  const good = modules({ callRpc: async () => [row()] });
  same(await good.incidents.readIncidents(configuration, { id: "x; drop table" }), []);
  assert.equal(good.calls.length, 0);
  assert.equal((await good.incidents.readIncidents(configuration, { id: "INC-20261114-0001" })).length, 1);
  assert.equal(await modules({ callRpc: async () => undefined }).incidents.readIncidents(configuration), undefined);
  assert.equal(await modules({ callRpc: async () => ({ not: "an array" }) }).incidents.readIncidents(configuration), undefined);
  const mixed = modules({ callRpc: async () => [row(), row({ rule: "forged" })] });
  assert.equal((await mixed.incidents.readIncidents(configuration)).length, 1);
});

// --- owner-only actions ---
const owner = { userId: "11111111-1111-4111-8111-111111111111", email: "owner@example.invalid", role: "owner" };
test("createAction: only the owner reaches the database, the emergency stop is passed along, answers are validated", async () => {
  const m = modules({ callRpc: async () => ({ result: "created", id: 5 }) });
  const input = { kind: "block_subject", incident: "INC-20261114-0001", subject: HASH, hours: 1, actorSubject: "-" };
  same({ ...await m.incidents.createAction(configuration, { ...owner, role: "staff" }, input) }, { kind: "unavailable" });
  same({ ...await m.incidents.createAction(configuration, owner, { ...input, incident: "nope" }) }, { kind: "unavailable" });
  assert.equal(m.calls.length, 0);
  same({ ...await m.incidents.createAction(configuration, owner, input) }, { kind: "created" });
  assert.equal(m.calls[0][1], "security_create_action");
  assert.equal(m.calls[0][2].p_staff, owner.userId);
  assert.equal(m.calls[0][2].p_disabled, false);
  const stopped = modules({ callRpc: async () => ({ result: "refused", reason: "disabled" }) });
  same({ ...await stopped.incidents.createAction(configuration, owner, input, { env: { SECURITY_ACTIONS_DISABLED: "1" } }) }, { kind: "refused", reason: "disabled" });
  assert.equal(stopped.calls[0][2].p_disabled, true);
  for (const bad of [undefined, { result: "refused", reason: "Robert'); drop" }, { result: "weird" }]) {
    same({ ...await modules({ callRpc: async () => bad }).incidents.createAction(configuration, owner, input) }, { kind: "unavailable" });
  }
  assert.equal(await m.incidents.liftAction(configuration, { ...owner, role: "staff" }, 1), "unavailable");
  assert.equal(await m.incidents.liftAction(configuration, owner, 0), "unavailable");
  assert.equal(await m.incidents.setIncidentStatus(configuration, { ...owner, role: "staff" }, "INC-20261114-0001", "resolved"), "unavailable");
  assert.equal(await m.incidents.setIncidentStatus(configuration, owner, "INC-20261114-0001", "deleted"), "unavailable");
});

function securityActions(role) {
  const calls = [];
  const fail = (kind) => (to) => { throw Object.assign(new Error(kind), { kind, to }); };
  const actions = load("src/app/[lang]/(staff)/admin/security/actions.ts", {
    "next/headers": { headers: async () => new Headers() },
    "next/navigation": { redirect: fail("redirect"), notFound: fail("notFound") },
    "@/lib/server/auth/session": { requireStaff: async () => ({ ...owner, role }) },
    "@/lib/server/inquiries/persistence": { getPersistenceConfiguration: () => configuration },
    "@/lib/server/security/incidents": {
      INCIDENT_ID: /^INC-\d{8}-\d{4}$/, isStatus: (v) => ["open", "investigating", "contained", "resolved", "false_positive"].includes(v),
      createAction: async (...args) => { calls.push(["create", args]); return { kind: "created" }; },
      liftAction: async (...args) => { calls.push(["lift", args]); return "lifted"; },
      setIncidentStatus: async (...args) => { calls.push(["status", args]); return "updated"; } },
    "@/lib/server/security/record": { securitySubject: () => HASH },
  });
  const form = (fields) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
  const run = async (name, fields) => { try { await actions[name](form(fields)); } catch (error) { return error; } throw new Error("expected redirect"); };
  return { run, calls };
}
test("security actions: the staff role gets not-found and changes nothing; the owner is validated and redirected", async () => {
  const staff = securityActions("staff");
  for (const [name, fields] of [["takeAction", { kind: "pause_contact", incident: "INC-20261114-0001", hours: "1" }],
    ["lift", { action: "1" }], ["changeStatus", { incident: "INC-20261114-0001", status: "resolved" }]]) {
    assert.equal((await staff.run(name, fields)).kind, "notFound", name);
  }
  assert.equal(staff.calls.length, 0);
  const owned = securityActions("owner");
  assert.equal((await owned.run("takeAction", { kind: "block_subject", incident: "INC-20261114-0001", subject: HASH, hours: "2" })).to, "/admin/security?notice=created");
  same(owned.calls[0][1].slice(2).map((x) => ({ ...x })), [{ kind: "block_subject", incident: "INC-20261114-0001", hours: 2, subject: HASH, actorSubject: HASH }]);
  for (const bad of [{ kind: "delete_data", incident: "INC-20261114-0001", hours: "1" }, { kind: "pause_contact", incident: "INC-20261114-0001", hours: "25" },
    { kind: "pause_contact", incident: "INC-20261114-0001", hours: "0" }, { kind: "pause_contact", incident: "x", hours: "1" }, { kind: "pause_contact", incident: "INC-20261114-0001", hours: "1.5" }]) {
    assert.equal((await owned.run("takeAction", bad)).to, "/admin/security?notice=invalid", JSON.stringify(bad));
  }
  assert.equal(owned.calls.length, 1);
  assert.equal((await owned.run("lift", { action: "7" })).to, "/admin/security?notice=lifted");
  assert.equal((await owned.run("changeStatus", { incident: "INC-20261114-0001", status: "bogus" })).to, "/admin/security?notice=invalid");
  assert.equal((await owned.run("changeStatus", { incident: "INC-20261114-0001", status: "resolved" })).to, "/admin/security?notice=updated");
});

// --- security cron, alerts, synthetic path ---
function cron(env, detect) {
  const events = [], sent = [];
  const ops = modules({ env }).ops;
  const route = load("src/app/api/cron/security/route.ts", {
    "@/lib/server/inquiries/persistence": { getPersistenceConfiguration: () => configuration },
    "@/lib/server/ops": { ...ops, requestLogger: () => (code) => events.push(code) },
    "@/lib/server/security/incidents": {
      alertConfiguration: () => env.RESEND_API_KEY && env.SECURITY_ALERT_EMAIL && env.CONTACT_FROM_EMAIL ? { apiKey: "k", to: "t", from: "f" } : null,
      runDetection: async (_c, input) => { events.push(["detect", input]); return detect(input); },
      sendAlert: async (alert) => { sent.push(alert.id); return alert.id !== "INC-20261114-0009"; } },
    "@/lib/server/security/record": { recordBadBearer: async () => { events.push("bad_bearer"); } },
  }, { process: { env } });
  return { route, events, sent };
}
test("security cron: CRON_SECRET only; synthetic flag and alert claiming follow the configuration", async () => {
  const secret = "c".repeat(20);
  const all = { CRON_SECRET: secret, RESEND_API_KEY: "re", SECURITY_ALERT_EMAIL: "a", CONTACT_FROM_EMAIL: "f" };
  const run = cron(all, () => ({ alerts: [{ id: "INC-20261114-0001" }, { id: "INC-20261114-0009" }] }));
  for (const value of [token, "", "x".repeat(20)]) {
    assert.equal((await run.route.GET(new Request("http://x.test/api/cron/security", bearer(value)))).status, 401);
  }
  same(run.events.filter((e) => e === "bad_bearer").length, 3);
  const ok = await run.route.GET(new Request("http://x.test/api/cron/security?synthetic=1", bearer(secret)));
  assert.equal(ok.status, 200);
  same({ ...await ok.json() }, { ok: true, alerts: 2, sent: 1, alertsConfigured: true });
  same(run.events.find((e) => e[0] === "detect")[1], { synthetic: true, claimAlerts: true });
  assert.ok(run.events.includes("security_alert_failed"));
  same(run.sent, ["INC-20261114-0001", "INC-20261114-0009"]);
  // No mail settings: detection still runs, nothing is claimed or sent, the incident is still recorded.
  const quiet = cron({ CRON_SECRET: secret }, () => ({ alerts: [] }));
  const reply = await quiet.route.GET(new Request("http://x.test/api/cron/security", bearer(secret)));
  same({ ...await reply.json() }, { ok: true, alerts: 0, sent: 0, alertsConfigured: false });
  same(quiet.events.find((e) => e[0] === "detect")[1], { synthetic: false, claimAlerts: false });
  const down = cron({ CRON_SECRET: secret }, () => undefined);
  assert.equal((await down.route.GET(new Request("http://x.test/api/cron/security", bearer(secret)))).status, 503);
});
test("alert email: id, rule, severity, counts and a link; no network hash, no address; [TEST] for synthetic; .invalid skipped", async () => {
  const { incidents } = modules();
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, init, body: JSON.parse(init.body) }); return new Response("{}", { status: 200 }); };
  const settings = { apiKey: "re_test_key", to: "owner@example.test", from: "Alerts <alerts@example.test>" };
  const alert = { id: "INC-20261114-0001", rule: "R1_password_guessing", severity: "high", eventCount: 14, test: false, counts: { login_failed: 14 } };
  assert.equal(await incidents.sendAlert(alert, settings, { fetch: fetchImpl, env: {} }), true);
  assert.equal(await incidents.sendAlert({ ...alert, rule: "R0_synthetic", severity: "info", test: true, counts: {} }, settings, { fetch: fetchImpl, env: { ADMIN_HOST: "admin.example.test" } }), true);
  assert.equal(sent[0].url, "https://api.resend.com/emails");
  assert.equal(sent[0].body.subject, "Security incident INC-20261114-0001 (high)");
  assert.match(sent[0].body.text, /Rule: R1_password_guessing[\s\S]*login_failed: 14[\s\S]*https:\/\/www\.example\.test\/admin\/security/);
  assert.equal(sent[1].body.subject, "[TEST] Security incident INC-20261114-0001 (info)");
  assert.match(sent[1].body.text, /https:\/\/admin\.example\.test\/admin\/security/);
  for (const message of sent) assert.doesNotMatch(message.body.subject + message.body.text, /[0-9a-f]{64}|owner@example/);
  const before = sent.length;
  assert.equal(await incidents.sendAlert(alert, { ...settings, to: "someone@example.invalid" }, { fetch: fetchImpl }), false);
  assert.equal(sent.length, before);
  assert.equal(await incidents.sendAlert(alert, settings, { fetch: async () => new Response("no", { status: 500 }) }), false);
  assert.equal(await incidents.sendAlert(alert, settings, { fetch: async () => { throw new Error("down"); } }), false);
});
test("runDetection: validates the answer and keeps only fixed alert fields", async () => {
  const answer = { ranAt: "2026-11-14T15:00:00Z", alerts: [
    { id: "INC-20261114-0001", rule: "R1_password_guessing", severity: "high", eventCount: 3, test: false, counts: { login_failed: 3, evil: 9 }, extra: "x" },
    { id: "bad", rule: "R1_password_guessing", severity: "high", eventCount: 3, test: false, counts: {} },
    { id: "INC-20261114-0002", rule: "forged", severity: "high", eventCount: 3, test: false, counts: {} }] };
  const m = modules({ callRpc: async () => answer, env: { VERCEL_ENV: "preview" } });
  const result = await m.incidents.runDetection(configuration, { synthetic: true, claimAlerts: true }, { env: { VERCEL_ENV: "preview" } });
  assert.equal(result.alerts.length, 1);
  same({ ...result.alerts[0].counts }, { login_failed: 3 });
  same(Object.keys(result.alerts[0]).sort(), ["counts", "eventCount", "id", "rule", "severity", "test"]);
  same({ ...m.calls[0][2] }, { p_environment: "preview", p_synthetic: true, p_claim_alerts: true });
  assert.equal(await modules({ callRpc: async () => ({ nope: 1 }) }).incidents.runDetection(configuration, { synthetic: false, claimAlerts: false }), undefined);
  assert.equal(modules().incidents.securityEnvironment({}), "local");
  assert.equal(modules().incidents.securityEnvironment({ VERCEL_ENV: "production" }), "production");
  assert.equal(modules().incidents.securityEnvironment({ VERCEL_ENV: "development" }), "local");
});

// --- health ---
test("health problems: an open high incident and stale or missing detection are named; an older database is not flagged", () => {
  const { ops } = modules();
  const healthy = { jobs: {}, oldestDueJobSeconds: 0, deliveryProblems7d: 0, unmatchedDeliveryEvents: 0, inquiries24h: 0, loginHitsNow: 0 };
  same([...ops.findProblems(healthy)], []);
  same([...ops.findProblems({ ...healthy, securityHighOpen: 0, securityLastRunSeconds: 120 })], []);
  same([...ops.findProblems({ ...healthy, securityHighOpen: 1, securityLastRunSeconds: 120 })], ["security_incident_open"]);
  same([...ops.findProblems({ ...healthy, securityHighOpen: 0, securityLastRunSeconds: 901 })], ["security_detection_stale"]);
  same([...ops.findProblems({ ...healthy, securityHighOpen: 0, securityLastRunSeconds: null })], ["security_detection_stale"]);
  assert.equal(ops.hasMonitorToken({ headers: new Headers({ authorization: `Bearer ${token}` }) }, { MONITOR_TOKEN: token }), true);
  assert.equal(ops.hasMonitorToken({ headers: new Headers({ authorization: `Bearer ${token}` }) }, { CRON_SECRET: token }), false);
  assert.equal(ops.hasCronSecret({ headers: new Headers({ authorization: `Bearer ${token}` }) }, { MONITOR_TOKEN: token }), false);
});

// --- contact and track: block, pause, events ---
function contact(security, parse = { kind: "valid", inquiry: {}, submissionKey: null }) {
  const calls = [];
  const handler = load("src/lib/server/contact.ts", { "./inquiries/contact-input": { parseContactInput: async () => parse } });
  const respond = (dependencies) => handler.handleContact(new Request("http://x.test/api/contact", { method: "POST" }), {
    getConfiguration: () => ({ persistence: configuration, from: "f@example.test", to: "t@example.test" }),
    limit: async () => { calls.push("limit"); return { kind: "allowed" }; },
    record: async () => { calls.push("record"); return { kind: "recorded", inquiryId: "id" }; },
    logError: () => {}, security, ...dependencies });
  return { respond, calls };
}
test("contact: a block answers 429 with its expiry and a pause answers 503, both before the limiter or any write", async () => {
  const blocked = contact({ gate: async () => ({ kind: "blocked", retryAfter: 1200 }), event: async () => {} });
  const refused = await blocked.respond();
  assert.equal(refused.status, 429);
  assert.equal(refused.headers.get("retry-after"), "1200");
  same(blocked.calls, []);
  const paused = contact({ gate: async () => ({ kind: "paused" }), event: async () => {} });
  const answer = await paused.respond();
  assert.equal(answer.status, 503);
  assert.match((await answer.json()).error, /call us/i);
  same(paused.calls, []);
  const clear = contact({ gate: async () => ({ kind: "clear" }), event: async () => {} });
  assert.equal((await clear.respond()).status, 202);
  same(clear.calls, ["limit", "record"]);
});
test("contact: limited and honeypot attempts are counted, with no change to the reply", async () => {
  const events = [];
  const security = { gate: async () => ({ kind: "clear" }), event: async (_r, code) => { events.push(code); } };
  const limited = contact(security);
  const reply = await limited.respond({ limit: async () => ({ kind: "limited", retryAfter: 30 }) });
  assert.equal(reply.status, 429);
  same(events, ["contact_limited"]);
  const bot = contact(security, { kind: "discard" });
  const discarded = await bot.respond();
  assert.equal(discarded.status, 202);
  same(await discarded.json(), { ok: true });
  same(events, ["contact_limited", "contact_honeypot"]);
  same(bot.calls, []);
  // Without the security dependency (older callers and tests) nothing changes.
  assert.equal((await contact(undefined).respond()).status, 202);
});
test("track: a blocked network is dropped quietly before the limiter; a limited one is counted", async () => {
  const events = [], calls = [];
  const track = load("src/lib/server/track.ts", { "server-only": {}, "node:crypto": { createHmac },
    "./inquiries/abuse-limit": { clientNetwork: () => NETWORK, parseLimitResult: () => ({ kind: "allowed" }) },
    "./inquiries/persistence": { callRpc: async () => undefined, readBounded: async (body) => new Uint8Array(await new Response(body).arrayBuffer()) } });
  const request = () => new Request("http://x.test/api/track", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ target: "book", lang: "en" }) });
  const dependencies = (gate, limit) => ({ configuration: () => configuration, logError: () => {},
    limit: async () => { calls.push("limit"); return limit; }, record: async () => { calls.push("record"); return true; },
    security: { gate: async () => gate, event: async (_r, code) => { events.push(code); } } });
  assert.equal((await track.handleTrack(request(), dependencies({ kind: "blocked", retryAfter: 60 }, { kind: "allowed" }))).status, 204);
  same(calls, []);
  assert.equal((await track.handleTrack(request(), dependencies({ kind: "clear" }, { kind: "limited", retryAfter: 5 }))).status, 204);
  same(events, ["track_limited"]);
  same(calls, ["limit"]);
  assert.equal((await track.handleTrack(request(), dependencies({ kind: "paused" }, { kind: "allowed" }))).status, 204);
  same(calls, ["limit", "limit", "record"]);
});

// --- sign-in emits ---
function signIn({ limit = { kind: "allowed" }, session = { kind: "invalid" }, resolved = { kind: "ok", value: {} }, gate = { kind: "clear" } } = {}) {
  const events = [], calls = [];
  const redirect = (to) => { throw Object.assign(new Error("redirect"), { to }); };
  const actions = load("src/app/[lang]/(staff)/admin/actions.ts", {
    "next/headers": { headers: async () => new Headers() }, "next/navigation": { redirect, notFound: () => { throw new Error("notFound"); } },
    "@/lib/data/site": { site: { phone: { display: "(555) 000-0000" } } },
    "@/lib/server/auth/session": { endSession: async () => {}, saveSession: async () => calls.push("save") },
    "@/lib/server/auth/staff-auth": {
      checkLoginLimit: async () => { calls.push("limit"); return limit; }, isStaffHost: () => true, passwordProblem: () => null,
      resolveStaff: async () => resolved, signInWithPassword: async () => { calls.push("signin"); return session; },
      signOut: async () => calls.push("signout"), updatePassword: async () => ({ kind: "ok" }), verifyEmailLink: async () => session },
    "@/lib/server/inquiries/persistence": { getPersistenceConfiguration: () => configuration },
    "@/lib/server/security/record": { liveSecurity: { gate: async () => gate, event: async (_r, code) => { events.push(code); } } },
  });
  const form = new FormData();
  form.set("email", "test@example.invalid");
  form.set("password", "a wrong password");
  return { events, calls, run: () => actions.login(undefined, form).catch((error) => ({ redirected: error.to })) };
}
test("sign-in: failed, limited and non-staff attempts are counted; a block answers like a limit without trying the password", async () => {
  const failed = signIn();
  assert.match((await failed.run()).error, /do not match/);
  same(failed.events, ["login_failed"]);
  const limited = signIn({ limit: { kind: "limited", retryAfter: 600 } });
  assert.match((await limited.run()).error, /Too many attempts\. Try again in 10 minutes/);
  same(limited.events, ["login_limited"]);
  assert.ok(!limited.calls.includes("signin"));
  const denied = signIn({ session: { kind: "ok", value: { accessToken: "t" } }, resolved: { kind: "denied" } });
  assert.match((await denied.run()).error, /do not match/);
  same(denied.events, ["staff_denied"]);
  assert.ok(denied.calls.includes("signout"));
  const staff = signIn({ session: { kind: "ok", value: { accessToken: "t" } } });
  assert.equal((await staff.run()).redirected, "/admin");
  same(staff.events, []);
  const blocked = signIn({ gate: { kind: "blocked", retryAfter: 3600 } });
  assert.match((await blocked.run()).error, /Too many attempts\. Try again in 60 minutes/);
  same(blocked.calls, [], "neither the limiter nor the password check ran");
  same(blocked.events, []);
});

test("recordSecurityEvent: capped per code per minute per instance; the next minute passes again", async () => {
  const { record, calls } = modules({ callRpc: async () => true });
  const request = { headers: new Headers() };
  let now = 1_700_000_000_000;
  const options = { now: () => now };
  const cap = record.EVENT_WRITES_PER_MINUTE;
  for (let i = 0; i < cap; i++) await record.recordSecurityEvent(request, "cron_bad_secret", configuration, options);
  assert.equal(calls.length, cap);
  await record.recordSecurityEvent(request, "cron_bad_secret", configuration, options);
  assert.equal(calls.length, cap, "write cap+1 in the same minute is dropped");
  await record.recordSecurityEvent(request, "login_failed", configuration, options);
  assert.equal(calls.length, cap + 1, "another code has its own budget");
  now += 60_000;
  await record.recordSecurityEvent(request, "cron_bad_secret", configuration, options);
  assert.equal(calls.length, cap + 2, "the next minute passes again");
  assert.ok(cap >= 50, "above the highest detection threshold (R6 contact_honeypot, 50)");
});
