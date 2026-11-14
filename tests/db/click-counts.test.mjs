import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { test } from "node:test";
import EmbeddedPostgres from "embedded-postgres";

// ADR-0003 click counts on a throw-away PostgreSQL with every migration. No DATABASE_URL is consumed.
const fixtureRoot = resolve(".local-db-tests");
mkdirSync(fixtureRoot, { recursive: true });
const databaseDir = mkdtempSync(join(fixtureRoot, "clicks-"));
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

async function connect(database = "clicks_test") {
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
const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code);
const subject = "a".repeat(64);

test("click counts on real PostgreSQL", { timeout: 120_000 }, async (t) => {
  let admin;
  try {
    await cluster.initialise();
    await cluster.start();
    const root = await connect("postgres");
    try {
      await root.query("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;");
    } finally { await root.end(); }
    await cluster.createDatabase("clicks_test");
    admin = await connect();
    await admin.query(migration);

    await t.test("record_click upserts one running total per day, target and language", async () => {
      for (const [target, lang] of [["book", "en"], ["book", "en"], ["book", "en"], ["book", "ru"], ["call", "en"], ["call", "ru"], ["call", "ru"]]) {
        await as("service_role", "select public.record_click($1,$2)", [target, lang]);
      }
      const rows = (await admin.query("select target, lang, count, day = (now() at time zone 'America/New_York')::date today from inquiry_private.click_counts order by target, lang")).rows;
      assert.deepEqual(rows, [
        { target: "book", lang: "en", count: 3, today: true }, { target: "book", lang: "ru", count: 1, today: true },
        { target: "call", lang: "en", count: 1, today: true }, { target: "call", lang: "ru", count: 2, today: true }]);
    });

    await t.test("record_click rejects anything outside the allowed lists, and the table has no other columns", async () => {
      for (const [target, lang] of [["email", "en"], ["book", "fr"], [null, "en"], ["book", null], ["BOOK", "en"]]) {
        await rejects(as("service_role", "select public.record_click($1,$2)", [target, lang]), "22023");
      }
      const columns = (await admin.query("select column_name from information_schema.columns where table_schema='inquiry_private' and table_name='click_counts' order by column_name")).rows;
      assert.deepEqual(columns.map((row) => row.column_name), ["count", "day", "lang", "target"]);
      await rejects(admin.query("insert into inquiry_private.click_counts values (current_date,'book','en',0)"), "23514");
    });

    await t.test("the server key can add a tap and read, but not write the table directly", async () => {
      assert.equal((await as("service_role", "select count(*)::int n from inquiry_private.click_counts"))[0].n, 4);
      await rejects(as("service_role", "insert into inquiry_private.click_counts values (current_date,'book','en',5)"), "42501");
      await rejects(as("service_role", "update inquiry_private.click_counts set count = 99"), "42501");
      await rejects(as("service_role", "delete from inquiry_private.click_counts"), "42501");
    });

    await t.test("anon and authenticated have no access, even with a forged staff claim; RLS holds without grants", async () => {
      const denied = await connect();
      try {
        for (const role of ["anon", "authenticated"]) {
          await denied.query(`set role ${role}`);
          await denied.query("select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"user_metadata\":{\"role\":\"owner\"}}', false)");
          await rejects(denied.query("select * from inquiry_private.click_counts"), "42501");
          await rejects(denied.query("delete from inquiry_private.click_counts"), "42501");
          await rejects(denied.query("select public.record_click('book','en')"), "42501");
          await rejects(denied.query("select public.check_track_limit($1,5,60)", [subject]), "42501");
          await rejects(denied.query("select public.staff_click_summary($1,3)", [randomUUID()]), "42501");
          await denied.query("reset role");
        }
      } finally { await denied.end(); }
      await admin.query("begin; grant usage on schema inquiry_private to authenticated; grant select on inquiry_private.click_counts to authenticated; set local role authenticated");
      assert.equal((await admin.query("select * from inquiry_private.click_counts")).rowCount, 0);
      await admin.query("rollback");
    });

    await t.test("the staff summary re-checks membership and returns months with zeros", async () => {
      const staff = randomUUID(), stranger = randomUUID();
      await admin.query("insert into inquiry_private.staff_members(user_id, role) values ($1,'staff')", [staff]);
      await rejects(as("service_role", "select public.staff_click_summary($1,3)", [stranger]), "42501");
      await rejects(as("service_role", "select public.staff_click_summary(null,3)"), "42501");
      for (const months of [0, 25, null]) await rejects(as("service_role", "select public.staff_click_summary($1,$2)", [staff, months]), "22023");

      const guest = { name: "Test Guest", email: "guest@example.invalid", phone: "", date: "", guests: "", message: "Synthetic request", kind: "contact", eventPackage: "" };
      const note = { sender: "Website <sender@example.invalid>", recipient: "staff@example.invalid", reply_to: guest.email, subject: "Synthetic", body: "Synthetic" };
      for (const input of [guest, guest, { ...guest, kind: "event", eventPackage: "Synthetic package" }]) {
        await as("service_role", "select public.record_contact_inquiry($1::jsonb,$2::uuid,$3::jsonb)", [input, randomUUID(), note]);
      }
      // A tap from a past month lands in that month's row, not this one's.
      await admin.query("insert into inquiry_private.click_counts values ((now() at time zone 'America/New_York')::date - 40, 'call', 'en', 7)");

      const rows = (await as("service_role", "select public.staff_click_summary($1,3) r", [staff]))[0].r;
      assert.equal(rows.length, 3);
      const month = (await admin.query("select to_char(now() at time zone 'America/New_York', 'YYYY-MM') m")).rows[0].m;
      assert.equal(rows[0].month, month);
      assert.deepEqual({ ...rows[0] }, { month, bookEn: 3, bookRu: 1, callEn: rows[0].callEn, callRu: 2, inquiries: 2, events: 1 });
      assert.ok(rows[0].callEn >= 1);
      assert.ok(rows[1].month < rows[0].month && rows[2].month < rows[1].month);
      assert.equal(rows.reduce((total, row) => total + row.callEn, 0), 8);
      assert.deepEqual(rows.slice(1).map((row) => [row.bookEn, row.inquiries, row.events]), [[0, 0, 0], [0, 0, 0]]);

      // Removing the membership stops access on the next call.
      await admin.query("delete from inquiry_private.staff_members where user_id=$1", [staff]);
      await rejects(as("service_role", "select public.staff_click_summary($1,3)", [staff]), "42501");
    });

    await t.test("the beacon limiter counts per network in its own bucket, rejects bad arguments and cleans expired rows", async () => {
      await admin.query("delete from inquiry_private.rate_limit_hits");
      const check = async (limit = 2) => (await as("service_role", "select public.check_track_limit($1,$2,60) r", [subject, limit]))[0].r;
      assert.equal((await check()).allowed, true);
      assert.equal((await check()).allowed, true);
      const limited = await check();
      assert.equal(limited.allowed, false);
      assert.ok(limited.retryAfter >= 1 && limited.retryAfter <= 60);
      assert.equal((await admin.query("select count(*)::int n from inquiry_private.rate_limit_hits where bucket = $1", ["track:" + subject])).rows[0].n, 1);
      assert.equal((await admin.query("select count(*)::int n from inquiry_private.rate_limit_hits where bucket in ($1,$2)", ["subject:" + subject, "login:" + subject])).rows[0].n, 0);
      for (const args of [["nothex", 5, 60], [subject, 0, 60], [subject, 5, 0], [subject, 5, 86401], [null, 5, 60]]) {
        await rejects(as("service_role", "select public.check_track_limit($1,$2,$3)", args), "22023");
      }
      await admin.query("insert into inquiry_private.rate_limit_hits values ($1, now() - interval '2 days', now() - interval '1 day', 9)", ["track:" + "b".repeat(64)]);
      await check(100);
      assert.equal((await admin.query("select count(*)::int n from inquiry_private.rate_limit_hits where expires_at <= now()")).rows[0].n, 0);
    });
  } finally {
    if (admin) await admin.end();
    await cluster.stop();
    // Keep the uniquely generated, ignored fixture for diagnosis. No recursive deletion.
  }
});
