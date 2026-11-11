import { describe, expect, it } from "vitest";
import { abbreviate, suggestAssortmentDescription } from "@/lib/assortment-description";

describe("assortment item description suggestion", () => {
  it("names licensors, the shared product and size", () => {
    expect(
      suggestAssortmentDescription([
        { sku: "A", sheetDescription: "12X15 MOLD SHADOW BOX", itemDescription: "Molded Glass Shadowbox Hero", licensor: "MARVEL" },
        { sku: "B", sheetDescription: "12X15 MOLD SHADOW BOX", itemDescription: "Princess group Molded Shadowbox", licensor: "DISNEY" },
        { sku: "C", sheetDescription: "12X16 VACUUM ART", itemDescription: "Molded Shadowbox Art", licensor: "MARVEL" },
      ]),
    ).toBe('Marvel, Disney Molded Shadowbox 12x15"');
  });

  it("marks unlicensed styles as Generic and maps Warner DC titles to DC", () => {
    expect(
      suggestAssortmentDescription([
        { sku: "A", sheetDescription: "11X17 3D FRM BATMAN", itemDescription: "DC Batman Framed 3D Lenticular", licensor: "WARNER BROS" },
        { sku: "B", sheetDescription: "11X17 3D FRM X", itemDescription: null, licensor: null },
      ]),
    ).toBe('DC and Generic Framed 3D Lenticular 11x17"');
  });

  it("mixed products become an assortment and unlinked styles fall back to the sheet text", () => {
    expect(
      suggestAssortmentDescription([
        { sku: "A", sheetDescription: "13X19 CVS COMIC" },
        { sku: "B", sheetDescription: "13X19 GLS MARY" },
      ]),
    ).toBe('Generic Asst Canvas/Printed Glass 13x19"');
  });

  it("drops vowels only when over the 100-character limit", () => {
    const long = "Marvel, Disney, Strawberry Shortcake, Paramount, Sega, Warner Brothers, Hasbro Printed Glass Shadowbox 11x14\"";
    const out = abbreviate(long);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.startsWith("Mrvl, Dsny")).toBe(true);
    expect(abbreviate("Short 8x51")).toBe("Short 8x51");
  });
});
