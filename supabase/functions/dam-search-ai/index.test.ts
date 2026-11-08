import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  handler: null as null | ((req: Request) => Promise<Response>),
  productCode: false,
  meaningful: true,
  corrected: null as string | null,
  rpc: vi.fn(),
  formatRpc: vi.fn(),
  authenticate: vi.fn(),
}));
vi.mock("../_shared/http.ts", () => ({
  corsServe: (handler: typeof state.handler) => {
    state.handler = handler;
  },
  err: (error: string, status: number) => Response.json({ error }, { status }),
  json: (body: unknown) => Response.json(body),
}));
vi.mock("../_shared/supabase-js.ts", () => ({ createClient: () => ({ rpc: state.rpc }) }));
vi.mock("../_shared/service-client.ts", () => ({
  serviceClient: () => ({
    rpc: (name: string, args: unknown) => ({ abortSignal: (signal: AbortSignal) => state.formatRpc(name, args, signal) }),
    from: () => ({
      select: () => ({
        eq: () =>
          Object.assign(Promise.resolve({ data: [] }), {
            maybeSingle: async () => ({ data: null, error: null }),
          }),
      }),
    }),
  }),
}));
vi.mock("../_shared/admin-auth.ts", () => ({ authenticateUser: state.authenticate }));
vi.mock("../_shared/product-code.ts", () => ({ isProductCodeSearch: async () => state.productCode }));
vi.mock("../_shared/search-spelling.ts", () => ({
  RARE_WORD_DOCS: 3,
  addNameToVocabulary: vi.fn(),
  checkSpelling: async () => ({ meaningful: state.meaningful, corrected: state.corrected }),
}));
await import("./index.ts");
const search = (query = "test phrase", signal?: AbortSignal, documentTypes?: string[]) =>
  state.handler!(
    new Request("https://example.invalid", {
      method: "POST",
      headers: { Authorization: "Bearer viewer", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "search", query, document_types: documentTypes }),
      signal,
    }),
  );

describe("DAM search embedding availability", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("Deno", { env: { get: () => "https://embed.invalid" } });
    state.productCode = false;
    state.meaningful = true;
    state.corrected = null;
    state.authenticate.mockResolvedValue({ ok: true, via: "user", userId: "viewer" });
    state.formatRpc.mockReset().mockResolvedValue({ data: false, error: null });
    state.rpc.mockReset().mockImplementation(async (name: string) => ({
      data: name === "dam_search_semantic_anchor" ? 0.5 : [],
      error: null,
    }));
  });

  it("retries a failed provider then returns unavailable before any keyword result", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const response = await search("retry provider");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Search unavailable" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("does not merge results when a corrected semantic variant cannot embed", async () => {
    state.corrected = "corrected phrase";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(Response.json({ ok: true, vector: Array(768).fill(0) }))
        .mockResolvedValue(new Response("unavailable", { status: 503 })),
    );
    expect((await search("corrected main")).status).toBe(503);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  for (const kind of ["catalog code", "nonsense"]) {
    it(`keeps intentional keyword behavior for ${kind}`, async () => {
      state.productCode = kind === "catalog code";
      state.meaningful = kind !== "nonsense";
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const response = await search(`keyword only ${kind}`);
      expect(response.status).toBe(200);
      // The speculative phase-0 embed fires while the checks run and its
      // result is discarded when the picture leg is off (#5747 reorder).
      expect(fetch).toHaveBeenCalled();
      expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_query_embedding: null }));
    });
  }

  it("a later successful attempt uses semantic ranking", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, vector: Array(768).fill(0) })));
    expect((await search("semantic ranking")).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("dam_search_semantic_anchor", expect.anything());
    expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_query_embedding: Array(768).fill(0) }));
  });

  it("denies an invalid viewer before embedding or searching", async () => {
    state.authenticate.mockResolvedValue({ ok: false });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await search()).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("keeps pictures for the settled unknown full-code example after a real format hint", async () => {
    state.meaningful = false;
    state.formatRpc.mockResolvedValue({ data: true, error: null });
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true, vector: Array(768).fill(0) }));
    vi.stubGlobal("fetch", fetch);
    expect((await search("ZZZ83MVSP99")).status).toBe(200);
    expect(state.formatRpc).toHaveBeenCalledWith("dam_catalog_code_format_exists", { p_format: "AAA99AAAA99" }, expect.any(AbortSignal));
    expect(fetch).toHaveBeenCalledOnce();
    expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_query: "ZZZ83MVSP99", p_query_embedding: Array(768).fill(0) }));
  });

  it("keeps known full codes and prefixes keyword-only without probing formats", async () => {
    state.productCode = true;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const query of ["VDD83MVSP01", "VDD83"]) expect((await search(query)).status).toBe(200);
    expect(state.formatRpc).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalled();
  });

  it("does not turn unsupported alternating nonsense into a picture query", async () => {
    state.meaningful = false;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await search("x7q9v2n8")).status).toBe(200);
    expect(state.formatRpc).toHaveBeenCalledOnce();
    expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_query_embedding: null }));
  });

  for (const result of [{ data: null, error: { message: "unavailable" } }, { data: null, error: null }, { data: "false", error: null }]) {
    it("returns unavailable before downstream search when the required hint fails", async () => {
      state.formatRpc.mockResolvedValue(result);
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const response = await search("ZZZ83MVSP99");
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Search unavailable" });
      expect(state.rpc).not.toHaveBeenCalled();
    });
  }

  it("cancels a pending hint when the actual Request is aborted and starts no downstream work", async () => {
    let begun!: () => void;
    const pending = new Promise<void>((resolve) => {
      begun = resolve;
    });
    let readerSignal!: AbortSignal;
    state.formatRpc.mockImplementation((_name, _args, signal) => {
      readerSignal = signal;
      begun();
      return new Promise(() => {});
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const response = search("ZZZ83MVSP99", controller.signal);
    await pending;
    controller.abort();
    expect((await response).status).toBe(503);
    expect(readerSignal.aborted).toBe(true);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("returns unavailable at the1000ms hint deadline before any downstream call", async () => {
    vi.useFakeTimers();
    state.formatRpc.mockImplementation(() => new Promise(() => {}));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = search("ZZZ83MVSP99");
    await vi.advanceTimersByTimeAsync(999);
    expect(state.formatRpc).toHaveBeenCalledOnce();
    expect(state.formatRpc.mock.calls[0][2].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await response).status).toBe(503);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("a late authenticated request retains only its original remaining30s budget", async () => {
    vi.useFakeTimers();
    state.authenticate.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ ok: true, via: "user", userId: "viewer" }), 29_700)));
    state.formatRpc.mockImplementation(() => new Promise(() => {}));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = search("ZZZ83MVSP99");
    await vi.advanceTimersByTimeAsync(29_999);
    expect(state.formatRpc).toHaveBeenCalledOnce();
    expect(state.formatRpc.mock.calls[0][2].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await response).status).toBe(503);
    expect(state.formatRpc.mock.calls[0][2].aborted).toBe(true);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  for (const scope of ["asset", "style_group"]) {
    it(`preserves the exact ${scope} scope while keeping unknown-code pictures`, async () => {
      state.meaningful = false;
      state.formatRpc.mockResolvedValue({ data: true, error: null });
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, vector: Array(768).fill(0) })));
      expect((await search("ZZZ83MVSP99", undefined, [scope])).status).toBe(200);
      expect(state.rpc).toHaveBeenCalledWith(
        "search_dam_documents",
        expect.objectContaining({ p_document_types: [scope], p_query: "ZZZ83MVSP99", p_query_embedding: Array(768).fill(0) }),
      );
    });
  }

  it("retains caller-scoped DAM permission failure rather than using the service client for search", async () => {
    state.formatRpc.mockResolvedValue({ data: true, error: null });
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, vector: Array(768).fill(0) })));
    expect((await search("ZZZ83MVSP99")).status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalledWith("dam_catalog_code_format_exists", expect.anything());
  });

  it("rides product-phrase variants in ONE batched text-embed call instead of one request each", async () => {
    const fetch = vi.fn(async (input: URL | RequestInfo) =>
      ({
        "/embed-text": () => Response.json({ ok: true, vector: Array(768).fill(1) }),
        "/embed-text-batch": () => Response.json({ ok: true, vectors: [Array(768).fill(2), Array(768).fill(3)] }),
      })[new URL(String(input)).pathname]!()
    );
    vi.stubGlobal("fetch", fetch);
    expect((await search("spiderman floor covering")).status).toBe(200);
    const batchCalls = fetch.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/embed-text-batch");
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0][1]?.body).toEqual(JSON.stringify({ texts: ["spiderman mat", "spiderman rug"] }));
    // Each variant's picture leg carries its own vector from the batch.
    expect(state.rpc).toHaveBeenCalledWith("dam_search_semantic_anchor", expect.objectContaining({ p_query_embedding: Array(768).fill(2) }));
    expect(state.rpc).toHaveBeenCalledWith("dam_search_semantic_anchor", expect.objectContaining({ p_query_embedding: Array(768).fill(3) }));
  });

  it("falls back to single-text embed calls while the service predates the batch endpoint", async () => {
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/embed-text-batch") return new Response("no such endpoint", { status: 404 });
      return Response.json({ ok: true, vector: Array(768).fill(1) });
    });
    vi.stubGlobal("fetch", fetch);
    expect((await search("batman floor covering")).status).toBe(200);
    expect(fetch.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/embed-text").length).toBe(3);
    expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_query: "batman mat" }));
  });

  it("returns unavailable when the batched variant embedding fails after its retry", async () => {
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      const pathname = new URL(String(input)).pathname;
      if (pathname === "/embed-text-batch") return new Response("unavailable", { status: 503 });
      return Response.json({ ok: true, vector: Array(768).fill(1) });
    });
    vi.stubGlobal("fetch", fetch);
    expect((await search("disney floor covering")).status).toBe(503);
    expect(fetch.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/embed-text-batch")).toHaveLength(2);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
