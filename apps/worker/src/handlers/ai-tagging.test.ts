import assert from "node:assert/strict";
import test from "node:test";
import { handleBulkAiTag, type AiTagRpcClient } from "./ai-tagging.js";

const IDS = [
  "123e4567-e89b-42d3-a456-426614174000",
  "223e4567-e89b-42d3-a456-426614174001",
];

type RpcResponse = { data: unknown; error: null | { message: string; code: string } };

function fakeClient(responses: RpcResponse[], calls: Array<Record<string, unknown>>): AiTagRpcClient {
  return {
    rpc: (async (name: string, params: Record<string, unknown>) => {
      assert.equal(name, "get_ai_tag_candidates");
      calls.push(params);
      const response = responses.shift();
      assert.ok(response, "unexpected RPC call");
      return response;
    }),
  };
}

function candidate(id: string, tier: number) {
  return {
    id,
    thumbnail_url: `https://example.invalid/${id}`,
    filename: `${id}.png`,
    relative_path: `/fixture/${id}.png`,
    style_group_id: null,
    primary_sort_tier: tier,
  };
}

test("empty candidate page completes without an exact count", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await handleBulkAiTag(
    { status: "running", cursor: 0 },
    false,
    { client: fakeClient([{ data: [], error: null }], calls), tagAsset: async () => ({ outcome: "tagged" }) },
  );

  assert.equal(result.ok, true);
  assert.equal(result.done, true);
  assert.equal(result.nextOffset, 0);
  assert.deepEqual(calls[0], {
    p_mode: "untagged",
    p_limit: 50,
    p_after_tier: null,
    p_after_id: null,
    p_group_ids: null,
  });
  assert.equal("total_count" in result, false);
});

test("cursor advances past the final candidate even when that asset fails", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await handleBulkAiTag(
    { status: "running", cursor: 0 },
    false,
    {
      client: fakeClient([{ data: [candidate(IDS[0], 1), candidate(IDS[1], 2)], error: null }], calls),
      tagAsset: async (id) => id === IDS[0] ? { outcome: "tagged" } : { outcome: "failed", error: "fixture failure" },
      concurrency: 2,
    },
  );

  assert.equal(result.done, false);
  assert.equal(result.tagged, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.nextOffset, `ai1:2:${IDS[1]}`);

  const nextCalls: Array<Record<string, unknown>> = [];
  const next = await handleBulkAiTag(
    { status: "running", cursor: result.nextOffset as string },
    false,
    { client: fakeClient([{ data: [], error: null }], nextCalls), tagAsset: async () => ({ outcome: "tagged" }) },
  );
  assert.equal(next.done, true);
  assert.equal(nextCalls[0].p_after_tier, 2);
  assert.equal(nextCalls[0].p_after_id, IDS[1]);
});

test("malformed and positive legacy cursors stop before querying", async () => {
  for (const cursor of ["bad-cursor", 60]) {
    const calls: Array<Record<string, unknown>> = [];
    const result = await handleBulkAiTag(
      { status: "running", cursor },
      false,
      { client: fakeClient([], calls), tagAsset: async () => ({ outcome: "tagged" }) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error_stage, "candidate_fetch");
    assert.equal(calls.length, 0);
  }
});

test("candidate timeout records its stage and reduces only after the first resume", async () => {
  const timeout = { data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } };
  const initial = await handleBulkAiTag(
    { status: "running", cursor: 0, auto_resume_attempts: 0 },
    false,
    { client: fakeClient([timeout], []), tagAsset: async () => ({ outcome: "tagged" }) },
  );
  assert.equal(initial.error_code, "statement_timeout");
  assert.equal(initial.error_stage, "candidate_fetch");
  assert.equal(initial.retry_page_size, 50);

  const resumed = await handleBulkAiTag(
    { status: "running", cursor: 0, auto_resume_attempts: 1 },
    false,
    { client: fakeClient([timeout], []), tagAsset: async () => ({ outcome: "tagged" }) },
  );
  assert.equal(resumed.retry_page_size, 25);
});

test("group-scoped mode passes all mode and explicit group IDs", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const groupId = "323e4567-e89b-42d3-a456-426614174002";
  await handleBulkAiTag(
    { status: "running", cursor: 0, params: { group_ids: [groupId] } },
    true,
    { client: fakeClient([{ data: [], error: null }], calls), tagAsset: async () => ({ outcome: "tagged" }) },
  );
  assert.equal(calls[0].p_mode, "all");
  assert.deepEqual(calls[0].p_group_ids, [groupId]);
});
