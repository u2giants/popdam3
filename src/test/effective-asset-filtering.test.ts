import { describe, expect, it, vi, beforeEach } from "vitest";
import { createClient } from "@supabase/supabase-js";

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
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
  },
}));

import {
  runEffectiveScopeQuery,
  buildEffectiveFilterPayload,
  buildAssetCountQuery,
  needsEffectiveScope,
  wouldNeedEffectiveScope,
  useAssets,
  useAssetCount,
  useFilterCounts,
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

describe("active grouped library requests", () => {
  function installClient(failCount = false) {
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "HEAD") return new Response(null, {
        status: failCount ? 500 : 206, headers: { "content-range": "0-0/401" },
      });
      return new Response(JSON.stringify([{ id: "a1", filename: "full.psd", relative_path: "art/full.psd", file_size: 123 }]), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });
    const client = createClient("https://example.supabase.co", "test-key", {
      global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
    });
    rpc.mockImplementation((...args) => (client.rpc as any)(...args));
    return fetch;
  }

  it("retains full page rows and exact totals while separating the requests", async () => {
    const fetch = installClient();
    const options = useAssets(filters({ tagFilter: "blue", stage: ["dev"], productCategory: ["Wall"] }), "modified_at", "desc", 1) as unknown as { queryFn: (context: { signal: AbortSignal }) => Promise<any> };
    const result = await options.queryFn({ signal: new AbortController().signal });
    expect(result).toEqual({ assets: [{ id: "a1", filename: "full.psd", relative_path: "art/full.psd", file_size: 123 }], totalCount: 401, pageSize: 200, page: 1 });
    const page = fetch.mock.calls.find(([, init]) => init?.method === "POST")!;
    const head = fetch.mock.calls.find(([, init]) => init?.method === "HEAD")!;
    const pageParams = new URL(String(page[0])).searchParams;
    const headParams = new URL(String(head[0])).searchParams;
    expect(pageParams.get("select")).toBeNull(); // Full RPC rows remain intact.
    expect(pageParams.get("offset")).toBe("200");
    expect(pageParams.get("limit")).toBe("200");
    expect(new Headers(page[1]?.headers).get("Prefer") ?? "").not.toContain("count=exact");
    for (const key of ["stage", "is_deleted", "or"]) expect(headParams.getAll(key)).toEqual(pageParams.getAll(key));
    expect(headParams.get("select")).toBe("id");
    expect(JSON.parse(String(page[1]?.body)).p_filters).toEqual({ tagFilter: "blue", productCategory: ["Wall"] });
    expect(JSON.parse(headParams.get("p_filters")!)).toEqual({ tagFilter: "blue", productCategory: ["Wall"] });
    expect(pageParams.getAll("or").join()).not.toContain("product_category");
  });

  it("finishes the visible page before starting the exact count", async () => {
    let releasePage!: () => void;
    const pageReleased = new Promise<void>((resolve) => { releasePage = resolve; });
    const methods: string[] = [];
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "POST") {
        await pageReleased;
        return new Response(JSON.stringify([{ id: "a1", filename: "full.psd", relative_path: "art/full.psd" }]), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(null, { status: 206, headers: { "content-range": "0-0/401" } });
    });
    const client = createClient("https://example.supabase.co", "test-key", {
      global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
    });
    rpc.mockImplementation((...args) => (client.rpc as any)(...args));
    const options = useAssets(filters({ tagFilter: "blue" }), "modified_at", "desc", 0) as unknown as { queryFn: (context: { signal: AbortSignal }) => Promise<any> };
    const result = options.queryFn({ signal: new AbortController().signal });
    await vi.waitFor(() => expect(methods).toEqual(["POST"]));
    releasePage();
    await expect(result).resolves.toMatchObject({ totalCount: 401 });
    expect(methods).toEqual(["POST", "HEAD"]);
  });

  it("serializes page, facets, and count for the effective scope", async () => {
    const requests: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const name = url.pathname.split("/").pop()!;
      const label = init?.method === "HEAD" ? "count" : name === "get_filter_counts" ? "facets" : "page";
      requests.push(`${label}:start`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      requests.push(`${label}:end`);
      if (label === "count") return new Response(null, { status: 206, headers: { "content-range": "0-0/401" } });
      if (label === "facets") return new Response(JSON.stringify({ total: 401 }), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify([{ id: "a1", filename: "full.psd", relative_path: "art/full.psd" }]), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    });
    const client = createClient("https://example.supabase.co", "test-key", {
      global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
    });
    rpc.mockImplementation((...args) => (client.rpc as any)(...args));
    const page = useAssets(filters({ tagFilter: "blue" }), "modified_at", "desc", 0) as unknown as { queryFn: (context: { signal: AbortSignal }) => Promise<any> };
    const facets = useFilterCounts(filters({ tagFilter: "blue" })) as unknown as { queryFn: (context: { signal: AbortSignal }) => Promise<any> };
    const [pageResult, facetResult] = await Promise.all([page.queryFn({ signal: new AbortController().signal }), facets.queryFn({ signal: new AbortController().signal })]);
    expect(pageResult.totalCount).toBe(401);
    expect(facetResult.total).toBe(401);
    expect(requests.filter((entry) => entry.endsWith(":start"))).toHaveLength(3);
    for (let i = 0; i < requests.length; i += 2) {
      expect(requests[i].replace(":start", "")).toBe(requests[i + 1].replace(":end", ""));
    }
    expect(requests.indexOf("count:start")).toBeGreaterThan(requests.indexOf("page:end"));
  });

  it("surfaces a failed total instead of reporting a false empty library", async () => {
    installClient(true);
    const options = useAssets(filters({ tagFilter: "blue" }), "modified_at", "desc", 0) as unknown as { queryFn: (context: { signal: AbortSignal }) => Promise<any> };
    await expect(options.queryFn({ signal: new AbortController().signal })).rejects.toBeTruthy();
  });

  it("uses the same narrow count for standalone library totals", async () => {
    const fetch = installClient();
    const options = useAssetCount(filters({ tagFilter: "blue" })) as unknown as { queryFn: (context: { signal: AbortSignal }) => Promise<number> };
    expect(await options.queryFn({ signal: new AbortController().signal })).toBe(401);
    expect(fetch.mock.calls).toHaveLength(1);
    expect(fetch.mock.calls[0][1]?.method).toBe("HEAD");
  });

  it("forwards category and file-status choices to facet counts", async () => {
    const response = Promise.resolve({ data: { total: 0 }, error: null });
    rpc.mockReturnValue(Object.assign(response, { abortSignal: () => response }));
    const options = useFilterCounts(filters({ tagFilter: "blue", productCategory: [" Wall ", "invalid"], fileStatus: ["has_preview"] })) as unknown as { queryFn: (context: { signal: AbortSignal }) => Promise<any> };
    await options.queryFn({ signal: new AbortController().signal });
    expect(rpc).toHaveBeenCalledWith("get_filter_counts", { p_filters: { tagFilter: "blue", productCategory: ["Wall"], fileStatus: ["has_preview"] } });
  });
});

describe("narrow exact counts preserve the library scope", () => {
  it("sends a real HEAD through the SDK, rather than a POST returning all IDs", async () => {
    const fetch = vi.fn(async () => new Response(null, {
      status: 206, headers: { "content-range": "0-0/27146" },
    }));
    const client = createClient("https://example.supabase.co", "test-key", {
      global: { fetch }, auth: { persistSession: false, autoRefreshToken: false },
    });
    rpc.mockImplementation((...args) => (client.rpc as any)(...args));
    const result = await buildAssetCountQuery(filters({ tagFilter: "blue" }), "2020-01-01", null, null, true);
    expect(result.count).toBe(27146);
    expect(result.data).toBeNull();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe("HEAD");
    expect(init.body).toBeUndefined();
    const params = new URL(url).searchParams;
    expect(JSON.parse(params.get("p_filters")!)).toEqual({ tagFilter: "blue" });
    expect(params.get("select")).toBe("id");
    expect(params.get("limit")).toBe("1");
    expect(params.get("is_deleted")).toBe("eq.false");
    expect(new Headers(init.headers).get("Prefer")).toContain("count=exact");
  });

  function queryRecorder() {
    const query: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ["select", "eq", "in", "or", "overlaps", "contains", "range"]) {
      query[method] = vi.fn(() => query);
    }
    rpc.mockReturnValue(query);
    from.mockReturnValue(query);
    return query;
  }

  it("uses an ID-only HEAD with exact count and keeps every additional filter", () => {
    const query = queryRecorder();
    const input = filters({
      tagFilter: "blue", licensorId: "l1", propertyId: "p1", search: "mug",
      stage: ["dev"], customer: "c1", program: "summer", fileType: ["psd"],
      contentType: ["product_photo"], productMaterial: ["cotton"], status: ["ready"],
      workflowStatus: ["approved"], isLicensed: true, assetType: ["artwork"],
      artSource: ["original"], productCategory: ["mug"], fileStatus: ["has_preview"],
    });
    buildAssetCountQuery(input, "2021-01-01", ["a1", "a2"], null, true);
    expect(rpc).toHaveBeenCalledWith("filter_effective_assets", {
      p_filters: JSON.stringify({ tagFilter: "blue", licensorId: "l1", propertyId: "p1" }),
    }, { head: true, count: "exact" });
    expect(query.select).toHaveBeenCalledWith("id");
    expect(query.range).toHaveBeenCalledWith(0, 0);
    expect(query.eq.mock.calls).toEqual([
      ["is_deleted", false], ["customer_id", "c1"], ["program", "summer"], ["is_licensed", true],
    ]);
    expect(query.in.mock.calls).toEqual([
      ["id", ["a1", "a2"]], ["stage", ["dev"]], ["file_type", ["psd"]],
      ["content_type", ["product_photo"]], ["status", ["ready"]],
      ["workflow_status", ["approved"]], ["asset_type", ["artwork"]], ["art_source", ["original"]],
    ]);
    expect(query.overlaps).toHaveBeenCalledWith("product_material", ["cotton"]);
    expect(query.contains).not.toHaveBeenCalled();
    expect(query.or).toHaveBeenCalledWith("thumbnail_url.not.is.null");
    expect(query.or).toHaveBeenCalledWith(
      "modified_at.gte.2021-01-01,file_created_at.gte.2021-01-01,thumbnail_url.not.is.null",
    );
  });

  it("retains keyword fallback and an empty search-result set", () => {
    const query = queryRecorder();
    buildAssetCountQuery(filters({ search: "mug", tagFilter: "blue" }), "2020-01-01", undefined, "filename.ilike.%cup%", true);
    expect(query.or).toHaveBeenCalledWith("filename.ilike.%cup%");
    buildAssetCountQuery(filters({ search: "mug" }), "2020-01-01", [], null, false);
    expect(query.in).toHaveBeenCalledWith("id", ["00000000-0000-0000-0000-000000000000"]);
  });

  it("keeps direct asset filters when the effective contract is not selected", () => {
    const query = queryRecorder();
    buildAssetCountQuery(filters({ tagFilter: "blue", licensorId: "l1", propertyId: "p1" }), "2020-01-01", null, null, false);
    expect(from).toHaveBeenCalledWith("assets");
    expect(query.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(query.eq).toHaveBeenCalledWith("licensor_id", "l1");
    expect(query.eq).toHaveBeenCalledWith("property_id", "p1");
    expect(query.contains).toHaveBeenCalledWith("tags", ["blue"]);
    expect(rpc).not.toHaveBeenCalled();
  });
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

describe("the qualified contract routes group-owned filters", () => {
  it("routes group-owned filters through filter_effective_assets", () => {
    expect(needsEffectiveScope(filters({ tagFilter: "drinkware" }))).toBe(true);
    expect(needsEffectiveScope(filters({ licensorId: "l1" }))).toBe(true);
    expect(needsEffectiveScope(filters({ propertyId: "p1" }))).toBe(true);
  });

  it("names the blocking issue next to the switch, so it cannot be flipped blind", async () => {
    const fs = await import("node:fs/promises");
    const source = await fs.readFile("src/hooks/useAssets.ts", "utf8");
    expect(source).toMatch(/EFFECTIVE_SCOPE_CONTRACT_READY = true/);
    expect(source).toMatch(/shared-db#2138/);
  });
});

describe("what is handed to the contract", () => {
  it("delegates only supported category choices with the existing path semantics", () => {
    expect(buildEffectiveFilterPayload(filters({ tagFilter: "blue", productCategory: [" Wall ", "invalid"] })))
      .toEqual({ tagFilter: "blue", productCategory: ["Wall"] });
  });
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

describe("successive filter changes do not queue obsolete effective-scope work", () => {
  it("skips a superseded query still waiting in the queue and runs the current one", async () => {
    let finishFirst!: () => void;
    const first = runEffectiveScopeQuery(() => new Promise<string>((resolve) => { finishFirst = () => resolve("first"); }));
    const staleController = new AbortController();
    const staleQuery = vi.fn(async () => "stale");
    const stale = runEffectiveScopeQuery(staleQuery, staleController.signal);
    const current = runEffectiveScopeQuery(async () => "current", new AbortController().signal);

    staleController.abort(); // React Query cancels the obsolete filter's query
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"));
    finishFirst();

    await expect(first).resolves.toBe("first");
    await expect(stale).rejects.toMatchObject({ name: "AbortError" });
    await expect(current).resolves.toBe("current");
    expect(staleQuery).not.toHaveBeenCalled();
  });

  it("never starts a query whose signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const query = vi.fn(async () => "never");
    await expect(runEffectiveScopeQuery(query, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(query).not.toHaveBeenCalled();
    await expect(runEffectiveScopeQuery(async () => "next")).resolves.toBe("next");
  });

  it("passes the cancellation signal into every queued page, count, and facet request", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/hooks/useAssets.ts", "utf8");
    expect(source.match(/runEffectiveScopeQuery\(/g)?.length).toBe(4); // page, count, standalone count, facets
    expect(source.match(/\.abortSignal\(signal\)/g)?.length).toBe(4);
  });
});
