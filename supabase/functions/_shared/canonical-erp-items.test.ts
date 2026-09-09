import { describe, expect, it } from "vitest";
import { canonicalItemKey, predictionSourceId, rawMgFieldsFromCanonical } from "./canonical-erp-items.ts";

describe("canonical ERP item helpers", () => {
  it("keeps same-number items distinct by source and division", () => {
    expect(canonicalItemKey({ source_system: "coldlion", division_code: "CW001", source_id: "ABC123" }))
      .toBe("coldlion|CW001|ABC123");
    expect(canonicalItemKey({ source_system: "coldlion", division_code: "SP001", source_id: "ABC123" }))
      .toBe("coldlion|SP001|ABC123");
  });

  it("reads both canonical and legacy prediction identities", () => {
    expect(predictionSourceId("coldlion|CW001|ABC123")).toBe("ABC123");
    expect(predictionSourceId("ABC123")).toBe("ABC123");
  });

  it("rebuilds the raw MG context without exposing the source payload", () => {
    expect(rawMgFieldsFromCanonical({ mg_category: "Wall", mg01_code: "A", mg02_code: "B", mg03_code: null }))
      .toEqual({ mg_category: "Wall", mg01: "A", mg01_code: "A", mg02: "B", mg02_code: "B" });
  });
});
