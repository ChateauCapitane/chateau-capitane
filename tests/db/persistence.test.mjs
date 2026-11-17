import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdirSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { test } from "node:test";
import EmbeddedPostgres from "embedded-postgres";

// No DATABASE_URL is consumed: this suite cannot reset a remote or existing database.
const fixtureRoot = resolve(".local-db-tests");
mkdirSync(fixtureRoot, { recursive: true });
const databaseDir = mkdtempSync(join(fixtureRoot, "run-"));
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
  // The note-cap race below opens 110 connections at once; the default limit is 100.
  postgresFlags: ["-h", "127.0.0.1", "-c", "max_connections=200"], onLog: () => {}, onError: () => {} });
const migration = readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort()
  .map((name) => readFileSync(join("supabase/migrations", name), "utf8")).join("\n");
async function connect(database = "inquiry_test") {
  const client = cluster.getPgClient(database, "127.0.0.1");
  await client.connect();
  return client;
}

async function asService(sql, values = []) {
  const client = await connect();
  try {
    await client.query("set role service_role");
    return (await client.query(sql, values)).rows;
  } finally { await client.end(); }
}
async function rejectsSql(client, sql, values, code) {
  await assert.rejects(client.query(sql, values), (error) => error.code === code);
}

test("real PostgreSQL persistence foundation", { timeout: 120_000 }, async (t) => {
  let admin;
  try {
    await cluster.initialise();
    await cluster.start();
    const root = await connect("postgres");
    try {
      await root.query("create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;");
    } finally { await root.end(); }
    await cluster.createDatabase("inquiry_test");
    admin = await connect();
    await admin.query(migration);

    await t.test("empty migrations rebuild cleanly and reconnect", async () => {
      await cluster.createDatabase("rebuild_test");
      const rebuilt = await connect("rebuild_test");
      try {
        await rebuilt.query(migration);
        assert.equal((await rebuilt.query("select count(*)::int n from inquiry_private.staff_members")).rows[0].n, 0);
      } finally { await rebuilt.end(); }
    });

    await t.test("ADR-0006: inquiry tables and functions are gone; staff, track, login, audit and ops still work", async () => {
      const gone = ["inquiries", "submission_keys", "notification_jobs", "delivery_events", "inquiry_notes", "job_delivery_status"];
      for (const name of gone) {
        assert.equal((await admin.query("select to_regclass($1) r", ["inquiry_private." + name])).rows[0].r, null, name);
      }
      const functions = ["record_contact_inquiry", "claim_notification_jobs", "complete_notification_job", "record_delivery_event",
        "check_contact_limit", "staff_list_inquiries", "staff_get_inquiry", "staff_set_inquiry_status", "staff_add_inquiry_note",
        "notification_summary", "delivery_rank", "protect_notification_payload", "is_calendar_date"];
      const left = (await admin.query("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'inquiry_private') and p.proname = any($1)", [functions])).rows;
      assert.deepEqual(left, []);
      assert.equal((await admin.query("select count(*)::int n from information_schema.columns where table_schema = 'inquiry_private' and table_name = 'audit_events' and column_name = 'inquiry_id'")).rows[0].n, 0);

      // Kept: roles come from the table, role changes are audited, login and track limits count.
      const owner = randomUUID();
      await admin.query("insert into inquiry_private.staff_members(user_id, role) values ($1,'owner')", [owner]);
      assert.equal((await asService("select public.staff_role($1) r", [owner]))[0].r, "owner");
      assert.equal((await admin.query("select count(*)::int n from inquiry_private.audit_events where action = 'role_granted' and subject_user = $1", [owner])).rows[0].n, 1);
      assert.equal((await asService("select public.check_login_limit($1,5,60) r", [randomBytes(32).toString("hex")]))[0].r.allowed, true);
      assert.equal((await asService("select public.check_track_limit($1,5,60) r", [randomBytes(32).toString("hex")]))[0].r.allowed, true);
      assert.equal((await asService("select public.record_click('call','en') r"))[0].r !== undefined, true);
      const months = (await asService("select public.staff_click_summary($1,2) r", [owner]))[0].r;
      assert.deepEqual(Object.keys(months[0]).sort(), ["bookEn", "bookRu", "callEn", "callRu", "month"]);
      await admin.query("delete from inquiry_private.staff_members where user_id=$1", [owner]);

      // Snapshot and retention no longer mention inquiries or mail, and still run.
      const snapshot = (await asService("select public.ops_snapshot() s"))[0].s;
      assert.deepEqual(Object.keys(snapshot).sort(), ["loginHitsNow", "securityHighOpen", "securityLastRunSeconds"]);
      assert.deepEqual((await asService("select public.run_retention(200) r"))[0].r, { auditEvents: 0, securityRecords: 0 });
      await rejectsSql(admin, "select public.run_retention(0)", [], "22023");
    });


    await t.test("staff: membership is read-only to the server; roles come from the table, never JWT metadata; login limits count", async () => {
      const owner = randomUUID(), staff = randomUUID(), stranger = randomUUID();
      await admin.query("insert into inquiry_private.staff_members(user_id, role) values ($1,'owner'),($2,'staff')", [owner, staff]);
      const role = async (id) => (await asService("select public.staff_role($1) r", [id]))[0].r;
      assert.equal(await role(owner), "owner");
      assert.equal(await role(staff), "staff");
      assert.equal(await role(stranger), null);
      await rejectsSql(admin, "insert into inquiry_private.staff_members values ($1,'editor')", [stranger], "23514");
      const server = await connect();
      try {
        await server.query("set role service_role");
        // Claimed metadata changes nothing: only table rows count.
        await server.query("select set_config('request.jwt.claims', $1, false)",
          [JSON.stringify({ sub: stranger, user_metadata: { role: "owner" }, app_metadata: { role: "owner" } })]);
        assert.equal((await server.query("select public.staff_role($1) r", [stranger])).rows[0].r, null);
        // No code path can grant, change or remove a role.
        await rejectsSql(server, "insert into inquiry_private.staff_members values ($1,'owner')", [stranger], "42501");
        await rejectsSql(server, "update inquiry_private.staff_members set role='owner' where user_id=$1", [staff], "42501");
        await rejectsSql(server, "delete from inquiry_private.staff_members where user_id=$1", [owner], "42501");
      } finally { await server.end(); }
      // Revocation is a row delete by the database owner; the next check sees it.
      await admin.query("delete from inquiry_private.staff_members where user_id=$1", [staff]);
      assert.equal(await role(staff), null);

      const login = async (subject, limit = 3) => (await asService("select public.check_login_limit($1,$2,900) r", [subject, limit]))[0].r;
      const subject = randomBytes(32).toString("hex");
      const results = await Promise.all(Array.from({ length: 6 }, () => login(subject)));
      assert.equal(results.filter((r) => r.allowed).length, 3);
      for (const r of results.filter((r) => !r.allowed)) assert.ok(r.retryAfter >= 1 && r.retryAfter <= 900);
      assert.equal((await login(randomBytes(32).toString("hex"))).allowed, true);
      // Login and contact counters never share a bucket.
      assert.equal((await admin.query("select count(*)::int n from inquiry_private.rate_limit_hits where bucket = $1", ["login:" + subject])).rows[0].n, 1);
      assert.equal((await admin.query("select count(*)::int n from inquiry_private.rate_limit_hits where bucket = $1", ["subject:" + subject])).rows[0].n, 0);
      for (const args of [["not-hex", 5, 60], [subject, 0, 60], [subject, 5, 0], [subject, 5, 90000]]) {
        await rejectsSql(admin, "select public.check_login_limit($1,$2,$3)", args, "22023");
      }
    });

    await t.test("content: drafts are versioned, concurrent saves detected, publication and rollback, staff-only writes", async () => {
      const staff = randomUUID(), revoked = randomUUID();
      await admin.query("insert into inquiry_private.staff_members(user_id, role) values ($1,'staff'),($2,'owner')", [staff, revoked]);
      const call = async (fn, args) => (await asService(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) r`, args))[0].r;
      const save = (base, document, who = staff) => call("staff_save_content_draft", [who, "editor@example.invalid", base, document]);
      const live = async () => (await asService("select public.published_content() r"))[0].r;
      const v1 = { menuNotes: ["first"] }, v2 = { menuNotes: ["second"] };

      assert.equal(await live(), null);
      assert.deepEqual((await call("staff_content_state", [staff])), { draft: null, publishedId: null, revisions: [], publications: [] });
      const first = await save(null, v1);
      assert.equal(first.kind, "saved");
      assert.equal((await save(null, v1)).kind, "stale");
      // Two editors loaded the same draft: exactly one save wins.
      const racing = await Promise.all([save(first.id, v2), save(first.id, { menuNotes: ["other"] })]);
      assert.deepEqual(racing.map((r) => r.kind).sort(), ["saved", "stale"]);
      const second = racing.find((r) => r.kind === "saved");
      const state = await call("staff_content_state", [staff]);
      assert.deepEqual([state.draft.id, state.publishedId, state.revisions.map((r) => r.id)], [second.id, null, [second.id, first.id]]);
      assert.equal(state.draft.author, "editor@example.invalid");

      // Drafts stay private until published; publishing an older revision rolls back.
      assert.equal(await live(), null);
      assert.deepEqual(await call("staff_publish_content", [staff, "editor@example.invalid", second.id]), { kind: "published" });
      assert.deepEqual(await live(), { revision: second.id, document: (await call("staff_content_revision", [staff, second.id])).document });
      assert.equal((await save(second.id, { menuNotes: ["draft only"] })).kind, "saved");
      assert.equal((await live()).revision, second.id);
      assert.equal((await call("staff_publish_content", [staff, "editor@example.invalid", first.id])).kind, "published");
      assert.deepEqual(await live(), { revision: first.id, document: v1 });
      assert.deepEqual((await call("staff_publish_content", [staff, "x", 999999])).kind, "not_found");
      assert.equal(await call("staff_content_revision", [staff, 999999]), null);
      const history = (await call("staff_content_state", [staff])).publications;
      assert.deepEqual(history.map((p) => [p.revision, p.by]), [[first.id, "editor@example.invalid"], [second.id, "editor@example.invalid"]]);

      // Shape and size bounds; only current staff can read or write; the server key cannot write tables directly.
      const head = (await call("staff_content_state", [staff])).draft.id;
      await assert.rejects(save(head, "[1, 2]"), (e) => e.code === "23514");
      await assert.rejects(save(head, { big: "x".repeat(262144) }), (e) => e.code === "23514");
      await admin.query("delete from inquiry_private.staff_members where user_id=$1", [revoked]);
      for (const [fn, args] of [["staff_content_state", [revoked]], ["staff_content_revision", [revoked, first.id]],
        ["staff_save_content_draft", [revoked, "x", head, v1]], ["staff_publish_content", [revoked, "x", second.id]],
        ["staff_publish_content", [null, "x", second.id]]]) {
        await assert.rejects(call(fn, args), (e) => e.code === "42501");
      }
      assert.equal((await live()).revision, first.id);
      const server = await connect();
      try {
        await server.query("set role service_role");
        await rejectsSql(server, "insert into inquiry_private.content_revisions(document, author_id, author_email) values ('{}', $1, 'x')", [staff], "42501");
        await rejectsSql(server, "insert into inquiry_private.content_publications(revision_id, publisher_id, publisher_email) values ($1, $2, 'x')", [first.id, staff], "42501");
        await rejectsSql(server, "update inquiry_private.content_revisions set document='{}'", [], "42501");
        await rejectsSql(server, "delete from inquiry_private.content_publications", [], "42501");
      } finally { await server.end(); }
    });

    await t.test("media: photos are staff-only to add, private until a live version lists them, and well-formed", async () => {
      const staff = randomUUID(), revoked = randomUUID();
      await admin.query("insert into inquiry_private.staff_members(user_id, role) values ($1,'staff')", [staff]);
      const call = async (fn, args) => (await asService(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) r`, args))[0].r;
      const webp = (extra = "photo") => Buffer.concat([Buffer.from("RIFF"), Buffer.from([20, 0, 0, 0]), Buffer.from("WEBP"), Buffer.from(extra)]);
      const add = (data = webp(), date = "2026-03-02", url = "https://example.com/post/1", who = staff) =>
        call("staff_add_media", [who, "editor@example.invalid", data.toString("base64"), 1200, 800, date, url]);
      const published = (id) => call("published_media", [id]);
      const save = (document) => call("staff_content_state", [staff]).then((s) => call("staff_save_content_draft", [staff, "editor@example.invalid", s.draft?.id ?? null, document]));
      const publish = (id) => call("staff_publish_content", [staff, "editor@example.invalid", id]);
      const listing = (id) => ({ gallery: [{ id: "rooms", photos: [{ id: "p-1", media: id }, { id: "p-2", src: "/photos/a.jpg" }] }] });

      const photo = await add();
      assert.equal(photo.kind, "added");
      // Staff can read it; the public cannot, whether or not anything is published.
      assert.deepEqual(await call("staff_media", [staff, photo.id]), { type: "image/webp", data: webp().toString("base64") });
      assert.equal(await call("staff_media", [staff, randomUUID()]), null);
      assert.equal(await published(photo.id), null);
      const draft = await save(listing(photo.id));
      assert.equal(await published(photo.id), null);
      // Public once a live version lists it (the raw bytes round-trip); private again after rolling back.
      assert.equal((await publish(draft.id)).kind, "published");
      assert.deepEqual(await published(photo.id), { type: "image/webp", data: webp().toString("base64") });
      assert.equal(await published(randomUUID()), null);
      const other = await add(webp("other"));
      assert.equal(await published(other.id), null);
      const without = await save({ gallery: [{ id: "rooms", photos: [{ id: "p-2", src: "/photos/a.jpg" }] }] });
      assert.equal((await publish(without.id)).kind, "published");
      assert.equal(await published(photo.id), null);
      assert.equal((await publish(draft.id)).kind, "published");
      assert.notEqual(await published(photo.id), null);

      // Only well-formed WebP from 2026 on, with https sources; large or oversized rows are refused.
      for (const [data, date, url] of [[Buffer.from("<svg onload=alert(1)>"), "2026-03-02", null], [webp(), "2025-12-31", null],
        [webp(), "2026-03-02", "http://example.com/a"], [webp(), "2026-03-02", "https://exa mple.com"],
        [Buffer.concat([webp(), Buffer.alloc(2097152)]), "2026-03-02", null]]) {
        await assert.rejects(add(data, date, url), (e) => e.code === "23514");
      }
      await assert.rejects(call("staff_add_media", [staff, "x", "not base64!", 1200, 800, "2026-03-02", null]), (e) => e.code === "22023");
      await assert.rejects(call("staff_add_media", [staff, "x", webp().toString("base64"), 5000, 800, "2026-03-02", null]), (e) => e.code === "23514");

      // Only current staff; the server key cannot write or change assets directly.
      for (const [fn, args] of [["staff_media", [revoked, photo.id]], ["staff_add_media", [revoked, "x", webp().toString("base64"), 10, 10, "2026-03-02", null]],
        ["staff_add_media", [null, "x", webp().toString("base64"), 10, 10, "2026-03-02", null]]]) {
        await assert.rejects(call(fn, args), (e) => e.code === "42501");
      }
      const server = await connect();
      try {
        await server.query("set role service_role");
        await rejectsSql(server, "insert into inquiry_private.media_assets(content_type, data, width, height, source_date, uploader_id, uploader_email) values ('image/webp', 'x', 1, 1, '2026-01-01', $1, 'x')", [staff], "42501");
        await rejectsSql(server, "update inquiry_private.media_assets set data = '\\x00'", [], "42501");
        await rejectsSql(server, "delete from inquiry_private.media_assets", [], "42501");
      } finally { await server.end(); }

      // The library is capped at 500 photos.
      await admin.query("insert into inquiry_private.media_assets(content_type, data, width, height, source_date, uploader_id, uploader_email) select 'image/webp', $1, 1, 1, '2026-01-01', $2, 'bulk' from generate_series(1, 500)", [webp(), staff]);
      assert.deepEqual(await add(), { kind: "full" });
    });

    await t.test("anonymous, authenticated and claimed staff cannot read/write/invoke; RLS remains closed even with accidental read grants", async () => {
      const denied = await connect();
      try {
        for (const role of ["anon", "authenticated"]) {
          await denied.query(`set role ${role}`);
          await denied.query("select set_config('request.jwt.claims', '{\"role\":\"authenticated\",\"user_metadata\":{\"role\":\"owner\"}}', false)");
          for (const table of ["rate_limit_hits", "staff_members", "audit_events", "content_revisions", "content_publications", "media_assets"]) {
            await rejectsSql(denied, `select * from inquiry_private.${table}`, [], "42501");
            await rejectsSql(denied, `delete from inquiry_private.${table}`, [], "42501");
          }
          await rejectsSql(denied, "select public.staff_role($1)", [randomUUID()], "42501");
          await rejectsSql(denied, "select public.check_login_limit(repeat('a',64),5,60)", [], "42501");
          await rejectsSql(denied, "select public.ops_snapshot()", [], "42501");
          await rejectsSql(denied, "select public.run_retention(1)", [], "42501");
          await rejectsSql(denied, "select public.published_content()", [], "42501");
          await rejectsSql(denied, "select public.staff_content_state($1)", [randomUUID()], "42501");
          await rejectsSql(denied, "select public.staff_content_revision($1,1)", [randomUUID()], "42501");
          await rejectsSql(denied, "select public.staff_save_content_draft($1,'x',null,'{}')", [randomUUID()], "42501");
          await rejectsSql(denied, "select public.staff_publish_content($1,'x',1)", [randomUUID()], "42501");
          await rejectsSql(denied, "select public.published_media($1)", [randomUUID()], "42501");
          await rejectsSql(denied, "select public.staff_media($1,$1)", [randomUUID()], "42501");
          await rejectsSql(denied, "select public.staff_add_media($1,'x','AAAA',1,1,'2026-03-02',null)", [randomUUID()], "42501");
          await denied.query("reset role");
        }
        // Temporary test-only grants demonstrate RLS independently from missing privileges.
        await admin.query("begin; grant usage on schema inquiry_private to authenticated; grant select on all tables in schema inquiry_private to authenticated; set local role authenticated");
        for (const table of ["rate_limit_hits", "staff_members", "audit_events", "content_revisions", "content_publications", "media_assets"]) {
          assert.equal((await admin.query(`select * from inquiry_private.${table}`)).rowCount, 0);
        }
        await admin.query("rollback");
        await denied.query("set role service_role");
      } finally { await denied.end(); }
    });
  } finally {
    if (admin) await admin.end();
    await cluster.stop();
    // Keep the uniquely generated, ignored fixture for diagnosis. No recursive deletion.
  }
});
