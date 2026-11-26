import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  handler: null as null | ((req: Request) => Promise<Response>),
  productCode: false,
  meaningful: true,
  corrected: null as string | null,
  rpc: vi.fn(),
  formatRpc: vi.fn(),
  namesRpc: vi.fn(),
  authenticate: vi.fn(),
  licensors: [] as { id: string; name: string }[],
  aliases: [] as { licensor_id: string; alias: string }[],
  characters: [] as { id: string; name: string }[],
  characterAliases: [] as { character_id: string; alias: string }[],
  legacyCharacters: [] as { id: string; name: string }[],
  properties: [] as { id: string; name: string }[],
  links: [] as { property_id: string; character_id: string }[],
  config: [] as { key: string; value: unknown }[],
  configError: null as null | { message: string },
  spellingCalls: 0,
  countWords: [] as string[],
  keyCountError: null as null | { message: string },
  keyCountQueries: 0,
  userRoleQueries: 0,
  adminConfigReads: 0,
  roles: [] as { role: string }[],
}));
const tableRows = (table: string): unknown[] =>
  ({
    licensor: state.licensors,
    licensor_alias: state.aliases,
    character: state.characters,
    character_alias: state.characterAliases,
    characters: state.legacyCharacters,
    property: state.properties,
    property_character_associations_current: state.links,
  } as Record<string, unknown[]>)[table] ?? [];
const tableQuery = (table: string) => {
  if (table === "user_roles") state.userRoleQueries += 1;
  return {
    select: (_columns?: string, options?: { head?: boolean }) => {
      const query = {
        order: () => query,
        range: () => query,
        textSearch: () => query,
        abortSignal: async () => {
          if (table === "dam_search_keys") {
            state.keyCountQueries += 1;
            return state.keyCountError ? { count: null, error: state.keyCountError } : { count: 2, error: null };
          }
          return options?.head ? { count: tableRows(table).length, error: null } : { data: tableRows(table), error: null };
        },
        in: async () => {
          if (table === "admin_config") state.adminConfigReads += 1;
          return state.configError ? { data: null, error: state.configError } : { data: table === "admin_config" ? state.config : [], error: null };
        },
        eq: () =>
          Object.assign(Promise.resolve({ data: table === "user_roles" ? state.roles : [] }), {
            maybeSingle: async () => ({ data: null, error: null }),
          }),
      };
      return query;
    },
  };
};
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
    rpc: (name: string, args: unknown) => ({
      abortSignal: (signal: AbortSignal) => (name === "get_dam_search_named_rows" ? state.namesRpc : state.formatRpc)(name, args, signal),
    }),
    schema: () => ({ from: tableQuery }),
    from: tableQuery,
  }),
}));
vi.mock("../_shared/admin-auth.ts", () => ({ authenticateUser: state.authenticate }));
vi.mock("../_shared/product-code.ts", () => ({ isProductCodeSearch: async () => state.productCode }));
vi.mock("../_shared/search-spelling.ts", () => ({
  RARE_WORD_DOCS: 3,
  VOCABULARY_BUDGET_MS: 4000,
  addNameToVocabulary: vi.fn(),
  checkSpelling: async (_query: string, lookup: { countDocs(word: string): Promise<number> }) => {
    state.spellingCalls += 1;
    // The real spelling step counts unknown words; a failed count costs only this search's help.
    for (const word of state.countWords) await lookup.countDocs(word).catch(() => 0);
    return { meaningful: state.meaningful, corrected: state.corrected };
  },
}));
const { resetLicensorCacheForTests, resetCountDocsCacheForTests } = await import("./index.ts");
// Answers both text-embed endpoints like the real service: batch requests get
// one vector per requested text, single-text requests get one vector.
const embedFetch = () =>
  vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    if (new URL(String(input)).pathname === "/embed-text-batch") {
      const texts = JSON.parse(String(init?.body ?? "{}")).texts as string[];
      return Response.json({ ok: true, vectors: texts.map(() => Array(768).fill(0)) });
    }
    return Response.json({ ok: true, vector: Array(768).fill(0) });
  });

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
    state.licensors.length = 0;
    state.aliases.length = 0;
    for (const rows of [state.characters, state.characterAliases, state.legacyCharacters, state.properties, state.links]) rows.length = 0;
    resetLicensorCacheForTests();
    resetCountDocsCacheForTests();
    vi.stubGlobal("Deno", { env: { get: () => "https://embed.invalid" } });
    state.config.length = 0;
    state.configError = null;
    state.productCode = false;
    state.meaningful = true;
    state.corrected = null;
    state.spellingCalls = 0;
    state.countWords = [];
    state.keyCountError = null;
    state.keyCountQueries = 0;
    state.userRoleQueries = 0;
    state.adminConfigReads = 0;
    state.roles = [];
    state.authenticate.mockResolvedValue({ ok: true, via: "user", userId: "viewer" });
    state.formatRpc.mockReset().mockResolvedValue({ data: false, error: null });
    state.namesRpc.mockReset().mockImplementation(async () => ({
      data: {
        characters: state.characters,
        aliases: state.characterAliases.map(({ character_id, alias }) => ({ characterId: character_id, alias })),
        legacyCharacters: state.legacyCharacters,
        properties: state.properties,
        propertyCharacters: state.links.map(({ property_id, character_id }) => ({ propertyId: property_id, characterId: character_id })),
        licensorNames: [...state.licensors.map(({ name }) => name), ...state.aliases.map(({ alias }) => alias)],
      },
      error: null,
    }));
    state.rpc.mockReset().mockImplementation(async (name: string) => ({
      data: name.startsWith("dam_search_semantic_anchor") ? 0.5 : [],
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

  it("asks for the typed and corrected phrases once and preserves an alias match", async () => {
    state.corrected = "Beryl rug";
    state.characterAliases.push({ character_id: "beryl", alias: "Beryl" });
    vi.stubGlobal("fetch", embedFetch());
    expect((await search("Berl rug")).status).toBe(200);
    expect(state.namesRpc).toHaveBeenCalledExactlyOnceWith("get_dam_search_named_rows", {
      p_keys: ["berl", "berl rug", "rug", "beryl", "beryl rug"],
    }, expect.any(AbortSignal));
    expect(state.rpc).toHaveBeenCalledWith(
      "search_dam_documents",
      expect.objectContaining({
        p_filters: expect.objectContaining({ requiredCharacterIds: ["beryl"], requiredCharacterNames: ["beryl"] }),
      }),
    );
  });

  it.each([
    { data: null, error: { code: "57014" } },
    { data: { characters: [] }, error: null },
    {
      data: { characters: [{ id: "beryl", name: null }], aliases: [], legacyCharacters: [], properties: [], propertyCharacters: [], licensorNames: [] },
      error: null,
    },
  ])("returns Retry without a ranked call when required name data is unavailable", async (reply) => {
    vi.stubGlobal("fetch", embedFetch());
    state.namesRpc.mockResolvedValue(reply);
    const response = await search("Beryl frame");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Search unavailable" });
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it("returns Retry when the name lookup reaches its deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", embedFetch());
    state.namesRpc.mockImplementation((_name, _args, signal: AbortSignal) =>
      new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve({ data: null, error: { code: "57014" } }), { once: true });
      })
    );
    const pendingResponse = search("Beryl frame");
    await vi.advanceTimersByTimeAsync(5000);
    const response = await pendingResponse;
    expect(response.status).toBe(503);
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
      // Speculative embedding may run before spelling; its result is discarded. No picture leg runs.
      expect(state.rpc).not.toHaveBeenCalledWith(expect.stringMatching(/^dam_search_semantic_anchor/), expect.anything());
      if (state.productCode) expect(state.namesRpc).not.toHaveBeenCalled();
      expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_query_embedding: null, p_compute_anchor: false }));
    });
  }

  it("a later successful attempt uses semantic ranking", async () => {
    vi.stubGlobal("fetch", embedFetch());
    expect((await search("semantic ranking")).status).toBe(200);
    // One database call: the anchor is computed inside it (#1430 Step 6).
    expect(state.rpc).not.toHaveBeenCalledWith(expect.stringMatching(/^dam_search_semantic_anchor/), expect.anything());
    expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_query_embedding: Array(768).fill(0), p_compute_anchor: true }));
  });

  it("denies an invalid viewer before embedding or searching", async () => {
    state.authenticate.mockResolvedValue({ ok: false });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await search()).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("searches an unknown full code in a catalog format by words only, never by pictures", async () => {
    state.meaningful = false;
    state.formatRpc.mockResolvedValue({ data: true, error: null });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await search("ZZZ83MVSP99")).status).toBe(200);
    expect(state.formatRpc).toHaveBeenCalledWith("dam_catalog_code_format_exists", { p_format: "AAA99AAAA99" }, expect.any(AbortSignal));
    expect(fetch).not.toHaveBeenCalled();
    expect(state.rpc).not.toHaveBeenCalledWith("dam_search_semantic_anchor", expect.anything());
    expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_query: "ZZZ83MVSP99", p_query_embedding: null }));
  });

  it("keeps known full codes and prefixes keyword-only without probing formats", async () => {
    state.productCode = true;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const query of ["VDD83MVSP01", "VDD83"]) expect((await search(query)).status).toBe(200);
    expect(state.formatRpc).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not turn unsupported alternating nonsense into a picture query", async () => {
    state.meaningful = false;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await search("x7q9v2n8")).status).toBe(200);
    expect(state.formatRpc).toHaveBeenCalledOnce();
    // Speculative embedding may run before spelling; its result is discarded. No picture leg runs.
    expect(state.rpc).not.toHaveBeenCalledWith(expect.stringMatching(/^dam_search_semantic_anchor/), expect.anything());
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
      expect(fetch).not.toHaveBeenCalled();
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
    expect(fetch).not.toHaveBeenCalled();
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
    expect(fetch).not.toHaveBeenCalled();
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
    it(`preserves the exact ${scope} scope for a words-only unknown code`, async () => {
      state.meaningful = false;
      state.formatRpc.mockResolvedValue({ data: true, error: null });
      vi.stubGlobal("fetch", embedFetch());
      expect((await search("ZZZ83MVSP99", undefined, [scope])).status).toBe(200);
      expect(state.rpc).toHaveBeenCalledWith(
        "search_dam_documents",
        expect.objectContaining({ p_document_types: [scope], p_query: "ZZZ83MVSP99", p_query_embedding: null }),
      );
    });
  }

  it("retains caller-scoped DAM permission failure rather than using the service client for search", async () => {
    state.formatRpc.mockResolvedValue({ data: true, error: null });
    state.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "denied" } });
    vi.stubGlobal("fetch", embedFetch());
    expect((await search("ZZZ83MVSP99")).status).toBe(403);
    expect(state.rpc).not.toHaveBeenCalledWith("dam_catalog_code_format_exists", expect.anything());
  });

  it("scopes picture-only matches to the licensor a search names, and only then (#892)", async () => {
    vi.stubGlobal("fetch", embedFetch());
    state.licensors.push({ id: "11111111-1111-4111-8111-111111111111", name: "Zorb Studios" });
    const filtersOf = () => state.rpc.mock.calls.filter(([name]) => name === "search_dam_documents").map(([, args]) => args.p_filters);
    expect((await search("zorb studios toy chest")).status).toBe(200);
    expect(filtersOf()).toEqual([{ semanticLicensorIds: ["11111111-1111-4111-8111-111111111111"] }]);
    // The database anchors the picture floor inside the same scope (popcre/shared-db#6024, #1430).
    expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_compute_anchor: true }));
    expect(state.rpc).not.toHaveBeenCalledWith(expect.stringMatching(/^dam_search_semantic_anchor/), expect.anything());
    state.rpc.mockClear();
    expect((await search("plain toy chest")).status).toBe(200);
    expect(filtersOf()).toEqual([{}]);
    expect(state.rpc).not.toHaveBeenCalledWith(expect.stringMatching(/^dam_search_semantic_anchor/), expect.anything());
  });

  it("requires a named character on every leg and anchors inside it (#1037)", async () => {
    vi.stubGlobal("fetch", embedFetch());
    const marie1 = "33333333-3333-4333-8333-333333333331";
    const marie2 = "33333333-3333-4333-8333-333333333332";
    state.characters.push({ id: marie1, name: "Marie" }, { id: marie2, name: "Marie" });
    // Retired public.characters ids the RPC may still return are ignored (popcre/shared-db#6996).
    state.legacyCharacters.push({ id: "44444444-4444-4444-8444-444444444444", name: "Marie" });
    const filtersOf = () => state.rpc.mock.calls.filter(([name]) => name === "search_dam_documents").map(([, args]) => args.p_filters);
    expect((await search("marie frame")).status).toBe(200);
    const scope = {
      requiredCharacterNames: ["marie"],
      requiredCharacterIds: [marie1, marie2],
    };
    expect(filtersOf()).toEqual([scope]);
    expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_filters: scope, p_compute_anchor: true }));
    expect(state.rpc).not.toHaveBeenCalledWith(expect.stringMatching(/^dam_search_semantic_anchor/), expect.anything());
    // Keyword-only searches (no picture leg) still require the character.
    state.rpc.mockClear();
    state.meaningful = false;
    expect((await search("marie frame")).status).toBe(200);
    expect(filtersOf()).toEqual([scope]);
  });

  it("sends no character keys when the search names no character (#1037)", async () => {
    vi.stubGlobal("fetch", embedFetch());
    state.characters.push({ id: "33333333-3333-4333-8333-333333333331", name: "Marie" });
    const filtersOf = () => state.rpc.mock.calls.filter(([name]) => name === "search_dam_documents").map(([, args]) => args.p_filters);
    expect((await search("mariella frame")).status).toBe(200);
    expect(filtersOf()).toEqual([{}]);
    expect(state.rpc).not.toHaveBeenCalledWith(expect.stringMatching(/^dam_search_semantic_anchor/), expect.anything());
  });

  it("product-code searches never carry the character rule (#1037)", async () => {
    state.productCode = true;
    vi.stubGlobal("fetch", vi.fn());
    state.characters.push({ id: "33333333-3333-4333-8333-333333333331", name: "Marie" });
    expect((await search("marie")).status).toBe(200);
    const filters = state.rpc.mock.calls.filter(([name]) => name === "search_dam_documents").map(([, args]) => args.p_filters);
    expect(filters).toEqual([{}]);
  });

  it("scopes a search that names a licensor by a recorded alias (#897)", async () => {
    vi.stubGlobal("fetch", embedFetch());
    state.licensors.push({ id: "22222222-2222-4222-8222-222222222222", name: "Quill Worldwide" });
    state.aliases.push({ licensor_id: "22222222-2222-4222-8222-222222222222", alias: "Quillies" });
    const filtersOf = () => state.rpc.mock.calls.filter(([name]) => name === "search_dam_documents").map(([, args]) => args.p_filters);
    expect((await search("quillies rug")).status).toBe(200);
    expect(filtersOf()).toEqual([{ semanticLicensorIds: ["22222222-2222-4222-8222-222222222222"] }]);
  });

  it("rides the query and its product-phrase variants in ONE batched text-embed call", async () => {
    const fetch = embedFetch();
    vi.stubGlobal("fetch", fetch);
    expect((await search("spiderman floor covering")).status).toBe(200);
    // One service round trip total: the typed query plus mat/rug variants.
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]?.body).toEqual(
      JSON.stringify({ texts: ["spiderman floor covering", "spiderman mat", "spiderman rug"] }),
    );
    // Each variant's picture leg carries its own vector from the batch.
    expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_query_embedding: Array(768).fill(0), p_compute_anchor: true }));
    expect(state.rpc).not.toHaveBeenCalledWith(expect.stringMatching(/^dam_search_semantic_anchor/), expect.anything());
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

  describe("#1430 search speed", () => {
    const post = (body: Record<string, unknown>) =>
      state.handler!(
        new Request("https://example.invalid", {
          method: "POST",
          headers: { Authorization: "Bearer viewer", "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const searchCalls = () => state.rpc.mock.calls.filter(([name]) => name === "search_dam_documents");
    const batchBodies = (fetch: ReturnType<typeof embedFetch>) =>
      fetch.mock.calls
        .filter(([input]) => new URL(String(input)).pathname === "/embed-text-batch")
        .map(([, init]) => JSON.parse(String(init?.body ?? "{}")).texts as string[]);

    it("search and search-modes never read user_roles", async () => {
      state.rpc.mockImplementation(async (name: string) => ({
        data: name === "require_dam_access" ? true : name.startsWith("dam_search_semantic_anchor") ? 0.5 : [],
        error: null,
      }));
      vi.stubGlobal("fetch", embedFetch());
      expect((await search("roles untouched phrase")).status).toBe(200);
      expect((await post({ action: "search-modes" })).status).toBe(200);
      expect(state.userRoleQueries).toBe(0);
    });

    it.each(["embedding-status", "reset-embedding-errors"])("%s reads user_roles: 403 for a viewer, 200 for an admin", async (action) => {
      state.roles = [];
      expect((await post({ action })).status).toBe(403);
      state.roles = [{ role: "admin" }];
      expect((await post({ action })).status).toBe(200);
      expect(state.userRoleQueries).toBe(2);
    });

    it("a DB error on the combined admin_config read returns 503 before any ranked search", async () => {
      state.configError = { message: "boom" };
      vi.stubGlobal("fetch", embedFetch());
      expect((await search("combined read error phrase")).status).toBe(503);
      expect(state.adminConfigReads).toBe(1);
      expect(searchCalls()).toHaveLength(0);
    });

    it("a missing semantic-floor row searches with no admin floor, from the same single read", async () => {
      state.config.push({ key: "SEARCH_TEXT_LEG_MODE", value: "off" });
      vi.stubGlobal("fetch", embedFetch());
      expect((await search("no floor row phrase")).status).toBe(200);
      expect(state.adminConfigReads).toBe(1);
      // No admin floor is sent; the database applies the relative floor below its own anchor.
      expect(searchCalls()[0][1].p_min_semantic_score).toBeNull();
      expect(searchCalls()[0][1].p_compute_anchor).toBe(true);
    });

    it("applies the admin floor when its row is in the same read", async () => {
      state.config.push({ key: "SEARCH_MIN_SEMANTIC_SCORE", value: 0.6 });
      vi.stubGlobal("fetch", embedFetch());
      expect((await search("admin floor row phrase")).status).toBe(200);
      expect(state.adminConfigReads).toBe(1);
      expect(searchCalls()[0][1].p_min_semantic_score as number).toBeCloseTo(0.6);
    });

    it("counts the same rare word once across two searches", async () => {
      state.countWords = ["quazzlefrond"];
      vi.stubGlobal("fetch", embedFetch());
      expect((await search("quazzlefrond")).status).toBe(200);
      expect((await search("quazzlefrond")).status).toBe(200);
      expect(state.spellingCalls).toBe(2);
      expect(state.keyCountQueries).toBe(1);
    });

    it("does not cache an erroring count; the next search counts again", async () => {
      state.countWords = ["zorblefrump"];
      state.keyCountError = { message: "statement timeout" };
      vi.stubGlobal("fetch", embedFetch());
      expect((await search("zorblefrump")).status).toBe(200);
      expect(state.keyCountQueries).toBe(1);
      state.keyCountError = null;
      expect((await search("zorblefrump")).status).toBe(200);
      expect(state.keyCountQueries).toBe(2);
      expect((await search("zorblefrump")).status).toBe(200);
      expect(state.keyCountQueries).toBe(2);
    });

    it("a product code or unknown catalog format runs no spelling check and no embedding", async () => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      state.productCode = true;
      expect((await search("VDD83MVSP01")).status).toBe(200);
      state.productCode = false;
      state.formatRpc.mockResolvedValue({ data: true, error: null });
      expect((await search("ZZZ83MVSP99")).status).toBe(200);
      expect(state.spellingCalls).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("a rejecting speculative embed never fails a non-meaningful search", async () => {
      state.meaningful = false;
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
      const response = await search("quimble zorp");
      expect(response.status).toBe(200);
      expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_query_embedding: null }));
      expect(state.rpc).not.toHaveBeenCalledWith(expect.stringMatching(/^dam_search_semantic_anchor/), expect.anything());
    });

    it("a failing speculative embed never fails a non-meaningful search", async () => {
      state.meaningful = false;
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
      const response = await search("quimble zorp again");
      expect(response.status).toBe(200);
      expect(state.rpc).toHaveBeenCalledWith("search_dam_documents", expect.objectContaining({ p_query_embedding: null }));
      expect(state.rpc).not.toHaveBeenCalledWith(expect.stringMatching(/^dam_search_semantic_anchor/), expect.anything());
    });

    it("a corrected spelling embeds only the corrected text; the typed text reuses its speculative vector", async () => {
      state.corrected = "Pleeple rug";
      const fetch = embedFetch();
      vi.stubGlobal("fetch", fetch);
      expect((await search("Pleeble rug")).status).toBe(200);
      expect(batchBodies(fetch)).toEqual([["Pleeble rug"], ["Pleeple rug"]]);
    });

    it("loads named scope for both the typed and the corrected phrase", async () => {
      state.corrected = "Frabbel rug";
      vi.stubGlobal("fetch", embedFetch());
      expect((await search("Frabble rug")).status).toBe(200);
      expect(state.namesRpc).toHaveBeenCalledWith(
        "get_dam_search_named_rows",
        { p_keys: expect.arrayContaining(["frabble rug", "frabbel rug"]) },
        expect.any(AbortSignal),
      );
    });
  });

  describe("text-meaning leg (#1037 Step 6)", () => {
    const MODEL = "Qwen/Qwen3-Embedding-0.6B@test";
    const textFetch = (textModel: string | null, textDim = 1024) =>
      vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
        if (new URL(String(input)).pathname === "/embed-text-batch") {
          const texts = JSON.parse(String(init?.body ?? "{}")).texts as string[];
          return Response.json({
            ok: true,
            vectors: texts.map(() => Array(768).fill(0)),
            ...(textModel ? { text_model: textModel, text_dim: textDim, text_vectors: texts.map(() => Array(textDim).fill(0.1)) } : {}),
          });
        }
        return Response.json({ ok: true, vector: Array(768).fill(0) });
      });
    const searchCalls = () => state.rpc.mock.calls.filter(([name]) => name === "search_dam_documents");
    const mode = (value: string) => {
      state.config.push({ key: "SEARCH_TEXT_LEG_MODE", value }, { key: "SEARCH_TEXT_EMBEDDING_MODEL", value: MODEL });
    };

    it("mode off sends no text vector", async () => {
      mode("off");
      vi.stubGlobal("fetch", textFetch(MODEL));
      expect((await search("textleg off phrase")).status).toBe(200);
      expect(searchCalls().length).toBeGreaterThan(0);
      for (const [, args] of searchCalls()) expect(args).not.toHaveProperty("p_query_text_embedding");
    });

    it("no mode row means off", async () => {
      vi.stubGlobal("fetch", textFetch(MODEL));
      expect((await search("textleg default phrase")).status).toBe(200);
      for (const [, args] of searchCalls()) expect(args).not.toHaveProperty("p_query_text_embedding");
    });

    it("mode on carries the text vector from the one batched call", async () => {
      mode("on");
      const fetch = textFetch(MODEL);
      vi.stubGlobal("fetch", fetch);
      expect((await search("textleg on phrase")).status).toBe(200);
      expect(fetch.mock.calls.filter(([input]) => new URL(String(input)).pathname === "/embed-text-batch")).toHaveLength(1);
      const args = searchCalls()[0][1] as Record<string, unknown>;
      expect((args.p_query_text_embedding as number[]).length).toBe(1024);
      expect(args.p_min_text_score).toBe(0.45);
      expect(args.p_text_score_margin).toBe(0.08);
    });

    it("mode on with the text vector missing returns 503 before any search", async () => {
      mode("on");
      vi.stubGlobal("fetch", textFetch(null));
      expect((await search("textleg missing phrase")).status).toBe(503);
      expect(searchCalls()).toHaveLength(0);
    });

    it("mode on with a wrong-size text vector returns 503", async () => {
      mode("on");
      vi.stubGlobal("fetch", textFetch(MODEL, 768));
      expect((await search("textleg wrongsize phrase")).status).toBe(503);
      expect(searchCalls()).toHaveLength(0);
    });

    it("a model-stamp mismatch returns 503", async () => {
      mode("on");
      vi.stubGlobal("fetch", textFetch("Qwen/Qwen3-Embedding-0.6B@other"));
      expect((await search("textleg mismatch phrase")).status).toBe(503);
      expect(searchCalls()).toHaveLength(0);
    });

    it("an unreadable switch fails closed", async () => {
      state.configError = { message: "boom" };
      vi.stubGlobal("fetch", textFetch(MODEL));
      expect((await search("textleg error phrase")).status).toBe(503);
      expect(searchCalls()).toHaveLength(0);
    });

    it("product-code searches skip the text leg even when on", async () => {
      mode("on");
      state.productCode = true;
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      expect((await search("textleg code phrase")).status).toBe(200);
      expect(fetch).not.toHaveBeenCalled();
      for (const [, args] of searchCalls()) expect(args).not.toHaveProperty("p_query_text_embedding");
    });

    it.each([true, false])("skips spelling and vector settings for a code (catalog match: %s)", async (catalogMatch) => {
      state.productCode = catalogMatch;
      state.formatRpc.mockResolvedValue({ data: true, error: null });
      state.configError = { message: "vector settings unavailable" };
      state.corrected = "unrelated spelling correction";
      vi.stubGlobal("fetch", vi.fn());

      const response = await search("ABC123456", undefined, ["style_group"]);

      expect(response.status).toBe(200);
      expect(response.headers.get("Server-Timing")).not.toMatch(/spelling|text_leg_config|floor_config/);
      expect(await response.json()).toMatchObject({ semantic: "skipped", corrected_query: null });
      expect(searchCalls()).toEqual([[
        "search_dam_documents",
        expect.objectContaining({
          p_query: "ABC123456",
          p_document_types: ["style_group"],
          p_query_embedding: null,
          p_min_semantic_score: null,
        }),
      ]]);
    });

    it("the browser cannot supply a text vector", async () => {
      mode("off");
      vi.stubGlobal("fetch", textFetch(MODEL));
      const response = await state.handler!(
        new Request("https://example.invalid", {
          method: "POST",
          headers: { Authorization: "Bearer viewer", "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search", query: "textleg browser phrase", p_query_text_embedding: Array(1024).fill(1) }),
        }),
      );
      expect(response.status).toBe(200);
      for (const [, args] of searchCalls()) expect(args).not.toHaveProperty("p_query_text_embedding");
    });
  });

  describe("facet and whole-group total contract (#1430)", () => {
    const groupRow = {
      entity_id: "group-1",
      document_type: "style_group",
      asset_id: null,
      style_group_id: "group-1",
      keyword_rank: 1,
      semantic_rank: null,
      rank: 1,
      total_count: 1,
      has_more: false,
      facets: { fileType: { ai: 5 } },
      total_group_files: 321,
    };
    const searchWith = (extra: Record<string, unknown>) =>
      state.handler!(
        new Request("https://example.invalid", {
          method: "POST",
          headers: { Authorization: "Bearer viewer", "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search", query: "test phrase", ...extra }),
        }),
      );
    const searchDocumentCalls = () => state.rpc.mock.calls.filter(([name]) => name === "search_dam_documents");

    beforeEach(() => {
      state.rpc.mockImplementation(async (name: string) => ({
        data: name === "search_dam_documents" ? [groupRow] : name.startsWith("dam_search_semantic_anchor") ? 0.5 : [],
        error: null,
      }));
      vi.stubGlobal("fetch", embedFetch());
    });

    it("include_facets false skips facets in the search and reports them as not included", async () => {
      const response = await searchWith({ include_facets: false });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.facets_included).toBe(false);
      expect(body.total_group_files).toBe(321);
      expect(searchDocumentCalls().length).toBeGreaterThan(0);
      for (const [, args] of searchDocumentCalls()) expect(args).toHaveProperty("p_include_facets", false);
    });

    it("omitting include_facets keeps facets on and reports them as included", async () => {
      const response = await searchWith({});
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.facets_included).toBe(true);
      expect(body.total_group_files).toBe(321);
      expect(searchDocumentCalls().length).toBeGreaterThan(0);
      for (const [, args] of searchDocumentCalls()) expect(args).toHaveProperty("p_include_facets", true);
    });

    it.each(["false", 0, null])("only an explicit boolean false skips facets (include_facets %j keeps them)", async (value) => {
      const response = await searchWith({ include_facets: value });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.facets_included).toBe(true);
      expect(searchDocumentCalls().length).toBeGreaterThan(0);
      for (const [, args] of searchDocumentCalls()) expect(args).toHaveProperty("p_include_facets", true);
    });
  });
});

describe("textLegSettings floor overrides (#1037)", () => {
  it("reads valid overrides and ignores missing or out-of-range ones", async () => {
    const { textLegSettings } = await import("./index.ts");
    const rows = (extra: { key: string; value: unknown }[]) => ({
      data: [{ key: "SEARCH_TEXT_LEG_MODE", value: "on" }, { key: "SEARCH_TEXT_EMBEDDING_MODEL", value: "m" }, ...extra],
    });
    expect(textLegSettings(rows([]))).toMatchObject({ minScore: 0.45, margin: 0.08 });
    expect(textLegSettings(rows([{ key: "SEARCH_TEXT_MIN_SCORE", value: 0.5 }, { key: "SEARCH_TEXT_SCORE_MARGIN", value: "0.07" }])))
      .toMatchObject({ minScore: 0.5, margin: 0.07 });
    expect(textLegSettings(rows([{ key: "SEARCH_TEXT_MIN_SCORE", value: 2 }, { key: "SEARCH_TEXT_SCORE_MARGIN", value: null }])))
      .toMatchObject({ minScore: 0.45, margin: 0.08 });
  });
});
