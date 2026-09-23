import { describe, expect, it } from "vitest";
import { catalogWarningOf, modelAllowedForTask, preserveCatalogOnWarning } from "@/lib/ai-model-options";
import { directGeminiBatchAllowedForServerConsumer, directGeminiBatchSelectionHasKey, safeSecretFingerprint } from "../../supabase/functions/_shared/direct-batch-model";

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

  it("is rejected server-side for bake-off and PDF but allowed for production tagging", () => {
    expect(directGeminiBatchAllowedForServerConsumer(direct, "vision_tagging_primary")).toBe(true);
    expect(directGeminiBatchAllowedForServerConsumer(direct, "bakeoff")).toBe(false);
    expect(directGeminiBatchAllowedForServerConsumer(direct, "pdf_extraction")).toBe(false);
  });

  it("requires a configured Google key in the server-side save contract", () => {
    expect(directGeminiBatchSelectionHasKey({ vision_tagging: direct }, "")).toBe(false);
    expect(directGeminiBatchSelectionHasKey({ vision_tagging: direct }, "google-key-present")).toBe(true);
    expect(directGeminiBatchSelectionHasKey({ vision_tagging: "openrouter/model" }, "")).toBe(true);
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
});
