import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleShortenItemDescriptions, isStale, validateShortDescription, buildShortDescriptionMessages } from "./item-short-description.js";
import { setStraitlyApiKeyForTests } from "../provider-api-key.js";

describe("item short description", () => {
  it("trims and accepts a short label", () => {
    assert.equal(validateShortDescription({ short_description: '  "Snoopy Easter Plaque." ' }), "Snoopy Easter Plaque");
  });
  it("rejects empty or overlong output", () => {
    assert.throws(() => validateShortDescription({ short_description: "" }));
    assert.throws(() => validateShortDescription({ short_description: "x".repeat(41) }));
  });
  it("never treats a manual short description as stale", () => {
    assert.equal(isStale({ id: "a", item_description: "New", item_short_description_source: "manual", item_short_description_input: "Old" }), false);
  });
  it("is stale when the full description changed or was never shortened", () => {
    assert.equal(isStale({ id: "a", item_description: "New", item_short_description_source: "ai", item_short_description_input: "Old" }), true);
    assert.equal(isStale({ id: "a", item_description: "New", item_short_description_source: null, item_short_description_input: null }), true);
    assert.equal(isStale({ id: "a", item_description: "Same", item_short_description_source: "ai", item_short_description_input: "Same" }), false);
  });
  it("includes the full description in the prompt", () => {
    assert.match(JSON.stringify(buildShortDescriptionMessages("Peanuts MDF plaque")), /Peanuts MDF plaque/);
  });

  it("shortens with only the Straitly key and honors the model's capability override", async () => {
    const original = globalThis.fetch;
    const model = "vendor/straitly-only";
    const requests: Array<{ auth: string | null; body: Record<string, unknown> }> = [];
    const saved: unknown[] = [];
    setStraitlyApiKeyForTests("straitly-key");
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.host === "api.straitly.ai") {
        requests.push({ auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) });
        return Response.json({ choices: [{ message: { content: '{"short_description":"Peanuts Plaque"}' } }] });
      }
      if (url.pathname === "/rest/v1/admin_config") {
        switch (url.searchParams.get("key")) {
          case "eq.AI_TASK_MODELS": return Response.json([{ value: { text_classification: model } }]);
          case "eq.AI_MODEL_CAPABILITY_OVERRIDES": return Response.json([{ value: { [model]: { structured_outputs: false, tools: false } } }]);
        }
      }
      if (url.pathname === "/rest/v1/style_groups") {
        if (init?.method === "PATCH") {
          saved.push(JSON.parse(String(init.body)).item_short_description);
          return new Response(null, { status: 204 });
        }
        return Response.json([{ id: "a", item_description: "Peanuts MDF plaque", item_short_description_source: null }]);
      }
      assert.fail(`Unexpected request to ${url}`);
    };
    try {
      const result = await handleShortenItemDescriptions({ status: "running" });
      assert.equal(result.shortened, 1, JSON.stringify(result));
      assert.deepEqual(saved, ["Peanuts Plaque"]);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].auth, "Bearer straitly-key");
      assert.equal(requests[0].body.model, model);
      assert.deepEqual(requests[0].body.response_format, { type: "json_object" });
    } finally {
      globalThis.fetch = original;
      setStraitlyApiKeyForTests(null);
    }
  });
});
