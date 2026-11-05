import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  handler: null as null | ((req: Request) => Promise<Response>),
  productCode: false,
  meaningful: true,
  corrected: null as string | null,
  rpc: vi.fn(),
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
vi.mock("../_shared/product-code.ts", async (original) => ({
  ...await original<typeof import("../_shared/product-code.ts")>(),
  isProductCodeSearch: async () => state.productCode,
}));
vi.mock("../_shared/search-spelling.ts", () => ({
  RARE_WORD_DOCS: 3,
  addNameToVocabulary: vi.fn(),
  checkSpelling: async () => ({ meaningful: state.meaningful, corrected: state.corrected }),
}));
await import("./index.ts");
const search = (query = "test phrase") =>
  state.handler!(
    new Request("https://example.invalid", {
      method: "POST",
      headers: { Authorization: "Bearer viewer", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "search", query }),
    }),
  );

describe("DAM search embedding availability", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal("Deno", { env: { get: () => "https://embed.invalid" } });
    state.productCode = false;
    state.meaningful = true;
    state.corrected = null;
    state.authenticate.mockResolvedValue({ ok: true, via: "user", userId: "viewer" });
    state.rpc.mockReset().mockImplementation(async (name: string) => ({
      data: name === "dam_search_semantic_anchor" ? 0.5 : [],
      error: null,
    }));
  });

  it("retries a failed provider then returns unavailable before any keyword result", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const response = await search();
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
    expect((await search()).status).toBe(503);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  for (const kind of ["catalog code", "nonsense"]) {
    it(`keeps intentional keyword behavior for ${kind}`, async () => {
      state.productCode = kind === "catalog code";
      state.meaningful = kind !== "nonsense";
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const response = await search();
      expect(response.status).toBe(200);
      expect(fetch).not.toHaveBeenCalled();
      expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_query_embedding: null }));
    });
  }

  it("a later successful attempt uses semantic ranking", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, vector: Array(768).fill(0) })));
    expect((await search()).status).toBe(200);
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
  it("keeps picture guesses for an unmatched catalog-shaped token", async () => {
    state.meaningful = false;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, vector: Array(768).fill(0) })));
    const response = await search("ABC12DEFG34");
    expect(response.status).toBe(200);
    expect((await response.json()).semantic).toBe("siglip2");
    expect(state.rpc).toHaveBeenCalledWith("dam_search_semantic_anchor", expect.anything());
  });

  it("does not call arbitrary alphanumeric nonsense an unknown product code", async () => {
    state.meaningful = false;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await search("xqz9vplm");
    expect(response.status).toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    expect((await response.json()).semantic).toBe("skipped");
  });
});
