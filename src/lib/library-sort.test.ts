import { describe, expect, it } from "vitest";
import { effectiveSortField } from "./library-sort";

describe("effectiveSortField", () => {
  it("defaults typed searches to Relevance", () => {
    expect(effectiveSortField(null, "marie frame")).toBe("relevance");
  });
  it("defaults browsing to Last modified", () => {
    expect(effectiveSortField(null, "  ")).toBe("modified_at");
  });
  it("keeps the user's choice", () => {
    expect(effectiveSortField("filename", "marie frame")).toBe("filename");
  });
});
