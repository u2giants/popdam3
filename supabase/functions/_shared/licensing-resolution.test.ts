import { describe, expect, it } from "vitest";
import { type LicensingMaps, resolveAuthoritativeLicensing } from "./licensing-resolution.ts";

const parsed = (sku: string) => ({ sku, division_code: "CW001" }) as never;
const maps = (erp: { licensor_code: string | null; property_code: string | null }): LicensingMaps => ({
  erpByStyleAndDivision: new Map([["CW001|SKU1", { division_code: "CW001", ...erp }]]),
  licensorsBySourceId: new Map(),
  propertiesBySourceId: new Map(),
  licensorsByCode: new Map([["MV", { id: "marvel", name: "MARVEL" }]]),
  propertiesByLicensorAndCode: new Map([["marvel|SP", { id: "spidey", name: "SPIDER MAN" }]]),
});

describe("resolveAuthoritativeLicensing", () => {
  it("resolves licensor and property from taxonomy codes when the curated source map has no entry", async () => {
    const r = await resolveAuthoritativeLicensing(null as never, false, parsed("SKU1"), maps({ licensor_code: "MV", property_code: "SP" }));
    expect(r).toMatchObject({ is_licensed: true, licensor_id: "marvel", property_id: "spidey", property_name: "SPIDER MAN" });
  });

  it("lets ERP mark an item unlicensed even when the folder says licensed", async () => {
    const r = await resolveAuthoritativeLicensing(null as never, true, parsed("SKU1"), maps({ licensor_code: null, property_code: null }));
    expect(r).toMatchObject({ is_licensed: false, licensor_id: null, unresolved_licensor: false });
  });

  it("falls back to the folder rule only when ERP lacks the item", async () => {
    const r = await resolveAuthoritativeLicensing(null as never, false, parsed("OTHER"), maps({ licensor_code: "MV", property_code: "SP" }));
    expect(r.is_licensed ?? null).toBeNull();
    expect(r.licensor_id).toBeNull();
  });
});
