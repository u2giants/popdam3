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

  const result = await handleReprocessMetadata({ status: "running", cursor: 50 }, fakeFetch);
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
  const result = await handleReprocessMetadata({ status: "running", cursor: 0 }, fakeFetch);
  assert.equal(result.ok, false);
  assert.match(String(result.error), /statement timeout/);
});
