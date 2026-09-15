import { describe, expect, it } from "vitest";
import { talentLikenessFromFilename } from "./talent-likeness.ts";

describe("talentLikenessFromFilename", () => {
  it("reads explicit With Likeness naming as true", () => {
    expect(talentLikenessFromFilename("Marvel Studios' Thunderbolts - With Likeness.pdf")).toBe(true);
    expect(talentLikenessFromFilename("thunderbolts_with_likeness_01.ai")).toBe(true);
  });

  it("reads explicit No Likeness naming as false", () => {
    expect(talentLikenessFromFilename("Captain Marvel Movie - No Likeness.pdf")).toBe(false);
    expect(talentLikenessFromFilename("CAPTAIN-MARVEL-NO-LIKENESS.ai")).toBe(false);
  });

  it("leaves everything else null, never false", () => {
    expect(talentLikenessFromFilename("WICKED_ss26-glamityflair_comp_01.ai")).toBeNull();
    expect(talentLikenessFromFilename("Batman (non-talent likeness).ai")).toBeNull();
    expect(talentLikenessFromFilename("talent likeness.ai")).toBeNull();
    expect(talentLikenessFromFilename("With Likeness and No Likeness.pdf")).toBeNull();
    expect(talentLikenessFromFilename("")).toBeNull();
    expect(talentLikenessFromFilename(null)).toBeNull();
  });
});
