import assert from "node:assert/strict";
import test from "node:test";
import { handleBulkAiTag, isRetryableStructuredOutputError, isVisualAnalysisUnavailableError, type AiTagRpcClient } from "./ai-tagging.js";

test("new executor aggregate errors retain same-model retry behavior", () => {
  assert.equal(isRetryableStructuredOutputError("Structured output failed: json_schema: no parsable JSON"), true);
  assert.equal(isRetryableStructuredOutputError("Structured output failed: data_inspection_failed"), false);
});

test("durable preparation classifies missing and inaccessible thumbnails as unavailable", () => {
  assert.equal(isVisualAnalysisUnavailableError(new Error("Asset has no thumbnail: fixture")), true);
  assert.equal(isVisualAnalysisUnavailableError(new Error("Thumbnail fetch HTTP 403")), true);
  assert.equal(isVisualAnalysisUnavailableError(new Error("Thumbnail fetch HTTP 404")), true);
  assert.equal(isVisualAnalysisUnavailableError(new Error("Thumbnail fetch HTTP 500")), false);
});

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

test("explicit asset pages checkpoint and resume the remaining IDs without discovery", async () => {
  const ids = Array.from({ length: 23 }, (_, i) => `123e4567-e89b-42d3-a456-${String(i).padStart(12, "0")}`);
  const calls: Array<Record<string, unknown>> = [];
  const processed: string[] = [];
  const dependencies = {
    client: fakeClient([], calls),
    batchSize: 10,
    concurrency: 2,
    tagAsset: async (id: string) => {
      processed.push(id);
      return { outcome: "tagged" as const };
    },
  };
  const first = await handleBulkAiTag({ status: "running", cursor: 0, params: { asset_ids: ids } }, false, dependencies);
  assert.equal(first.done, false);
  assert.equal(first.tagged, 10);
  assert.equal(first.nextOffset, 10);
  assert.deepEqual(processed, ids.slice(0, 10));

  const second = await handleBulkAiTag({ status: "running", cursor: first.nextOffset, params: { asset_ids: ids } }, false, dependencies);
  assert.equal(second.done, false);
  assert.equal(second.tagged, 10);
  assert.equal(second.nextOffset, 20);

  const final = await handleBulkAiTag({ status: "running", cursor: second.nextOffset, params: { asset_ids: ids } }, false, dependencies);
  assert.equal(final.done, true);
  assert.equal(final.tagged, 3);
  assert.equal(final.nextOffset, 23);
  assert.deepEqual(processed, ids);
  assert.equal(calls.length, 0);
});

test("explicit asset pages stop at fifty and reject invalid cursors before tagging", async () => {
  let processed = 0;
  const ids = Array.from({ length: 60 }, (_, i) => `123e4567-e89b-42d3-a456-${String(i).padStart(12, "0")}`);
  const dependencies = {
    client: fakeClient([], []), batchSize: 500,
    tagAsset: async () => { processed++; return { outcome: "tagged" as const }; },
  };
  const page = await handleBulkAiTag({ status: "running", params: { asset_ids: ids } }, false, dependencies);
  assert.equal(processed, 50);
  assert.equal(page.nextOffset, 50);
  assert.equal(page.done, false);
  for (const cursor of [-1, 0.5, "ai1:1:fixture", Number.NaN, 61]) {
    const rejected = await handleBulkAiTag({ status: "running", cursor, params: { asset_ids: ids } }, false, dependencies);
    assert.equal(rejected.ok, false);
    assert.equal(processed, 50);
  }
});

test("single-asset forced tagging keeps its exact scope and finishes in one page", async () => {
  const processed: string[] = [];
  const result = await handleBulkAiTag(
    { status: "running", cursor: 0, params: { asset_ids: [IDS[0]] } }, true,
    {
      client: fakeClient([], []),
      tagAsset: async (id, force) => {
        assert.equal(force, true);
        processed.push(id);
        return { outcome: "tagged" };
      },
    }, true,
  );
  assert.deepEqual(processed, [IDS[0]]);
  assert.equal(result.done, true);
  assert.equal(result.tagged, 1);
  assert.equal(result.nextOffset, 1);
});

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

test("required asset scope fails closed before querying the whole library", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await handleBulkAiTag(
    { status: "running" },
    true,
    { client: fakeClient([], calls), tagAsset: async () => ({ outcome: "tagged" }) },
    true,
  );

  assert.equal(result.ok, false);
  assert.equal(result.done, true);
  assert.match(result.error ?? "", /no asset ID/i);
  assert.equal(calls.length, 0);
});

test("no-preview assets are counted as visual analysis unavailable, not failed or tagged", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await handleBulkAiTag(
    { status: "running", cursor: 0 },
    false,
    {
      client: fakeClient([{ data: [candidate(IDS[0], 1)], error: null }], calls),
      tagAsset: async () => ({ outcome: "visual_analysis_unavailable", error: "No thumbnail URL" }),
    },
  );

  assert.equal(result.tagged, 0);
  assert.equal(result.failed, 0);
  assert.equal(result.visual_analysis_unavailable, 1);
  assert.match((result.skip_samples as Array<{ reason: string }>)[0].reason, /unavailable/i);
});

test("invalid structured data receives only the existing bounded same-model retry classification", () => {
  assert.equal(isRetryableStructuredOutputError("Structured output failed: json_schema: Model returned invalid structured tag data: every asset tag confidence must be between 0 and 1"), true);
  assert.equal(isRetryableStructuredOutputError("DB write failed: invalid enum"), false);
  assert.equal(isRetryableStructuredOutputError("Structured output failed: data_inspection_failed: invalid structured tag data"), false);
});
