import { describe, expect, it } from "vitest";
import { talentLikenessLabel } from "./talentLikenessLabel";

describe("talentLikenessLabel", () => {
  it("shows Yes / No / Unknown and never shows null as No", () => {
    expect(talentLikenessLabel(true)).toBe("Yes");
    expect(talentLikenessLabel(false)).toBe("No");
    expect(talentLikenessLabel(null)).toBe("Unknown");
    expect(talentLikenessLabel(undefined)).toBe("Unknown");
  });
});
