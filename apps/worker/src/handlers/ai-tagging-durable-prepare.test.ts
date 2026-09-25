import assert from "node:assert/strict";
import test from "node:test";
import { handleBulkAiTag, IMAGE_UNUSABLE_CATEGORY, type AiTagRpcClient } from "./ai-tagging.js";
import type { OpState } from "../types.js";

// Own file on purpose: getVisionModels() caches Settings per process, and these
// tests need the durable (":batch") model from the stubbed admin_config.
const BATCH_MODEL = "test/vision-model:batch";
const USABLE = "123e4567-e89b-42d3-a456-426614174000";
const NO_THUMB = "223e4567-e89b-42d3-a456-426614174001";
const NO_THUMB_2 = "323e4567-e89b-42d3-a456-426614174002";

function asset(id: string, thumbnail: string | null) {
  return {
    id, filename: `${id}.png`, relative_path: `/fixture/${id}.png`, file_type: "png", tags: [],
    licensor_id: null, property_id: null, thumbnail_url: thumbnail, status: "pending", ai_tagged_at: null,
    sku: null, division_code: null, style_group_id: null,
  };
}

const ASSETS: Record<string, ReturnType<typeof asset>> = {
  [USABLE]: asset(USABLE, "https://example.invalid/usable.png"),
  [NO_THUMB]: asset(NO_THUMB, null),
  [NO_THUMB_2]: asset(NO_THUMB_2, null),
};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function installFetch(posts: string[], settingsPin: () => string | null) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "POST" && !url.includes("/rest/v1/rpc/")) posts.push(url);
    const accept = new Headers(init?.headers).get("accept") ?? "";
    const one = (row: unknown) => json(accept.includes("pgrst.object") ? row : (row ? [row] : []));
    if (url.includes("/rest/v1/admin_config")) {
      if (url.includes("AI_TASK_MODELS")) {
        return one({ value: { vision_tagging: BATCH_MODEL, vision_tagging_provider: settingsPin() } });
      }
      if (url.includes("OPENROUTER_API_KEY")) return one({ value: "test-openrouter-key" });
      return one(null);
    }
    if (url.includes("/rest/v1/assets")) {
      const id = decodeURIComponent(url).match(/id=eq\.([0-9a-f-]{36})/)?.[1] ?? "";
      return one(ASSETS[id] ?? null);
    }
    if (url.includes("/rest/v1/")) return json([]);
    if (url.includes("openrouter.ai") && url.includes("models")) {
      return json({ data: [{ id: "test/vision-model", architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["structured_outputs", "response_format", "tools", "tool_choice"] }] });
    }
    return json({});
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

function candidateClient(ids: string[]): AiTagRpcClient {
  return {
    rpc: (async (name: string) => {
      assert.equal(name, "get_ai_tag_candidates");
      return { data: ids.map((id, index) => ({ id, filename: `${id}.png`, relative_path: `/fixture/${id}.png`, primary_sort_tier: index })), error: null };
    }),
  };
}

test("a page where every image is unusable records per-item failures and advances without any provider job", async () => {
  const posts: string[] = [];
  const restore = installFetch(posts, () => "anthropic");
  try {
    const result = await handleBulkAiTag(
      { status: "running", cursor: 0, run_id: "run1" } as OpState,
      false,
      { client: candidateClient([NO_THUMB, NO_THUMB_2]) },
    );
    assert.equal(result.ok, true);
    assert.equal(result.external_job, undefined, "no prepared/protected job may be created for an unusable page");
    assert.equal(result.state_transition, undefined, "no submission lease may be claimed");
    assert.equal(result.clear_external_job, undefined);
    assert.equal(result.failed, 2);
    assert.equal(result.image_unusable, 2);
    assert.equal(result.done, false, "the run continues with the next page");
    assert.notEqual(result.nextOffset, 0, "the cursor advances past the page");
    const samples = result.failure_samples as Array<{ asset_id: string; reason_category: string; error: string }>;
    assert.deepEqual(samples.map((sample) => sample.asset_id), [NO_THUMB, NO_THUMB_2]);
    assert.ok(samples.every((sample) => sample.reason_category === IMAGE_UNUSABLE_CATEGORY));
    assert.ok(samples.every((sample) => /no thumbnail/.test(sample.error)));
    assert.deepEqual(posts, [], "nothing is sent to a provider");
  } finally {
    restore();
  }
});

test("a mixed page prepares a job holding only usable items and records the rest as failures", async () => {
  const posts: string[] = [];
  const restore = installFetch(posts, () => "anthropic");
  try {
    const result = await handleBulkAiTag(
      { status: "running", cursor: 0, run_id: "run1" } as OpState,
      false,
      { client: candidateClient([USABLE, NO_THUMB]) },
    );
    const job = result.external_job as { phase: string; provider: string; model: string; provider_pin: string | null; items: Array<{ asset_id: string }> };
    assert.equal(job.phase, "prepared");
    assert.deepEqual(job.items.map((item) => item.asset_id), [USABLE]);
    assert.equal(job.provider, "openrouter");
    assert.equal(job.model, BATCH_MODEL);
    assert.equal(job.provider_pin, "anthropic", "the routing identity is saved with the batch");
    assert.equal(result.failed, 1);
    assert.equal((result.failure_samples as Array<{ asset_id: string }>)[0].asset_id, NO_THUMB);
    assert.deepEqual(posts, []);
  } finally {
    restore();
  }
});

test("an explicit asset list whose last page is unusable finishes the operation instead of stalling", async () => {
  const restore = installFetch([], () => "anthropic");
  try {
    const result = await handleBulkAiTag(
      { status: "running", cursor: 0, run_id: "run1", params: { asset_ids: [NO_THUMB] } } as unknown as OpState,
      true,
      { client: candidateClient([]) },
    );
    assert.equal(result.external_job, undefined);
    assert.equal(result.done, true);
    assert.equal(result.nextOffset, 1);
    assert.equal(result.failed, 1);
  } finally {
    restore();
  }
});
