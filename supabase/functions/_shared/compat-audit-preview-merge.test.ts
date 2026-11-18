import { describe, expect, it } from "vitest";
import { mergeCompatAuditFlagged } from "./compat-audit-preview-merge.ts";

const f = (id: string) => ({ id, thumbnail_url: `https://t/${id}`, relative_path: `p/${id}.ai` });

describe("mergeCompatAuditFlagged", () => {
  it("appends new batch flags to the stored list", () => {
    expect(mergeCompatAuditFlagged([f("a")], [f("b"), f("c")]).map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("starts from an empty list when nothing is stored yet", () => {
    expect(mergeCompatAuditFlagged(undefined, [f("a")]).map((e) => e.id)).toEqual(["a"]);
    expect(mergeCompatAuditFlagged(null, [])).toEqual([]);
  });

  it("does not duplicate an asset that is sent again (retry or full-list sender)", () => {
    const stored = [f("a"), f("b")];
    expect(mergeCompatAuditFlagged(stored, [f("a"), f("b"), f("c")]).map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(mergeCompatAuditFlagged(stored, [f("b")]).map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("ignores malformed entries", () => {
    expect(mergeCompatAuditFlagged("nope", [null, 3, { relative_path: "x" }, f("a")]).map((e) => e.id)).toEqual(["a"]);
  });
});
