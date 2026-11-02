import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ranked: vi.fn(), mode: vi.fn(), from: vi.fn(), rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock("@/lib/dam-search", async (original) => ({
  ...await original<typeof import("@/lib/dam-search")>(),
  getSearchMode: mocks.mode,
  fetchHybridSearchPage: mocks.ranked,
}));
import { useAssets, useAssetCount, useFilterCounts } from "@/hooks/useAssets";
import { useStyleGroups, useStyleGroupCount, useStyleGroupAssetCount } from "@/hooks/useStyleGroups";
import { defaultFilters } from "@/types/assets";

describe("DAM list/count/facet auth_denial_never_keyword_fallback", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.mode.mockResolvedValue("hybrid"); });
  const filters = { ...defaultFilters, search: "snowman" };
  it("keeps count queries enabled by default and lets the page disable its redundant probe", () => {
    expect(useStyleGroupCount(filters)).toMatchObject({ enabled: true });
    expect(useStyleGroupCount(filters, undefined, false)).toMatchObject({ enabled: false });
    expect(mocks.ranked).not.toHaveBeenCalled();
  });
  it.each([401, 403, 503])("propagates HTTP %s on every ranked query surface", async (status) => {
    const error = { context: new Response(null, { status }) };
    mocks.ranked.mockRejectedValue(error);
    mocks.invoke.mockResolvedValue({ data: null, error });
    const queries = [
      useAssets(filters, "relevance", "desc", 0),
      useAssetCount(filters),
      useFilterCounts(filters),
      useStyleGroups(filters, "relevance", "desc", 0),
      useStyleGroupCount(filters),
      useStyleGroupAssetCount(filters),
    ];
    for (const query of queries) {
      const options = query as unknown as { queryFn: (context: { signal: AbortSignal }) => Promise<unknown> };
      await expect(options.queryFn({ signal: new AbortController().signal })).rejects.toBe(error);
    }
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
