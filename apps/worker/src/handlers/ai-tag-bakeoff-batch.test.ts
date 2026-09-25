import assert from "node:assert/strict";
import test from "node:test";
import { handleAiTagBakeoff } from "./ai-tag-bakeoff.js";
import type { OpState } from "../types.js";

test("a bake-off with a batch-only model is marked failed, never left running", async () => {
  const patches: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const accept = new Headers(init?.headers).get("accept") ?? "";
    const reply = (row: unknown) => new Response(JSON.stringify(accept.includes("pgrst.object") ? row : (row ? [row] : [])), { status: 200, headers: { "content-type": "application/json" } });
    if (url.includes("/rest/v1/admin_config")) return reply(null); // no OpenRouter key: the batch-only refusal must not depend on it
    if (url.includes("/rest/v1/ai_tag_bakeoff_runs")) {
      if (method === "PATCH") {
        patches.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 204 });
      }
      return reply({ id: "run-1", model_a: "google-direct/gemini-3.8-flash:batch", model_b: "qwen/qwen3-vl-32b-instruct", model_c: null, model_d: null, model_e: null, asset_ids: ["a1"] });
    }
    return reply(null);
  }) as typeof fetch;
  try {
    const result = await handleAiTagBakeoff({ status: "running", cursor: 0, params: { run_id: "run-1" } } as unknown as OpState);
    assert.equal(result.ok, false);
    assert.match(String(result.error), /Batch-only models/);
    const statuses = patches.map((patch) => patch.status).filter(Boolean);
    assert.deepEqual(statuses, ["failed"], `saw ${JSON.stringify(patches)}`);
  } finally {
    globalThis.fetch = original;
  }
});
