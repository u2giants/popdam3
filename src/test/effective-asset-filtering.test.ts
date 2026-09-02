import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The library must filter and count by EFFECTIVE metadata — the union of what
 * the Style Group owns and what the file owns.
 *
 * A shared product tag lives only on `style_group_tags` and is deliberately
 * never copied onto members, so `assets.tags @>` structurally cannot see it.
 * Since legacy propagation was removed, `assets.licensor_id` / `property_id`
 * are null on grouped assets too. Both are resolved by the governed contract
 * `public.filter_effective_assets` (shared-db migration 20260830110517).
 */

const rpc = vi.fn();
const from = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

import {
  buildEffectiveFilterPayload,
  needsEffectiveScope,
  wouldNeedEffectiveScope,
} from "@/hooks/useAssets";
import type { AssetFilters } from "@/types/assets";

function filters(over: Partial<AssetFilters> = {}): AssetFilters {
  return {
    search: "",
    fileType: [],
    contentType: [],
    productMaterial: [],
    status: [],
    workflowStatus: [],
    isLicensed: null,
    licensorId: null,
    propertyId: null,
    assetType: [],
    artSource: [],
    productCategory: [],
    tagFilter: null,
    fileStatus: [],
    stage: [],
    customer: null,
    program: null,
    ...over,
  } as unknown as AssetFilters;
}

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
});

describe("which filters are group-owned", () => {
  it("recognises a tag filter as group-owned", () => {
    expect(wouldNeedEffectiveScope(filters({ tagFilter: "drinkware" }))).toBe(true);
  });

  it("recognises licensor and property filters as group-owned", () => {
    expect(wouldNeedEffectiveScope(filters({ licensorId: "l1" }))).toBe(true);
    expect(wouldNeedEffectiveScope(filters({ propertyId: "p1" }))).toBe(true);
  });

  it("leaves every other filter on the existing indexed path", () => {
    expect(wouldNeedEffectiveScope(filters())).toBe(false);
    expect(wouldNeedEffectiveScope(filters({ search: "mug", fileType: ["psd"], stage: ["dev"] }))).toBe(false);
    expect(wouldNeedEffectiveScope(filters({ contentType: ["product_photo"], isLicensed: true }))).toBe(false);
  });
});

describe("the contract is disabled until it meets its performance gate", () => {
  it("routes nothing through filter_effective_assets while the gate is off", () => {
    // Re-measured 2026-09-02: the identity count was fixed by shared-db#2054,
    // but filter_effective_assets now times out on EVERY call — five rows, no
    // filter, no count — and the tag facet count fails 8 times out of 8.
    // See shared-db#2138.
    expect(needsEffectiveScope(filters({ tagFilter: "drinkware" }))).toBe(false);
    expect(needsEffectiveScope(filters({ licensorId: "l1" }))).toBe(false);
    expect(needsEffectiveScope(filters({ propertyId: "p1" }))).toBe(false);
  });

  it("names the blocking issue next to the switch, so it cannot be flipped blind", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/hooks/useAssets.ts", "utf8");
    expect(source).toMatch(/EFFECTIVE_SCOPE_CONTRACT_READY = false/);
    expect(source).toMatch(/shared-db#2138/);
  });
});

describe("what is handed to the contract", () => {
  it("passes exactly the three group-owned filters and nothing else", () => {
    const payload = buildEffectiveFilterPayload(filters({
      tagFilter: "drinkware",
      licensorId: "l1",
      propertyId: "p1",
      search: "mug",
      fileType: ["psd"],
      stage: ["dev"],
      customer: "c1",
    }));
    expect(payload).toEqual({ tagFilter: "drinkware", licensorId: "l1", propertyId: "p1" });
  });

  it("omits absent filters rather than sending nulls the contract would reject", () => {
    expect(buildEffectiveFilterPayload(filters({ tagFilter: "floral" }))).toEqual({ tagFilter: "floral" });
    expect(buildEffectiveFilterPayload(filters())).toEqual({});
  });

  it("never hands the contract the app's own richer search", () => {
    // The contract's `search` is a plain filename ILIKE. The app resolves search
    // through full-text ids plus a multi-column fallback, so passing it here
    // would silently narrow results.
    const payload = buildEffectiveFilterPayload(filters({ search: "spiderman", tagFilter: "floral" }));
    expect(payload).not.toHaveProperty("search");
  });
});

describe("the source of truth is not re-imposed after the contract resolves it", () => {
  it("the hook file no longer filters group-owned facts against asset columns unconditionally", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/hooks/useAssets.ts", "utf8");

    // Each of the three must be guarded by the effective-scope flag; an
    // unguarded re-application would drop every grouped match.
    expect(source).toMatch(/!effectiveScopeApplied && filters\.tagFilter/);
    expect(source).toMatch(/!effectiveScopeApplied && filters\.licensorId/);
    expect(source).toMatch(/!effectiveScopeApplied && filters\.propertyId/);

    // And the contract is what the list starts from when they are active.
    expect(source).toMatch(/supabase\.rpc\(\s*"filter_effective_assets"/);
  });

  it("facet counts are left to the server, which delegates for the same scope", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/hooks/useAssets.ts", "utf8");
    // get_filter_counts itself delegates to get_effective_filter_counts, so a
    // second client-side branch here would be a parity risk, not a fix.
    expect(source).toMatch(/supabase\.rpc\("get_filter_counts"/);
    expect(source).not.toMatch(/rpc\("get_effective_filter_counts"/);
  });
});
