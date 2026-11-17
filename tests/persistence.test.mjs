import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Script } from "node:vm";
import ts from "typescript";

const { outputText } = ts.transpileModule(readFileSync("src/lib/server/inquiries/persistence.ts", "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const context = { exports: {}, URL, TextDecoder, AbortController,
  setTimeout: (callback, delay) => setTimeout(callback, Math.min(delay, 25)), clearTimeout,
  require: (name) => { assert.equal(name, "server-only"); return {}; } };
new Script(outputText).runInNewContext(context);
const { getPersistenceConfiguration, callRpc } = context.exports;
const configuration = { url: "https://example.supabase.co", secretKey: "sb_secret_test" };

test("configuration rejects browser keys, insecure remote URLs and embedded credentials", () => {
  for (const env of [{}, { SUPABASE_URL: configuration.url, SUPABASE_SECRET_KEY: "sb_publishable_test" },
    { SUPABASE_URL: "http://remote.invalid", SUPABASE_SECRET_KEY: configuration.secretKey },
    { SUPABASE_URL: "https://user:pass@example.invalid", SUPABASE_SECRET_KEY: configuration.secretKey },
    { SUPABASE_URL: "https://example.invalid/path", SUPABASE_SECRET_KEY: configuration.secretKey }]) {
    assert.equal(getPersistenceConfiguration(env), null);
  }
  assert.equal(getPersistenceConfiguration({ SUPABASE_URL: configuration.url, SUPABASE_SECRET_KEY: configuration.secretKey }).url, configuration.url);
});

test("callRpc sends one no-store POST with the server key and returns the parsed reply", async () => {
  let calls = 0;
  const result = await callRpc(configuration, "some_function", { p_value: 1 }, 256, async (url, options) => {
    calls++;
    assert.equal(url, `${configuration.url}/rest/v1/rpc/some_function`);
    assert.equal(options.method, "POST");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.apikey, configuration.secretKey);
    assert.deepEqual(JSON.parse(options.body), { p_value: 1 });
    return Response.json({ ok: true });
  });
  assert.deepEqual({ ...result }, { ok: true });
  assert.equal(calls, 1);
});

test("provider errors and malformed or oversized replies give undefined, without retries", async () => {
  for (const response of [() => { throw new Error("sensitive provider detail"); },
    () => new Response("sensitive", { status: 500 }), () => new Response("x".repeat(2049)), () => new Response("not json")]) {
    let calls = 0;
    const result = await callRpc(configuration, "some_function", {}, 2048, async () => { calls++; return response(); });
    assert.equal(result, undefined);
    assert.equal(calls, 1);
  }
});

test("a stalled RPC aborts and returns undefined without resubmitting", async () => {
  let calls = 0;
  const result = await callRpc(configuration, "some_function", {}, 256, async (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  });
  assert.equal(result, undefined);
  assert.equal(calls, 1);
});
