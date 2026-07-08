import { describe, expect, it } from "vitest";
import { extractSkuFolder } from "../../supabase/functions/_shared/style-grouping";

describe("extractSkuFolder", () => {
  it("skips category folders and accepts digit-leading SKU folders", () => {
    expect(
      extractSkuFolder(
        "Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/B3M_3FZ - 3D Lenticular framed/13x19/Disney/3FZ93DYEC01/professional photos/3FZ93DYEC01_3-4 Side.psd",
      ),
    ).toBe("3FZ93DYEC01");
  });

  it("accepts shorter alphanumeric SKU folders used by legacy art", () => {
    expect(
      extractSkuFolder(
        "Decor/Character Licensed/____New Structure/Concept Approved Designs/WALL ART/B3M_3FZ - 3D Lenticular framed/23x31/Marvel/27W4AV4/PROFESSIONAL PHOTOS/27W4AV4 FRONT.psd",
      ),
    ).toBe("27W4AV4");
  });

  it("uses the outermost SKU folder when nested SKU-like subfolders exist", () => {
    expect(
      extractSkuFolder("Decor/Projects/AAE20DCBM01/AAE20DCBM01_SAMPLE_OLD/file.psd"),
    ).toBe("AAE20DCBM01");
  });
});
