import assert from "node:assert/strict";
import test from "node:test";
import { handleReprocessMetadata } from "./metadata-reprocess.js";

test("reprocess metadata resumes from its cursor and uses a bounded edge batch", async () => {
  let requestBody: Record<string, unknown> = {};
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({
      ok: true,
      done: false,
      nextOffset: 75,
      total: 25,
      updated: 4,
      unresolved_licensor: 2,
      unresolved_property: 3,
      grand_total: 100,
    }), { status: 200 });
  }) as typeof fetch;

  const result = await handleReprocessMetadata({ status: "running", cursor: 50 }, fakeFetch, "test-secret");
  assert.deepEqual(requestBody, {
    action: "reprocess-asset-metadata",
    offset: 50,
    batch_size: 25,
  });
  assert.deepEqual(result, {
    ok: true,
    done: false,
    nextOffset: 75,
    checked: 25,
    updated: 4,
    unresolved_licensor: 2,
    unresolved_property: 3,
    total_count: 100,
  });
});

test("reprocess metadata surfaces a database timeout for normal retry handling", async () => {
  const fakeFetch = (async () => new Response(
    JSON.stringify({ ok: false, error: "canceling statement due to statement timeout" }),
    { status: 500 },
  )) as typeof fetch;
  const result = await handleReprocessMetadata({ status: "running", cursor: 0 }, fakeFetch, "test-secret");
  assert.equal(result.ok, false);
  assert.match(String(result.error), /statement timeout/);
});

test("fill-missing-licensing mode keysets by asset id and forwards the UUID cursor", async () => {
  let requestBody: Record<string, unknown> = {};
  const next = "00000000-0000-4000-8000-000000000099";
  const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requestBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ ok: true, done: false, nextOffset: next, total: 25, updated: 20 }), { status: 200 });
  }) as typeof fetch;
  const cursor = "00000000-0000-4000-8000-000000000001";
  const result = await handleReprocessMetadata({ status: "running", cursor, params: { mode: "fill-missing-licensing" } }, fakeFetch, "k");
  assert.deepEqual(requestBody, { action: "reprocess-asset-metadata", mode: "fill-missing-licensing", after_id: cursor, batch_size: 25 });
  assert.equal(result.nextOffset, next);
  await handleReprocessMetadata({ status: "running", cursor: 0, params: { mode: "fill-missing-licensing" } }, fakeFetch, "k");
  assert.equal(requestBody.after_id, null);
});

test("standard mode refuses a keyset cursor instead of restarting at offset 0", async () => {
  let called = false;
  const fakeFetch = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  const result = await handleReprocessMetadata({ status: "running", cursor: "00000000-0000-4000-8000-000000000001" }, fakeFetch, "k");
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("unknown mode fails closed without calling the edge route", async () => {
  let called = false;
  const fakeFetch = (async () => { called = true; return new Response("{}"); }) as typeof fetch;
  const result = await handleReprocessMetadata({ status: "running", cursor: 0, params: { mode: "bogus" } }, fakeFetch, "k");
  assert.equal(result.ok, false);
  assert.equal(called, false);
});
