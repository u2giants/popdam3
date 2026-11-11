import { describe, expect, it } from "vitest";
import { deriveMetadataFromPath } from "./metadata-derivation.js";
import type { ServiceClient } from "./service-client.js";

// admin_config has no WORKFLOW_FOLDER_MAP override → default map is used.
const db = {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
} as unknown as ServiceClient;

const base = "Decor/Character Licensed/____New Structure/";

describe("deriveMetadataFromPath short folder names (#963)", () => {
  it("In Dev → in_development", async () => {
    expect((await deriveMetadataFromPath(base + "In Dev/Ross/f.psd", db)).workflow_status).toBe("in_development");
  });
  it("deepest match wins: In Dev/Cust Adopted → customer_adopted", async () => {
    const r = await deriveMetadataFromPath(base + "In Dev/Cust Adopted/Ross/2026/Wall/SKU/f.psd", db);
    expect(r).toEqual({ workflow_status: "customer_adopted", is_licensed: true });
  });
  it("long names unchanged", async () => {
    const r = await deriveMetadataFromPath(base + "In Development/Customer Adopted/Ross/Wall/f.psd", db);
    expect(r.workflow_status).toBe("customer_adopted");
  });
});
