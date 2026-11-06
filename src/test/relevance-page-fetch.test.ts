import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";

/**
 * Issue #470: a relevance-sorted search used to fetch up to 500 full rows per
 * page change and slice client-side. The ranked, fully-filtered ID list is now
 * resolved once (narrow id-only read, briefly cached) and each page change
 * fetches full rows for exactly its own slice, preserving the full-text rank
 * order and the exact totals.
 */

const mocks = vi.hoisted(() => ({ mode: vi.fn(), from: vi.fn(), rpc: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from, rpc: mocks.rpc },
}));
vi.mock("@/lib/dam-search", async (original) => ({
  ...await original<typeof import("@/lib/dam-search")>(),
  getSearchMode: mocks.mode,
}));

import { clearAssetRankedListCache, useAssets } from "@/hooks/useAssets";
import { clearStyleGroupRankedListCache, useStyleGroups } from "@/hooks/useStyleGroups";
import { defaultFilters } from "@/types/assets";

interface RecordedRequest {
  url: string;
  params: URLSearchParams;
}

function installClient(routes: {
  assetIds?: { id: string }[];
  assetRows?: Record<string, unknown>[];
  groupIds?: { id: string }[];
  groupRows?: Record<string, unknown>[];
  assetFullText?: { asset_id: string }[];
  groupFullText?: { style_group_id: string }[];
}) {
  const requests: RecordedRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url: url.pathname, params: url.searchParams });
    if (url.pathname.endsWith("rpc/search_assets_full_text")) {
      return new Response(JSON.stringify(routes.assetFullText ?? []), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("rpc/search_style_groups_full_text")) {
      return new Response(JSON.stringify(routes.groupFullText ?? []), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const select = url.searchParams.get("select") ?? "";
    if (url.pathname.endsWith("/assets")) {
      if (select === "id") {
        return new Response(JSON.stringify(routes.assetIds ?? []), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(matchRows(routes.assetRows ?? [], url.searchParams)), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/style_groups")) {
      if (select === "id") {
        return new Response(JSON.stringify(routes.groupIds ?? []), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify(matchRows(routes.groupRows ?? [], url.searchParams)), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const client = createClient("https://example.supabase.co", "test-key", {
    global: { fetch: fetchMock }, auth: { persistSession: false, autoRefreshToken: false },
  });
  mocks.rpc.mockImplementation((...args: unknown[]) => (client.rpc as any)(...args));
  mocks.from.mockImplementation((...args: unknown[]) => (client.from as any)(...args));
  return { requests };
}

/** PostgREST encodes `.in("id", [...])` as `id=in.("a1","a3")` — parse the wanted ids. */
function wantedIds(params: URLSearchParams): string[] {
  const raw = params.get("id") ?? "";
  if (!raw.startsWith("in.")) return [];
  return raw.slice(3).replace(/[()"]/g, "").split(",").filter(Boolean);
}

function matchRows(rows: Record<string, unknown>[], params: URLSearchParams): Record<string, unknown>[] {
  const wanted = wantedIds(params);
  return rows.filter((row) => wanted.includes(String(row.id)));
}

function requestedIds(params: URLSearchParams): Set<string> {
  return new Set(wantedIds(params));
}

function searchFilters(search: string) {
  return { ...defaultFilters, search };
}

function pageIdsOf(result: { assets?: { id: string }[]; groups?: { id: string }[] }): string[] {
  return (result.assets ?? result.groups ?? []).map((row) => row.id);
}

beforeEach(() => {
  vi.clearAllMocks();
  clearAssetRankedListCache();
  clearStyleGroupRankedListCache();
  mocks.mode.mockResolvedValue("keyword");
});

describe("relevance-sorted asset pages", () => {
  it("fetches only the page's rows in full-text rank order with exact totals", async () => {
    const { requests } = installClient({
      assetFullText: [{ asset_id: "a1" }, { asset_id: "a2" }, { asset_id: "a3" }, { asset_id: "a4" }],
      // a2 drops out of the filtered set (for example outside the visibility window).
      assetIds: [{ id: "a1" }, { id: "a3" }, { id: "a4" }],
      assetRows: [
        { id: "a3", filename: "third.psd" },
        { id: "a1", filename: "first.psd" },
        { id: "a4", filename: "fourth.psd" },
      ],
    });
    const idReads = () => requests.filter((r) => r.url.endsWith("/assets") && r.params.get("select") === "id");
    const pageReads = () => requests.filter((r) => r.url.endsWith("/assets") && r.params.get("select") === "*");

    const page0 = await (useAssets(searchFilters("mug"), "modified_at", "desc", 0, "2020-01-01", 2) as unknown as { queryFn: (c: { signal: AbortSignal }) => Promise<any> })
      .queryFn({ signal: new AbortController().signal });
    expect(pageIdsOf(page0)).toEqual(["a1", "a3"]);
    expect(page0.totalCount).toBe(3);

    expect(idReads()).toHaveLength(1);
    // The full-row read is bounded to the page slice, not the whole match set.
    expect(pageReads()).toHaveLength(1);
    expect(requestedIds(pageReads()[0].params)).toEqual(new Set(["a1", "a3"]));

    // A page change reuses the cached ranked list: only its own rows are read.
    const page1 = await (useAssets(searchFilters("mug"), "modified_at", "desc", 1, "2020-01-01", 2) as unknown as { queryFn: (c: { signal: AbortSignal }) => Promise<any> })
      .queryFn({ signal: new AbortController().signal });
    expect(pageIdsOf(page1)).toEqual(["a4"]);
    expect(page1.totalCount).toBe(3);
    expect(idReads()).toHaveLength(1);
    expect(pageReads()).toHaveLength(2);
    expect(requestedIds(pageReads()[1].params)).toEqual(new Set(["a4"]));
  });

  it("returns an empty page without a row read when the ranked list is exhausted", async () => {
    const { requests } = installClient({
      assetFullText: [{ asset_id: "a1" }],
      assetIds: [{ id: "a1" }],
      assetRows: [{ id: "a1", filename: "only.psd" }],
    });
    const page5 = await (useAssets(searchFilters("mug"), "modified_at", "desc", 5, "2020-01-01", 2) as unknown as { queryFn: (c: { signal: AbortSignal }) => Promise<any> })
      .queryFn({ signal: new AbortController().signal });
    expect(page5.assets).toEqual([]);
    expect(page5.totalCount).toBe(1);
    expect(requests.filter((r) => r.url.endsWith("/assets") && r.params.get("select") === "*")).toHaveLength(0);
  });
});

describe("relevance-sorted style-group pages", () => {
  it("fetches only the page's groups in full-text rank order with exact totals", async () => {
    const { requests } = installClient({
      groupFullText: [{ style_group_id: "g1" }, { style_group_id: "g2" }, { style_group_id: "g3" }],
      groupIds: [{ id: "g1" }, { id: "g2" }, { id: "g3" }],
      groupRows: [
        { id: "g3", sku: "C", asset_count: 2 },
        { id: "g1", sku: "A", asset_count: 1 },
        { id: "g2", sku: "B", asset_count: 1 },
      ],
    });
    const idReads = () => requests.filter((r) => r.url.endsWith("/style_groups") && r.params.get("select") === "id");
    const pageReads = () => requests.filter((r) => r.url.endsWith("/style_groups") && r.params.get("select") !== "id");

    const page0 = await (useStyleGroups(searchFilters("mug"), "modified_at", "desc", 0, 2, "2020-01-01") as unknown as { queryFn: (c: { signal: AbortSignal }) => Promise<any> })
      .queryFn({ signal: new AbortController().signal });
    expect(pageIdsOf(page0)).toEqual(["g1", "g2"]);
    expect(page0.totalCount).toBe(3);

    expect(idReads()).toHaveLength(1);
    expect(pageReads()).toHaveLength(1);
    expect(requestedIds(pageReads()[0].params)).toEqual(new Set(["g1", "g2"]));

    const page1 = await (useStyleGroups(searchFilters("mug"), "modified_at", "desc", 1, 2, "2020-01-01") as unknown as { queryFn: (c: { signal: AbortSignal }) => Promise<any> })
      .queryFn({ signal: new AbortController().signal });
    expect(pageIdsOf(page1)).toEqual(["g3"]);
    expect(page1.totalCount).toBe(3);
    expect(idReads()).toHaveLength(1);
    expect(pageReads()).toHaveLength(2);
    expect(requestedIds(pageReads()[1].params)).toEqual(new Set(["g3"]));
  });
});
