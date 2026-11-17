import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { test } from "node:test";
import EmbeddedPostgres from "embedded-postgres";

// ADR-0004 security monitoring on a throw-away PostgreSQL with every migration. Synthetic data only; no DATABASE_URL.
const fixtureRoot = resolve(".local-db-tests");
mkdirSync(fixtureRoot, { recursive: true });
const databaseDir = mkdtempSync(join(fixtureRoot, "security-"));
const port = await new Promise((resolvePort, reject) => {
  const server = createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const value = server.address().port;
    server.close(() => resolvePort(value));
  });
});
const cluster = new EmbeddedPostgres({ databaseDir, port, user: "postgres",
  password: randomBytes(24).toString("hex"), persistent: true, authMethod: "scram-sha-256",
  postgresFlags: ["-h", "127.0.0.1"], onLog: () => {}, onError: () => {} });
const migration = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort()
  .map((name) => readFileSync(join("supabase/migrations", name), "utf8")).join("\n");

async function connect(database = "security_test") {
  const client = cluster.getPgClient(database, "127.0.0.1");
  await client.connect();
  return client;
}
async function as(role, sql, values = []) {
  const client = await connect();
  try {
    await client.query(`set role ${role}`);
    return (await client.query(sql, values)).rows;
  } finally { await client.end(); }
}
const service = async (sql, values) => (await as("service_role", sql, values))[0]?.r;
const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code);
const hex = (n) => String(n).padStart(2, "0").repeat(32);
const [S1, S2, S3] = [hex(11), hex(22), hex(33)];

test("security monitoring on real PostgreSQL", { timeout: 240_000 }, async (t) => {
  let admin;
  try {
    await cluster.initialise();
    await cluster.start();
    const root = await connect("postgres");
    try {
      await root.query("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;");
    } finally { await root.end(); }
    await cluster.createDatabase("security_test");
    admin = await connect();
    await admin.query(migration);

    const q = async (sql, values = []) => (await admin.query(sql, values)).rows;
    const reset = async () => {
      for (const table of ["security_actions", "security_incidents", "security_event_counts", "security_alert_log", "security_heartbeat"]) {
        await q(`delete from inquiry_private.${table}`);
      }
    };
    const events = (code, subject, count, minutesAgo = 0) => q(
      "insert into inquiry_private.security_event_counts values (date_trunc('minute', now()) - make_interval(mins => $4), $1, $2, $3) on conflict (minute, code, subject) do update set count = excluded.count",
      [code, subject, count, minutesAgo]);
    const detect = (synthetic = false, claim = false) => service("select public.security_detect('local', $1, $2) r", [synthetic, claim]);
    const incidents = () => q("select id, rule, severity, status, subject, dedup_key, event_count, test, evidence from inquiry_private.security_incidents order by id");
    const owner = randomUUID(), staffer = randomUUID();
    await q("insert into inquiry_private.staff_members(user_id, role) values ($1,'owner'), ($2,'staff')", [owner, staffer]);
    const act = (who, kind, incident, subject, hours = 1, actor = null, disabled = false) =>
      service("select public.security_create_action($1,$2,$3,$4,$5,$6,$7) r", [who, kind, incident, subject, hours, actor, disabled]);
    const gate = (subject, surface, disabled = false) => service("select public.security_gate($1,$2,$3) r", [subject, surface, disabled]);

    await t.test("grants: anon and authenticated reach nothing; the server key reads but never writes tables directly", async () => {
      const tables = ["security_event_counts", "security_incidents", "security_actions", "security_heartbeat", "security_alert_log"];
      const calls = ["select public.record_security_event('login_failed','-')", "select public.security_detect('local')",
        "select public.security_incidents_read()", "select public.security_owner_incidents_read(gen_random_uuid())",
        "select public.security_gate('-','contact')",
        "select public.security_lift_action(gen_random_uuid(), 1)", "select public.security_set_status(gen_random_uuid(),'x','open')",
        `select public.security_create_action(gen_random_uuid(),'pause_contact','x',null,1,null,false)`,
        `select public.check_track_limit('${S1}',5,60,10)`];
      const denied = await connect();
      try {
        for (const role of ["anon", "authenticated"]) {
          await denied.query(`set role ${role}`);
          await denied.query("select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"user_metadata\":{\"role\":\"owner\"}}', false)");
          for (const table of tables) await rejects(denied.query(`select * from inquiry_private.${table}`), "42501");
          for (const call of calls) await rejects(denied.query(call), "42501");
          await denied.query("reset role");
        }
      } finally { await denied.end(); }
      const touch = { security_event_counts: "count = 1", security_incidents: "status = status", security_actions: "kind = kind", security_heartbeat: "id = id", security_alert_log: "band = band" };
      for (const table of tables.slice(0, 4)) await as("service_role", `select count(*) from inquiry_private.${table}`);
      await rejects(as("service_role", "select * from inquiry_private.security_alert_log"), "42501");
      for (const table of tables) {
        await rejects(as("service_role", `delete from inquiry_private.${table}`), "42501");
        await rejects(as("service_role", `update inquiry_private.${table} set ${touch[table]}`), "42501");
      }
      await rejects(as("service_role", "insert into inquiry_private.security_event_counts values (now(),'login_failed','-',1)"), "42501");
      // Internal helpers are not callable with the server key either.
      await rejects(as("service_role", "select inquiry_private.require_owner(gen_random_uuid())"), "42501");
      await rejects(as("service_role", "select inquiry_private.security_scan('R1_password_guessing','high','medium',15,null,null,'local')"), "42501");
    });

    await t.test("record_security_event: counts per minute, folds bad subjects into '-', rejects unknown codes, caps subjects at 200", async () => {
      await reset();
      for (const subject of [S1, S1, S1, null, "not-a-hash"]) await service("select public.record_security_event('login_failed', $1) r", [subject]);
      const rows = await q("select code, subject, count from inquiry_private.security_event_counts order by subject");
      assert.deepEqual(rows.map((row) => [row.subject, row.count]), [["-", 2], [S1, 3]]);
      for (const code of ["nope", null, "LOGIN_FAILED", "login_failed; drop table x"]) {
        await rejects(as("service_role", "select public.record_security_event($1,'-')", [code]), "22023");
      }
      await q("insert into inquiry_private.security_event_counts select date_trunc('minute', now()), 'staff_denied', md5(g::text) || md5((g + 1000)::text), 1 from generate_series(1, 200) g");
      await service("select public.record_security_event('staff_denied', $1) r", [S2]);
      assert.equal((await q("select count(*)::int n from inquiry_private.security_event_counts where subject = $1", [S2]))[0].n, 0);
      assert.equal((await q("select count from inquiry_private.security_event_counts where subject = '-' and code = 'staff_denied'"))[0].count, 1);
      const known = (await q("select subject from inquiry_private.security_event_counts where code = 'staff_denied' and subject <> '-' limit 1"))[0].subject;
      await service("select public.record_security_event('staff_denied', $1) r", [known]);
      assert.equal((await q("select count from inquiry_private.security_event_counts where subject = $1 and code = 'staff_denied'", [known]))[0].count, 2);
    });

    await t.test("detection: each rule fires at its threshold and not below it; ids and the heartbeat are written", async () => {
      const table = [["R1_password_guessing", "login_failed", S1, 10, "high"], ["R2_login_lockout", "login_limited", S1, 3, "medium"],
        ["R3_non_staff_admin", "staff_denied", S1, 1, "medium"], ["R4_forged_webhook", "webhook_bad_signature", "-", 5, "medium"],
        ["R5_secret_probing", "cron_bad_secret", "-", 5, "medium"], ["R6_spam_wave", "contact_limited", S1, 20, "low"],
        ["R6_spam_wave", "contact_honeypot", S1, 50, "low"], ["R7_disguised_upload", "upload_refused", S1, 3, "medium"]];
      for (const [rule, code, subject, threshold, severity] of table) {
        await reset();
        if (threshold > 1) {
          await events(code, subject, threshold - 1);
          await detect();
          assert.equal((await incidents()).length, 0, `${rule} below threshold`);
        }
        await events(code, subject, threshold);
        await detect();
        const [incident, ...more] = await incidents();
        assert.equal(more.length, 0, rule);
        assert.match(incident.id, /^INC-\d{8}-0001$/);
        assert.deepEqual([incident.rule, incident.severity, incident.status, incident.subject, incident.test], [rule, severity, "open", subject, false]);
        assert.equal(incident.dedup_key, `${rule}:${subject}`);
        assert.equal(incident.evidence.provenance, "db:security_event_counts");
        assert.equal(incident.evidence.counts[code], threshold);
      }
      assert.ok((await q("select last_run from inquiry_private.security_heartbeat where id = 1")).length === 1);
      await rejects(as("service_role", "select public.security_detect('prod')"), "22023");
      await rejects(as("service_role", "select public.security_detect(null)"), "22023");
    });

    await t.test("detection: repeats update one incident; site-wide fires only when no single network crossed; events outside the window do not count", async () => {
      await reset();
      await events("login_failed", S1, 12);
      await detect();
      await events("login_failed", S1, 15);
      await detect();
      await detect();
      const [only, ...rest] = await incidents();
      assert.equal(rest.length, 0);
      assert.equal(only.event_count, 15, "the larger count is kept");
      // One noisy network plus background noise: one per-network incident, no second site-wide one.
      await reset();
      await events("login_failed", S1, 12);
      await events("login_failed", S2, 9);
      await events("login_failed", S3, 9);
      await detect();
      assert.deepEqual((await incidents()).map((row) => row.subject), [S1]);
      // Spread over many networks, none above 10: one site-wide incident at 30.
      await reset();
      for (const n of [1, 2, 3, 4, 5, 6]) await events("login_failed", hex(40 + n), 5);
      await detect();
      assert.deepEqual((await incidents()).map((row) => [row.subject, row.rule]), [["-", "R1_password_guessing"]]);
      await reset();
      await events("login_failed", S1, 50, 16);
      await detect();
      assert.equal((await incidents()).length, 0, "16 minutes ago is outside the 15 minute window");
    });

    await t.test("a closed incident is not reopened by the same events, but newer events raise a new one", async () => {
      await reset();
      await events("staff_denied", S1, 2);
      await detect();
      await q("update inquiry_private.security_incidents set status = 'resolved'");
      await detect();
      assert.equal((await incidents()).length, 1);
      await q("update inquiry_private.security_incidents set last_seen = now() - interval '10 minutes'");
      await detect();
      const rows = await incidents();
      assert.deepEqual(rows.map((row) => row.status).sort(), ["open", "resolved"]);
      assert.notEqual(rows[0].id, rows[1].id);
    });

    await t.test("at most 50 live incidents; the rest fold into one overflow incident per rule", async () => {
      await reset();
      await q("insert into inquiry_private.security_event_counts select date_trunc('minute', now()), 'staff_denied', md5(g::text) || md5((g + 1000)::text), 1 from generate_series(1, 55) g");
      await detect();
      await detect();
      const rows = await incidents();
      assert.equal(rows.length, 51);
      const overflow = rows.filter((row) => row.dedup_key === "R3_non_staff_admin:overflow");
      assert.equal(overflow.length, 1);
      assert.equal(overflow[0].subject, "-");
      assert.equal(overflow[0].rule, "R3_non_staff_admin");
      assert.equal(overflow[0].evidence.overflow, true);
      assert.equal(new Set(rows.map((row) => row.id)).size, 51);
      assert.ok(rows.every((row) => /^INC-\d{8}-\d{4}$/.test(row.id)));
    });

    await t.test("owner actions: refusal reasons, expiry bounds, the incident becomes contained, reason comes from the rule", async () => {
      await reset();
      await events("staff_denied", S1, 2);
      await events("staff_denied", S2, 2);
      await detect();
      const byId = Object.fromEntries((await incidents()).map((row) => [row.subject, row.id]));
      const [A, B] = [byId[S1], byId[S2]];

      for (const who of [staffer, randomUUID(), null]) await rejects(act(who, "pause_contact", A, null), "42501");
      await rejects(act(owner, "delete_everything", A, null), "22023");
      assert.equal((await q("select count(*)::int n from inquiry_private.security_actions"))[0].n, 0);
      assert.equal((await act(owner, "block_subject", A, S1, 1, null, true)).reason, "disabled");
      for (const hours of [0, 25, null, -3]) assert.equal((await act(owner, "block_subject", A, S1, hours)).reason, "bad_expiry", String(hours));
      assert.equal((await act(owner, "block_subject", "INC-20000101-0001", S1)).reason, "incident_not_active");
      assert.equal((await act(owner, "block_subject", A, "-")).reason, "unattributed");
      for (const subject of [null, "xyz", "Z".repeat(64)]) assert.equal((await act(owner, "block_subject", A, subject)).reason, "invalid_subject", String(subject));
      assert.equal((await act(owner, "block_subject", A, S2)).reason, "not_incident_subject");
      assert.equal((await act(owner, "block_subject", A, S1, 1, S1)).reason, "own_network");
      assert.equal((await q("select count(*)::int n from inquiry_private.security_actions"))[0].n, 0, "refusals write nothing");

      const created = await act(owner, "block_subject", A, S1, 2, S3);
      assert.equal(created.result, "created");
      const [action] = await q("select * from inquiry_private.security_actions");
      assert.deepEqual([action.kind, action.subject, action.reason, action.incident_id, action.created_by], ["block_subject", S1, "R3_non_staff_admin", A, owner]);
      assert.ok(action.expires_at - action.created_at <= 2 * 3600_000 + 1000);
      assert.equal((await incidents()).find((row) => row.id === A).status, "contained");

      // Gate: the blocked network, other networks, unattributed requests, and the emergency stop.
      assert.deepEqual(await gate(S1, "contact"), { blocked: true, paused: false, retryAfter: 3600 });
      assert.equal((await gate(S1, "login")).blocked, true);
      assert.equal((await gate(S1, "track")).blocked, true);
      assert.equal((await gate(S2, "contact")).blocked, false);
      assert.equal((await gate("-", "contact")).blocked, false);
      assert.equal((await gate(null, "contact")).blocked, false);
      assert.deepEqual(await gate(S1, "contact", true), { blocked: false, paused: false });
      await rejects(as("service_role", "select public.security_gate($1,'admin')", [S1]), "22023");
      await rejects(as("service_role", "select public.security_gate($1,null)", [S1]), "22023");

      // Pause applies to the contact form only, and only one at a time.
      assert.equal((await act(owner, "pause_contact", B, null, 1)).result, "created");
      assert.equal((await gate(S2, "contact")).paused, true);
      assert.equal((await gate(S2, "login")).paused, false);
      assert.equal((await gate(S2, "track")).paused, false);
      assert.equal((await act(owner, "pause_contact", B, null, 1)).reason, "already_active");
      assert.equal((await gate(S2, "contact", true)).paused, false);

      // Lifting works for the owner only, once, and stays possible while the emergency stop is on.
      const pauseId = (await q("select id from inquiry_private.security_actions where kind = 'pause_contact'"))[0].id;
      await rejects(as("service_role", "select public.security_lift_action($1, $2)", [staffer, pauseId]), "42501");
      assert.equal((await service("select public.security_lift_action($1,$2) r", [owner, pauseId])).result, "lifted");
      assert.equal((await service("select public.security_lift_action($1,$2) r", [owner, pauseId])).result, "not_active");
      assert.equal((await service("select public.security_lift_action($1,$2) r", [owner, 999999])).result, "not_active");
      assert.equal((await gate(S2, "contact")).paused, false);

      // Expiry ends a block without anyone lifting it.
      await q("update inquiry_private.security_actions set created_at = now() - interval '3 hours', expires_at = now() - interval '1 minute' where kind = 'block_subject'");
      assert.equal((await gate(S1, "contact")).blocked, false);
      assert.equal((await service("select public.security_lift_action($1,$2) r", [owner, action.id])).result, "not_active");
    });

    await t.test("limits: 20 active blocks and 20 actions an hour; a closed incident takes no new action", async () => {
      await reset();
      await events("staff_denied", S1, 2);
      await events("staff_denied", S2, 2);
      await detect();
      const [A, B] = (await incidents()).map((row) => row.id);
      await q("insert into inquiry_private.security_actions (kind, subject, reason, incident_id, created_by, expires_at) select 'block_subject', md5(g::text) || md5((g + 500)::text), 'R3_non_staff_admin', $1, $2, now() + interval '1 hour' from generate_series(1, 20) g", [A, owner]);
      const subjectOfA = (await q("select subject from inquiry_private.security_incidents where id = $1", [A]))[0].subject;
      assert.equal((await act(owner, "block_subject", A, subjectOfA)).reason, "too_many_blocks");
      await q("update inquiry_private.security_actions set lifted_at = now() where lifted_at is null");
      assert.equal((await act(owner, "pause_contact", B, null)).reason, "rate_limited");
      await q("update inquiry_private.security_actions set created_at = now() - interval '3 hours', expires_at = now() - interval '2 hours'");
      assert.equal((await act(owner, "pause_contact", B, null)).result, "created");

      await q("update inquiry_private.security_incidents set status = 'resolved' where id = $1", [A]);
      assert.equal((await act(owner, "block_subject", A, subjectOfA)).reason, "incident_not_active");
    });

    await t.test("status changes: owner only, validated, and a reopen that would duplicate a live incident is a conflict", async () => {
      await reset();
      await events("staff_denied", S1, 2);
      await detect();
      const [A] = await incidents();
      for (const who of [staffer, randomUUID()]) await rejects(as("service_role", "select public.security_set_status($1,$2,'resolved')", [who, A.id]), "42501");
      await rejects(as("service_role", "select public.security_set_status($1,$2,'deleted')", [owner, A.id]), "22023");
      await rejects(as("service_role", "select public.security_set_status($1,$2,null)", [owner, A.id]), "22023");
      assert.equal((await service("select public.security_set_status($1,'INC-20000101-0001','resolved') r", [owner])).result, "not_found");
      for (const status of ["investigating", "false_positive", "resolved"]) {
        assert.equal((await service("select public.security_set_status($1,$2,$3) r", [owner, A.id, status])).result, "updated");
      }
      await q("update inquiry_private.security_incidents set last_seen = now() - interval '10 minutes'");
      await detect();
      assert.equal((await incidents()).filter((row) => row.status === "open").length, 1);
      assert.equal((await service("select public.security_set_status($1,$2,'open') r", [owner, A.id])).result, "conflict");
      assert.equal((await incidents()).find((row) => row.id === A.id).status, "resolved");
    });

    await t.test("incident read: newest first, bounded, with actions, no event rows or addresses", async () => {
      await reset();
      await events("staff_denied", S1, 2);
      await events("login_failed", S2, 11);
      await detect();
      const [first] = await incidents();
      await act(owner, "block_subject", first.id, first.subject, 1);
      const all = await service("select public.security_incidents_read() r");
      assert.equal(all.length, 2);
      assert.ok(all[0].created_at >= all[1].created_at);
      for (const row of all) {
        assert.deepEqual(Object.keys(row).sort(), ["actions", "confidence", "created_at", "environment", "event_count", "evidence", "first_seen", "id", "last_seen",
          "rule", "schema_version", "severity", "status", "subject", "test", "updated_at"]);
      }
      assert.equal(all.find((row) => row.id === first.id).actions.length, 1);
      assert.deepEqual(Object.keys(all.find((row) => row.id === first.id).actions[0]).sort(), ["created_at", "expires_at", "id", "kind", "lifted_at"]);
      assert.equal((await service("select public.security_incidents_read($1) r", [first.id])).length, 1);
      assert.equal((await service("select public.security_incidents_read('INC-20000101-0001') r")).length, 0);
      assert.equal((await service("select public.security_incidents_read(null, 1) r")).length, 1);
      assert.equal((await service("select public.security_incidents_read(null, 0) r")).length, 1, "a limit below 1 is raised to 1");
    });

    await t.test("owner incident read: owner gets rows; a non-owner staff id and a non-staff id are refused", async () => {
      const read = (who) => service("select public.security_owner_incidents_read($1) r", [who]);
      assert.equal((await read(owner)).length, 2);
      await rejects(read(staffer), "42501");
      await rejects(read(randomUUID()), "42501");
    });

    await t.test("alerts: synthetic path, hourly budget per band, old incidents skipped, claimed once", async () => {
      await reset();
      assert.deepEqual((await detect(true, false)).alerts, []);
      const armed = await detect(true, true);
      assert.equal(armed.alerts.length, 1);
      assert.deepEqual([armed.alerts[0].rule, armed.alerts[0].severity, armed.alerts[0].test, armed.alerts[0].eventCount], ["R0_synthetic", "info", true, 0]);
      assert.deepEqual((await detect(false, true)).alerts, [], "claimed once");
      assert.equal((await detect(true, true)).alerts.length, 1, "a repeated test call re-arms its alert");
      assert.equal((await incidents()).length, 1);

      await reset();
      await q("insert into inquiry_private.security_alert_log (band, sent_at) select 'other', now() - interval '5 minutes' from generate_series(1, 10)");
      await q("insert into inquiry_private.security_alert_log (band, sent_at) values ('other', now() - interval '2 days')");
      await events("staff_denied", S1, 2);
      await events("login_failed", S2, 11);
      const result = await detect(false, true);
      assert.deepEqual(result.alerts.map((a) => a.rule), ["R1_password_guessing"], "the high band has its own budget");
      assert.equal((await q("select count(*)::int n from inquiry_private.security_alert_log where sent_at < now() - interval '1 day'"))[0].n, 0);
      assert.equal((await q("select count(*)::int n from inquiry_private.security_incidents where alerted_at is null"))[0].n, 1);
      assert.deepEqual(Object.keys(result.alerts[0]).sort(), ["counts", "eventCount", "id", "rule", "severity", "test"]);
      assert.deepEqual(result.alerts[0].counts, { login_failed: 11 });

      await reset();
      await events("staff_denied", S1, 2);
      await detect();
      await q("update inquiry_private.security_incidents set created_at = now() - interval '3 hours'");
      assert.deepEqual((await detect(false, true)).alerts, [], "an incident older than two hours is not announced late");
    });

    await t.test("retention: old counts, old actions and closed incidents go; open and recent records stay; bounded and repeatable", async () => {
      await reset();
      await events("login_failed", S1, 1, 31 * 24 * 60);
      await events("login_failed", S2, 1, 29 * 24 * 60);
      const add = (id, status, subject, ageMonths, rule = "R3_non_staff_admin") => q(
        `insert into inquiry_private.security_incidents (id, environment, status, rule, severity, confidence, dedup_key, subject, first_seen, last_seen, event_count, evidence, created_at, updated_at)
         values ($1,'local',$2,$3,'medium','high',$3 || ':' || $4,$4,now(),now(),1,'{}'::jsonb, now() - make_interval(months => $5), now() - make_interval(months => $5))`,
        [id, status, rule, subject, ageMonths]);
      await add("INC-20250101-0001", "resolved", hex(51), 13);
      await add("INC-20250101-0002", "false_positive", hex(52), 13);
      await add("INC-20250101-0003", "open", hex(53), 13);
      await add("INC-20250101-0004", "resolved", hex(54), 11);
      await q("insert into inquiry_private.security_actions (kind, subject, reason, incident_id, created_by, created_at, expires_at) values ('block_subject', $1, 'R3_non_staff_admin', 'INC-20250101-0002', $2, now() - interval '13 months', now() - interval '13 months' + interval '1 hour')", [hex(52), owner]);
      await q("insert into inquiry_private.security_actions (kind, subject, reason, incident_id, created_by, created_at, expires_at) values ('pause_contact', null, 'R3_non_staff_admin', 'INC-20250101-0004', $1, now() - interval '11 months', now() - interval '11 months' + interval '1 hour')", [owner]);
      const small = await service("select public.run_retention(1) r");
      assert.equal(small.securityRecords, 3, "each step is bounded by the limit: 1 count, 1 action, 1 incident");
      const rest = await service("select public.run_retention(200) r");
      assert.equal(small.securityRecords + rest.securityRecords, 4);
      assert.deepEqual((await incidents()).map((row) => row.id), ["INC-20250101-0003", "INC-20250101-0004"]);
      assert.equal((await q("select count(*)::int n from inquiry_private.security_actions"))[0].n, 1);
      assert.equal((await q("select count(*)::int n from inquiry_private.security_event_counts"))[0].n, 1);
      assert.equal((await service("select public.run_retention(200) r")).securityRecords, 0);
      assert.deepEqual(Object.keys(rest).sort(), ["auditEvents", "securityRecords"]);
    });

    await t.test("ops snapshot: open high incidents and the age of the last run; null before any run", async () => {
      await reset();
      let snapshot = await service("select public.ops_snapshot() r");
      assert.equal(snapshot.securityHighOpen, 0);
      assert.equal(snapshot.securityLastRunSeconds, null);
      await events("login_failed", S1, 11);
      await detect();
      snapshot = await service("select public.ops_snapshot() r");
      assert.equal(snapshot.securityHighOpen, 1);
      assert.ok(snapshot.securityLastRunSeconds >= 0 && snapshot.securityLastRunSeconds < 30);
      await q("update inquiry_private.security_heartbeat set last_run = now() - interval '20 minutes'");
      assert.ok((await service("select public.ops_snapshot() r")).securityLastRunSeconds >= 1200);
      await q("update inquiry_private.security_incidents set status = 'resolved'");
      assert.equal((await service("select public.ops_snapshot() r")).securityHighOpen, 0);
      assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(S1));
    });

    await t.test("site-wide click cap: a third network is limited when the global cap is two; the old call still works", async () => {
      await q("delete from inquiry_private.rate_limit_hits");
      const check = (subject, limit = 100, global = 2) => service("select public.check_track_limit($1,$2,60,$3) r", [subject, limit, global]);
      assert.equal((await check(S1)).allowed, true);
      assert.equal((await check(S2)).allowed, true);
      const limited = await check(S3);
      assert.equal(limited.allowed, false);
      assert.ok(limited.retryAfter >= 1 && limited.retryAfter <= 60);
      assert.equal((await q("select count(*)::int n from inquiry_private.rate_limit_hits where bucket = 'track-all'"))[0].n, 1);
      for (const bad of [0, 1000001]) await rejects(as("service_role", "select public.check_track_limit($1,5,60,$2)", [S1, bad]), "22023");
      await q("delete from inquiry_private.rate_limit_hits");
      assert.equal((await service("select public.check_track_limit($1,5,60) r", [S1])).allowed, true);
      assert.equal((await q("select count(*)::int n from inquiry_private.rate_limit_hits where bucket = 'track-all'"))[0].n, 0, "no global cap without the argument");
      await rejects(q("insert into inquiry_private.rate_limit_hits values ('track-everything', now(), now() + interval '1 minute', 1)"), "23514");
    });
  } finally {
    if (admin) await admin.end();
    await cluster.stop();
    // Keep the uniquely generated, ignored fixture for diagnosis. No recursive deletion.
  }
});
