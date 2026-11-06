import { describe, expect, it } from "vitest";
import { changedFields } from "./changed-fields.js";

describe("changedFields", () => {
  const current = { a: 1, b: "x", tags: ["p", "q"], t: "2026-11-05T10:00:00+00:00", n: null };
  it("returns nothing for unchanged input", () => {
    expect(changedFields(current, { a: 1, b: "x", tags: ["p", "q"], t: "2026-11-05T10:00:00.000Z", n: undefined })).toEqual({});
  });
  it("returns only the changed field", () => {
    expect(changedFields(current, { a: 1, b: "y" })).toEqual({ b: "y" });
  });
  it("detects null/value and array differences", () => {
    expect(changedFields(current, { n: "v", tags: ["p"] })).toEqual({ n: "v", tags: ["p"] });
    expect(changedFields(current, { b: null })).toEqual({ b: null });
  });
  it("treats unknown columns and missing rows as changed", () => {
    expect(changedFields(current, { z: 1 })).toEqual({ z: 1 });
    expect(changedFields(null, { a: 1 })).toEqual({ a: 1 });
  });
});
