import { describe, expect, it, vi } from "vitest";

const { db, updates } = vi.hoisted(() => {
  const updates: Record<string, unknown>[] = [];
  const asset = {
    id: "a1",
    relative_path: "Unlicensed/x.ai",
    filename: "x.ai",
    is_licensed: true,
    workflow_status: "other",
    licensor_id: "marvel",
    property_id: null,
    sku: null,
    file_created_at: null,
  };
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    range: () => chain,
    order: () => Promise.resolve({ data: [asset], error: null }),
    then: (res: (v: unknown) => void) => res({ count: 1, error: null }),
  });
  const db = {
    from: () => ({
      ...chain,
      update: (u: Record<string, unknown>) => (updates.push(u), { eq: async () => ({ error: null }) }),
    }),
  };
  return { db, updates };
});

vi.mock("../http.ts", () => ({ json: (b: unknown) => b, err: (m: string) => ({ error: m }) }));
vi.mock("../service-client.ts", () => ({ serviceClient: () => db }));
vi.mock("../sku-parser.ts", () => ({ parseSku: async () => null }));
vi.mock("../metadata-derivation.ts", () => ({ deriveMetadataFromPath: async () => ({ is_licensed: false, workflow_status: "other" }) }));
vi.mock("../licensing-resolution.ts", () => ({
  loadAuthoritativeLicensingMaps: async () => ({}),
  resolveAuthoritativeLicensing: async () => ({ is_licensed: true, licensor_id: "marvel", property_id: null }),
}));
import { handleReprocessAssetMetadata } from "./metadata-handlers.ts";

describe("full reprocess-metadata (#596)", () => {
  it("keeps the ERP is_licensed instead of reverting to the folder flag", async () => {
    const r = await handleReprocessAssetMetadata({});
    expect(r).toMatchObject({ ok: true, total: 1 });
    expect(updates.some((u) => "is_licensed" in u)).toBe(false);
  });
});
