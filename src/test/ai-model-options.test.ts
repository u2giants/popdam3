import { describe, expect, it } from "vitest";
import { aiModelEndpoint, catalogWarningOf, includeCurrentModel, modelAllowedForTask, modelInPool, modelSelectorPresentation, normalizeAiModelPool, preserveCatalogOnWarning, sameAiModelPool, shouldLoadAiModelCatalog } from "@/lib/ai-model-options";
import { directGeminiBatchAllowedForServerConsumer, directGeminiBatchSelectionHasKey, safeSecretFingerprint, upsertConfigRowsAtomically, withValidatedCounterparts } from "../../supabase/functions/_shared/direct-batch-model";

describe("direct Gemini batch model scope", () => {
  const direct = "google-direct/gemini-3.8-flash:batch";

  it("allows only the Image Tagging primary selector", () => {
    expect(modelAllowedForTask(direct, "vision_tagging")).toBe(true);
    expect(modelAllowedForTask(direct, "vision_tagging", true)).toBe(false);
    expect(modelAllowedForTask(direct, "pdf_extraction")).toBe(false);
    expect(modelAllowedForTask(direct, "text_classification")).toBe(false);
  });

  it("does not change normal provider choices", () => {
    expect(modelAllowedForTask("google/gemini-3.7-flash", "pdf_extraction")).toBe(true);
  });

  it("keeps Meta Direct available to supported task routes and limits ScaleDown to PDF extraction", () => {
    const meta = "meta-direct/muse-spark-1.3-contributor";
    expect(modelAllowedForTask(meta, "vision_tagging")).toBe(true);
    expect(modelAllowedForTask(meta, "vision_tagging", true)).toBe(true);
    expect(modelAllowedForTask(meta, "text_classification")).toBe(true);
    expect(modelAllowedForTask(meta, "pdf_extraction")).toBe(true);
    expect(modelAllowedForTask("scaledown/summarize", "pdf_extraction")).toBe(true);
    expect(modelAllowedForTask(" scaledown/summarize ", "pdf_extraction")).toBe(true);
    expect(modelAllowedForTask("scaledown/summarize", "vision_tagging")).toBe(false);
    expect(modelAllowedForTask(" scaledown/summarize ", "vision_tagging")).toBe(false);
    expect(modelAllowedForTask("scaledown/summarize", "text_classification")).toBe(false);
    expect(modelAllowedForTask("scaledown/summarize", "pdf_extraction", true)).toBe(false);
  });

  it("is rejected server-side for bake-off and PDF but allowed for production tagging", () => {
    expect(directGeminiBatchAllowedForServerConsumer(direct, "vision_tagging_primary")).toBe(true);
    expect(directGeminiBatchAllowedForServerConsumer(direct, "bakeoff")).toBe(false);
    expect(directGeminiBatchAllowedForServerConsumer(direct, "pdf_extraction")).toBe(false);
  });

  it("requires a configured Google key in the server-side save contract", () => {
    expect(directGeminiBatchSelectionHasKey({ vision_tagging: direct }, "")).toBe(false);
    expect(directGeminiBatchSelectionHasKey({ vision_tagging: direct }, "google-key-present")).toBe(true);
    expect(directGeminiBatchSelectionHasKey({ vision_tagging: "openrouter/model" }, "")).toBe(true);
    expect(directGeminiBatchSelectionHasKey({ vision_tagging: `  ${direct} ` }, "")).toBe(false);
  });

  it("keeps the prior OpenRouter catalog when a warned refresh returns only direct options", () => {
    const previous = [{ id: "openrouter/vision" }, { id: direct }];
    const incoming = [{ id: direct }];
    expect(preserveCatalogOnWarning(previous, incoming, "OpenRouter catalog unavailable")).toEqual(previous);
    expect(preserveCatalogOnWarning(previous, incoming, null)).toEqual(incoming);
  });

  it("uses a stable non-secret account fingerprint for catalog caches", async () => {
    const first = await safeSecretFingerprint("account-key-one");
    const repeated = await safeSecretFingerprint("account-key-one");
    const rotated = await safeSecretFingerprint("account-key-two");
    expect(first).toBe(repeated);
    expect(first).not.toBe(rotated);
    expect(first).not.toContain("account-key-one");
  });

  it("keeps OpenRouter :batch variants out of fallback, bake-off and PDF selections too", () => {
    const openRouterBatch = "google/gemini-3.7-flash:batch";
    expect(modelAllowedForTask(openRouterBatch, "vision_tagging")).toBe(true);
    expect(modelAllowedForTask(openRouterBatch, "vision_tagging", true)).toBe(false);
    expect(modelAllowedForTask(openRouterBatch, "pdf_extraction")).toBe(false);
    expect(modelAllowedForTask(` ${openRouterBatch} `, "text_classification")).toBe(false);
    expect(directGeminiBatchAllowedForServerConsumer(openRouterBatch, "bakeoff")).toBe(false);
    expect(directGeminiBatchAllowedForServerConsumer(openRouterBatch, "pdf_extraction")).toBe(false);
    expect(directGeminiBatchAllowedForServerConsumer(openRouterBatch, "vision_tagging_fallback")).toBe(false);
    expect(directGeminiBatchAllowedForServerConsumer(openRouterBatch, "vision_tagging_primary")).toBe(true);
  });

  it("treats a catalog warning as a kept cached catalog, not an error", () => {
    const previous = [{ id: "openrouter/vision-a" }, { id: "openrouter/vision-b" }];
    const response = { models: [{ id: "openrouter/vision-a" }], catalog_warning: "OpenRouter catalog unavailable" };
    const warning = catalogWarningOf(response);
    expect(warning).toBe("OpenRouter catalog unavailable");
    expect(preserveCatalogOnWarning(previous, response.models, warning)).toEqual(previous);
    // First load with a warning still returns the server's cached catalog.
    expect(preserveCatalogOnWarning(undefined, response.models, warning)).toEqual(response.models);
    expect(catalogWarningOf({ models: [] })).toBeNull();
    expect(catalogWarningOf({ catalog_warning: "  " })).toBeNull();
  });

  it("writes a Direct Gemini selection and its Google key in one statement, so a failure applies neither", async () => {
    const calls: Array<Array<Record<string, unknown>>> = [];
    const rows = [{ key: "AI_TASK_MODELS", value: { vision_tagging: direct } }, { key: "GOOGLE_AI_API_KEY", value: "k" }];
    const failing = { from: () => ({ upsert: async (batch: Array<Record<string, unknown>>) => { calls.push(batch); return { error: { message: "boom" } }; } }) };
    const result = await upsertConfigRowsAtomically(failing, rows);
    expect(result.error?.message).toBe("boom");
    expect(calls).toHaveLength(1);
    expect(calls[0].map((row) => row.key)).toEqual(["AI_TASK_MODELS", "GOOGLE_AI_API_KEY"]);
  });

  it("refuses to clear the Google key while a stored Direct Gemini selection remains", () => {
    const stored = { vision_tagging: direct };
    expect(directGeminiBatchSelectionHasKey(stored, "")).toBe(false);
    expect(directGeminiBatchSelectionHasKey(stored, "   ")).toBe(false);
    expect(directGeminiBatchSelectionHasKey({ vision_tagging: "openrouter/model" }, "")).toBe(true);
  });

  it("rewrites the validated counterpart in the same statement so concurrent saves cannot mix", async () => {
    // Request A selects Direct Gemini after reading a present key; request B
    // clears the key after reading a non-Gemini model. Each writes its pair.
    const table: Record<string, unknown> = { AI_TASK_MODELS: { vision_tagging: "openrouter/m" }, GOOGLE_AI_API_KEY: "k" };
    const client = { from: () => ({ upsert: async (rows: Array<Record<string, unknown>>) => { for (const row of rows) table[row.key as string] = row.value; return { error: null }; } }) };
    const requestA = withValidatedCounterparts({ AI_TASK_MODELS: { vision_tagging: direct } }, { GOOGLE_AI_API_KEY: "k" });
    const requestB = withValidatedCounterparts({ GOOGLE_AI_API_KEY: "" }, { AI_TASK_MODELS: { vision_tagging: "openrouter/m" } });
    for (const order of [[requestA, requestB], [requestB, requestA]]) {
      for (const entries of order) await upsertConfigRowsAtomically(client, Object.entries(entries).map(([key, value]) => ({ key, value })));
      expect(directGeminiBatchSelectionHasKey(table.AI_TASK_MODELS, table.GOOGLE_AI_API_KEY)).toBe(true);
    }
    expect(withValidatedCounterparts({ A: 1 }, { A: 2, B: null })).toEqual({ A: 1 });
  });
});

describe("AI Model Pool", () => {
  it("chooses a dropdown, pool-empty status, or editable fallback for every selector state", () => {
    expect(modelSelectorPresentation(2, true, false)).toBe("select");
    expect(modelSelectorPresentation(1, false, true)).toBe("select");
    expect(modelSelectorPresentation(0, false, true)).toBe("pool-empty");
    expect(modelSelectorPresentation(0, false, false)).toBe("input");
    expect(modelSelectorPresentation(1, false, false)).toBe("input");
  });

  it("loads direct-provider choices after configuration is available without an OpenRouter key", () => {
    expect(shouldLoadAiModelCatalog(false, "", null)).toBe(false);
    expect(shouldLoadAiModelCatalog(true, "", null)).toBe(true);
    expect(shouldLoadAiModelCatalog(true, "openrouter-key", null)).toBe(false);
    expect(shouldLoadAiModelCatalog(true, "openrouter-key", "account-fingerprint")).toBe(true);
  });

  it("groups built-in models by their API endpoint", () => {
    expect(aiModelEndpoint("google-direct/gemini-3.8-flash:batch")).toBe("google-direct");
    expect(aiModelEndpoint("meta-direct/muse-spark-1.3-contributor")).toBe("meta-direct");
    expect(aiModelEndpoint("scaledown/summarize")).toBe("scaledown-direct");
    expect(aiModelEndpoint("anthropic/claude-haiku-4.5")).toBe("openrouter");
  });

  it("shows all models before an endpoint has a saved selection", () => {
    expect(modelInPool("openai/gpt-5", {})).toBe(true);
    expect(modelInPool("meta-direct/muse-spark-1.3-contributor", {})).toBe(true);
  });

  it("filters only the endpoint with an explicit model selection", () => {
    const pool = normalizeAiModelPool({ openrouter: ["anthropic/claude-haiku-4.5"] });
    expect(modelInPool("anthropic/claude-haiku-4.5", pool)).toBe(true);
    expect(modelInPool("openai/gpt-5", pool)).toBe(false);
    expect(modelInPool("google-direct/gemini-3.8-flash:batch", pool)).toBe(true);
  });

  it("treats an explicit empty endpoint selection as hiding every model", () => {
    const pool = normalizeAiModelPool({ openrouter: [] });
    expect(modelInPool("openai/gpt-5", pool)).toBe(false);
    expect(modelInPool("google-direct/gemini-3.8-flash:batch", pool)).toBe(true);
  });

  it("normalizes duplicate and invalid model IDs and compares endpoint selections", () => {
    const pool = normalizeAiModelPool({
      openrouter: ["b/model", "a/model", "a/model", 2],
      "future-endpoint": ["future/model"],
      future_metadata: { version: 1, options: { enabled: true } },
    });
    expect(pool).toEqual({
      openrouter: ["a/model", "b/model"],
      "future-endpoint": ["future/model"],
      future_metadata: { version: 1, options: { enabled: true } },
    });
    expect(sameAiModelPool(pool, {
      future_metadata: { options: { enabled: true }, version: 1 },
      "future-endpoint": ["future/model"],
      openrouter: ["b/model", "a/model"],
    })).toBe(true);
    expect(sameAiModelPool(pool, { openrouter: ["a/model"] })).toBe(false);
  });

  it("keeps a selected model visible while retaining the filtered catalog", () => {
    const selected = { id: "hidden/model", name: "Hidden model", supportsTools: true };
    const visible = [{ id: "visible/model", name: "Visible model", supportsTools: false }];
    const withCurrent = includeCurrentModel(visible, selected);
    expect(withCurrent).toEqual([selected, ...visible]);
    expect(withCurrent[0].supportsTools).toBe(true);
    expect(includeCurrentModel(visible, visible[0])).toEqual(visible);
  });
});

describe("system config attribution", () => {
  it("uses nullable system attribution while preserving ordinary users and atomic writes", async () => {
    const calls: Array<Array<Record<string, unknown>>> = [];
    const client = { from: (_table: "admin_config") => ({ upsert: async (rows: Array<Record<string, unknown>>) => { calls.push(rows); return { error: null }; } }) };
    const user = "123e4567-e89b-42d3-a456-426614174000";
    const rows = [{ key: "AI_TAG_PARALLEL_RUN", value: {enabled: false}, updated_by: "system" }, {key: "OTHER", value: "preserved", updated_by: user}];
    expect(await upsertConfigRowsAtomically(client, rows)).toEqual({error:null});
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toEqual({...rows[0],updated_by:null});
    expect(calls[0][1]).toEqual(rows[1]);
    expect(rows[0].updated_by).toBe("system");
    expect(calls[0][0].value).toEqual({enabled:false});
  });
});
