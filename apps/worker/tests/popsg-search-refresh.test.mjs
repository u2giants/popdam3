import test from "node:test";
import assert from "node:assert/strict";
import { refreshQueuedSearch } from "../src/handlers/popsg-search-refresh.ts";

test("retries a timeout, counts the final partial batch and drains new work next time", async () => {
  const sizes = [];
  const total = await refreshQueuedSearch(async size => {
    sizes.push(size);
    if (sizes.length === 1) return { data: null, error: { message: "statement timeout" } };
    const count = sizes.length === 2 ? size : 3;
    return { data: [{ search_documents_synced: count }], error: null };
  }, 4);
  assert.deepEqual(sizes, [1000, 500, 1000]);
  assert.equal(total, 503);
  assert.equal(await refreshQueuedSearch(async () => ({
    data: { search_documents_synced: 2 }, error: null,
  }), 1), 2);
});

test("surfaces database failures", async () => {
  await assert.rejects(refreshQueuedSearch(async () => ({
    data: null, error: { message: "permission denied" },
  }), 1), /permission denied/);
});
