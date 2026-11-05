import assert from "node:assert/strict";
import { test } from "node:test";
import type { DB } from "../supabase.js";
import { handleEmbedSgSearch } from "./embed-sg-search.js";

test("reports coverage and never claims documents", async () => {
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => {
      calls.push(name);
      return { data: { pending_documents: 5, embedded_documents: 7 }, error: null };
    },
  } as unknown as DB;
  const result = await handleEmbedSgSearch({ status: "running" }, client);
  assert.deepEqual(calls, ["get_sg_search_embedding_status"]);
  assert.equal(result.done, true);
  assert.equal(result.embedded, 0);
  assert.equal(result.skipped, 5);
});
