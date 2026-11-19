import { describe, expect, it } from "vitest";
import { inheritedAiFields, provenSurvivingCopy, staleRetirementRefusal } from "./stale-asset-retirement.ts";

const base = { filename: "a.pdf", quick_hash: "h", file_size: 10, is_deleted: false };
const stale = { ...base, id: "1", relative_path: "old/a.pdf" };
const survivor = { ...base, id: "2", relative_path: "new/a.pdf" };

describe("staleRetirementRefusal", () => {
  it("allows a same-name, same-hash, same-size pair", () => {
    expect(staleRetirementRefusal(stale, survivor, "old/a.pdf")).toBeNull();
  });
  it.each([
    ["filename_mismatch", { filename: "b.pdf" }],
    ["hash_mismatch", { quick_hash: "x" }],
    ["size_mismatch", { file_size: 11 }],
    ["not_live", { is_deleted: true }],
  ])("refuses %s", (reason, change) => {
    expect(staleRetirementRefusal(stale, { ...survivor, ...change }, "old/a.pdf")).toBe(reason);
  });
  it("refuses 0-byte files, whose hash is constant", () => {
    expect(staleRetirementRefusal({ ...stale, file_size: 0 }, { ...survivor, file_size: 0 }, "old/a.pdf")).toBe("size_mismatch");
  });
  it("refuses when the record moved after the absence check", () => {
    expect(staleRetirementRefusal(stale, survivor, "older/a.pdf")).toBe("path_changed_since_check");
  });
});

describe("provenSurvivingCopy (#1198)", () => {
  it("returns the live record holding the same file", () => {
    expect(provenSurvivingCopy(stale, [survivor], "old/a.pdf")).toBe(survivor);
  });
  it("returns null when no other record shares the identity — the record keeps its place", () => {
    expect(provenSurvivingCopy(stale, [], "old/a.pdf")).toBeNull();
  });
  it("skips refusals and finds a later survivor", () => {
    const wrongName = { ...survivor, id: "3", relative_path: "other/b.pdf", filename: "b.pdf" };
    expect(provenSurvivingCopy(stale, [wrongName, survivor], "old/a.pdf")).toBe(survivor);
    expect(provenSurvivingCopy(stale, [wrongName], "old/a.pdf")).toBeNull();
  });
  it("never treats the record itself or a 0-byte look-alike as proof", () => {
    expect(provenSurvivingCopy(stale, [{ ...survivor, id: "1", relative_path: "old/a.pdf" }], "old/a.pdf")).toBeNull();
    expect(provenSurvivingCopy({ ...stale, file_size: 0, quick_hash: "h" }, [{ ...survivor, file_size: 0 }], "old/a.pdf")).toBeNull();
  });
});

describe("inheritedAiFields", () => {
  it("fills only what the survivor lacks", () => {
    expect(inheritedAiFields(
      { ai_description: "old", scene_description: "scene", tags: ["x"] },
      { ai_description: "mine", tags: [] },
    )).toEqual({ scene_description: "scene", tags: ["x"] });
  });
  it("carries tagged state only to an untagged survivor", () => {
    const tagged = { ai_tagged_at: "t", ai_model: "m", status: "tagged" };
    expect(inheritedAiFields(tagged, {})).toEqual(tagged);
    expect(inheritedAiFields(tagged, { ai_tagged_at: "s" })).toEqual({});
  });
});
