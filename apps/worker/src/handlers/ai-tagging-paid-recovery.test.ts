import assert from "node:assert/strict";
import test from "node:test";
import { handleBulkAiTag } from "./ai-tagging.js";
import type { OpenRouterBatchJobState } from "../types.js";
import { accountFingerprint } from "../batch-provider.js";

test("saved artwork batch polls its original provider job", async () => {
  const prior = accountFingerprint("prior-key");
  const current = accountFingerprint("current-key");
  const scenarios: Array<{
    name: string;
    status: number;
    phase: OpenRouterBatchJobState["phase"];
    fp: string;
    fresh?: boolean;
    failures?: number;
    delay?: number;
    error?: string;
    providerStatus?: string;
  }> = [
    { name: "fresh 404", fresh: true, status: 404, phase: "pending", failures: 1, fp: prior, delay: 10_000 },
    { name: "transient 502", status: 502, phase: "pending", failures: 2, fp: prior, delay: 60_000 },
    { name: "different account", status: 404, phase: "pending", failures: 1, fp: prior, error: "credential_changed" },
    { name: "same-account rotation", status: 200, providerStatus: "processing", phase: "pending", fp: current, delay: 10_000 },
    { name: "restart completes original paid batch", status: 200, providerStatus: "completed", phase: "applying", failures: 1, fp: current },
    ...["failed", "cancelled", "expired"].map(providerStatus => ({name: providerStatus, status: 200, providerStatus, phase: "completed" as const, fp: current })),
  ];
  for (const scenario of scenarios) {
    const calls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/rest/v1/admin_config") && method === "GET") {
        const value = url.includes("AI_TASK_MODELS") ? { vision_tagging: "test/vision-model:batch" } : url.includes("OPENROUTER_API_KEY") ? "current-key" : null;
        if (value === null) return Response.json([]);
        return Response.json(new Headers(init?.headers).get("accept")?.includes("pgrst.object") ? { value } : [{ value }]);
      }
      calls.push(method + " " + url);
      assert.equal(calls.at(-1), "GET https://openrouter.ai/api/beta/batches/batch_saved");
      return Response.json(scenario.status === 200 ? {id: "batch_saved", status: scenario.providerStatus } : {error: "fixture"}, {status: scenario.status});
    };
    try {
      const external_job: OpenRouterBatchJobState = {
        version: 1, phase: "pending", provider: "openrouter", model: "test/vision-model:batch", output_method: "json_schema",
        provider_batch_id: "batch_saved", lease_token: "fixture-lease", page_cursor: 3, next_cursor: 4, scope: "asset",
        submitted_at: new Date(Date.now() - (scenario.fresh ? 5000 : 600_000)).toISOString(), transient_poll_failures: 1,
        account_fingerprint: prior,
        items: [{asset_id: "fixture-artwork", custom_id: "fixture-custom", status: "submitted"}],
      };
      const result = await handleBulkAiTag({status: "running", cursor: 3, run_id: "fixture", external_job} as any, false, { client: {rpc: async () => assert.fail("Unexpected DB write")} as any });
      const saved = result.external_job as OpenRouterBatchJobState | undefined;
      assert.ok(saved, scenario.name);
      assert.equal(result.ok, !scenario.error);
      assert.equal(result.error_code, scenario.error);
      assert.equal(saved.phase, scenario.phase);
      assert.equal(saved.provider_batch_id, "batch_saved");
      assert.equal(saved.lease_token, "fixture-lease");
      assert.equal(saved.account_fingerprint, scenario.fp);
      assert.equal(saved.transient_poll_failures, scenario.failures);
      assert.equal(calls.length, 1);
      if (scenario.delay) assert.ok(Date.parse(saved.next_poll_at!) - Date.now() >= scenario.delay - 1000);
      if (scenario.phase === "completed") {
        assert.equal(result.failed, 1);
        assert.equal(result.nextOffset, 4);
        assert.equal(saved.items?.[0].status, "failed_terminal");
      }
    } finally {
      globalThis.fetch = original;
    }
  }
});
