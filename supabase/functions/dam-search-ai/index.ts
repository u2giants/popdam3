import { createClient } from "../_shared/supabase-js.ts";
import { corsServe, err, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/service-client.ts";
import { authenticateUser } from "../_shared/admin-auth.ts";
import { rolesGrantAdmin } from "../_shared/auth-policy.ts";
import { effectiveSemanticFloor, parseSemanticFloor, SEARCH_MIN_SEMANTIC_SCORE_KEY } from "../_shared/semantic-floor.ts";
import { unwrapConfigValue } from "../_shared/config-utils.ts";
import { loadDamSearchMode, searchAccessStatus } from "../_shared/search-access.ts";
import { expandProductQueries } from "../_shared/search-query-expand.ts";
import { getPopSGQueryEmbedding, nameExpansion, type NameVectors } from "../_shared/popsg-query-embedding.ts";
import { hasCatalogCodeFormat } from "../_shared/catalog-code-format.ts";
import { withSearchRequestBudget } from "../_shared/search-request-budget.ts";
import { isProductCodeSearch } from "../_shared/product-code.ts";
import { addNameToVocabulary, checkSpelling, RARE_WORD_DOCS, type SpellingLookup } from "../_shared/search-spelling.ts";
import { mergeSearchPages, type SearchHit, type SearchPage } from "../_shared/dam-search-merge.ts";
import { type BatchEmbedOutcome, createQueryEmbedder } from "../_shared/query-embed-batch.ts";

/**
 * Query embeddings must use the SAME model as document picture vectors:
 * google/siglip2-base-patch16-naflex text tower → 768, L2-normalized.
 * Hosted by apps/text-embed (TEXT_EMBED_URL). Never mix gte-small/384 here.
 */
const SIGLIP2_MODEL = "google/siglip2-base-patch16-naflex";
const SIGLIP2_DIM = 768;

const VOCABULARY_TTL_MS = 60 * 60 * 1000;
const PRODUCT_WORDS = [
  "canvas",
  "hamper",
  "mat",
  "doormat",
  "coir",
  "rug",
  "clock",
  "chest",
  "storage",
  "frame",
  "framed",
  "plaque",
  "banner",
  "lenticular",
  "glass",
  "tray",
  "desk",
  "print",
  "sign",
];
let vocabularyCache: { expires: number; words: Promise<Map<string, number>> } | null = null;
/** Exact licensor, property and character names, filled with the spelling vocabulary. */
const knownFullNames = new Set<string>();
const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const SPELLING_NAMES_KEY = "SEARCH_SPELLING_NAMES";

async function loadNames(table: "licensor" | "property" | "character", signal: AbortSignal): Promise<string[]> {
  // Pages load in parallel: ~15k characters paged one by one overran the spelling budget.
  const pageSize = 1000;
  const { count, error: countError } = await serviceClient().schema("core").from(table).select("id", { count: "exact", head: true }).abortSignal(signal);
  if (countError) throw new Error(countError.message);
  const pages = await Promise.all(Array.from({ length: Math.ceil((count ?? 0) / pageSize) }, async (_, page) => {
    const from = page * pageSize;
    const { data, error } = await serviceClient().schema("core").from(table).select("name").order("id").range(from, from + pageSize - 1).abortSignal(signal);
    if (error) throw new Error(error.message);
    return (data ?? []) as Record<string, unknown>[];
  }));
  return pages.flat().flatMap((row) => typeof row.name === "string" ? [row.name] : []);
}

/** Live name load from the core tables, saved as one admin_config row for cold starts. */
async function rebuildSpellingNames(signal: AbortSignal): Promise<string[]> {
  const names = (await Promise.all([
    loadNames("licensor", signal),
    loadNames("property", signal),
    loadNames("character", signal),
  ])).flat();
  await serviceClient().from("admin_config").upsert({
    key: SPELLING_NAMES_KEY,
    value: { built_at: new Date().toISOString(), names },
    updated_at: new Date().toISOString(),
  });
  return names;
}

/**
 * One saved row instead of ~17 page reads, so a cold isolate answers inside the
 * spelling budget. A stale row is used as is and refreshed in the background.
 */
async function spellingNames(signal: AbortSignal): Promise<string[]> {
  const { data } = await serviceClient().from("admin_config").select("value")
    .eq("key", SPELLING_NAMES_KEY).abortSignal(signal).maybeSingle();
  const saved = unwrapConfigValue(data?.value) as { built_at?: string; names?: unknown } | null;
  if (!Array.isArray(saved?.names)) return await rebuildSpellingNames(signal);
  if (!saved.built_at || Date.now() - Date.parse(saved.built_at) > VOCABULARY_TTL_MS) {
    const refresh = rebuildSpellingNames(AbortSignal.timeout(30_000)).catch((error) => {
      console.error("spelling name refresh failed", error instanceof Error ? error.message : error);
    });
    (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(refresh);
  }
  return saved.names.filter((name): name is string => typeof name === "string");
}

/** PopSG licensor/property name vectors (scripts/popsg-name-vectors.mjs), cached hourly. */
let nameVectorCache: { expires: number; value: Promise<NameVectors | null> } | null = null;
function popsgNameVectors(): Promise<NameVectors | null> {
  if (nameVectorCache && nameVectorCache.expires > Date.now()) return nameVectorCache.value;
  const value = (async () => {
    const { data, error } = await serviceClient().from("admin_config").select("value")
      .eq("key", "POPSG_NAME_VECTORS").maybeSingle();
    if (error || !data) return null;
    const stored = unwrapConfigValue(data.value) as NameVectors | null;
    return Array.isArray(stored?.names) && Array.isArray(stored?.vectors) ? stored : null;
  })().catch(() => null);
  nameVectorCache = { expires: Date.now() + VOCABULARY_TTL_MS, value };
  return value;
}

/** Licensor, property and character names plus product words, refreshed hourly. */
const spellingLookup: SpellingLookup = {
  vocabulary() {
    if (vocabularyCache && vocabularyCache.expires > Date.now()) return vocabularyCache.words;
    const words = (async () => {
      const vocabulary = new Map<string, number>();
      PRODUCT_WORDS.forEach((word) => vocabulary.set(word, 1_000_000));
      for (const name of await spellingNames(AbortSignal.timeout(1500))) {
        // Canonical names have equal authority; core.character has no usage_count.
        addNameToVocabulary(vocabulary, name, 1_000_000);
        knownFullNames.add(normalizeName(name));
      }
      return vocabulary;
    })();
    words.catch(() => {
      vocabularyCache = null;
    });
    vocabularyCache = { expires: Date.now() + VOCABULARY_TTL_MS, words };
    return words;
  },
  async countDocs(word, signal) {
    // dam_search_keys carries the indexed copy of search_tsv (the documents copy lost its
    // index). A count, not a limit: with LIMIT the planner seq-scans for rare words (~20 s).
    const { count, error } = await serviceClient()
      .from("dam_search_keys")
      .select("entity_id", { count: "exact", head: true })
      .textSearch("search_tsv", `'${word.replace(/'/g, "")}'`, { config: "simple" })
      .abortSignal(signal ?? AbortSignal.timeout(1000));
    if (error) throw new Error(error.message);
    return Math.min(count ?? 0, RARE_WORD_DOCS);
  },
};

async function authenticateCaller(req: Request) {
  // Shared helper: exact match on the deployed service key (sb_secret_), plus the
  // signature-verified legacy service_role JWT the Railway worker still sends.
  // Signed-in users never trigger a privileged probe call.
  const result = await authenticateUser(req, {
    parseMode: "strict",
    allowServiceRole: true,
    allowVerifiedLegacyServiceRole: true,
  });
  if (!result.ok) return null;
  if (result.via === "service_role") {
    return { userId: "system", serviceRole: true, admin: true, client: serviceClient() };
  }
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
  );
  const { data: roles } = await serviceClient().from("user_roles").select("role").eq("user_id", result.userId);
  return { userId: result.userId, serviceRole: false, admin: rolesGrantAdmin(roles), client };
}

/**
 * Embed typed query words with SigLIP2 text tower via apps/text-embed.
 * All texts a search needs ride ONE batched call: the service answers one CPU
 * forward pass per request and serialises concurrent requests, so a variant
 * fan-out of one HTTP call each paid 1–3 s of tail (measured #804, 2026-11-08).
 * Falls back to the single-text endpoint while the old service image runs.
 * One immediate retry: a single slow embed must not silently downgrade a
 * search to keyword-only (that downgrade is itself a result-set change users
 * see between refreshes). Deterministic results are cached per isolate.
 */
const queryEmbedder = createQueryEmbedder({
  async embedBatch(texts) {
    const attempt = async (): Promise<BatchEmbedOutcome> => {
      const base = Deno.env.get("TEXT_EMBED_URL");
      if (!base) {
        console.error("TEXT_EMBED_URL is not configured; semantic leg skipped");
        return { status: "failed" };
      }
      const key = Deno.env.get("TEXT_EMBED_KEY") ?? "";
      try {
        const res = await fetch(new URL("/embed-text-batch", base), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { "X-Embed-Key": key } : {}),
          },
          body: JSON.stringify({ texts: texts.map((text) => text.slice(0, 8000)) }),
          signal: AbortSignal.timeout(4000),
        });
        if (res.status === 404 || res.status === 405) return { status: "absent" };
        if (!res.ok) {
          console.error(`text-embed batch failed: HTTP ${res.status}`);
          return { status: "failed" };
        }
        const payload = await res.json() as {
          ok?: boolean;
          dim?: number;
          model?: string;
          vectors?: number[][];
        };
        if (
          !payload.ok || !Array.isArray(payload.vectors) || payload.vectors.length !== texts.length ||
          payload.vectors.some((v) => !Array.isArray(v) || v.length !== SIGLIP2_DIM)
        ) {
          console.error(
            `text-embed batch returned bad vectors count=${payload.vectors?.length ?? 0} texts=${texts.length}`,
          );
          return { status: "failed" };
        }
        if (payload.model && payload.model !== SIGLIP2_MODEL) {
          console.error(`text-embed model mismatch: ${payload.model}`);
          return { status: "failed" };
        }
        return { status: "ok", vectors: payload.vectors };
      } catch (e) {
        console.error("text-embed batch call failed", e instanceof Error ? e.message : e);
        return { status: "failed" };
      }
    };
    const first = await attempt();
    if (first.status !== "failed") return first;
    return attempt();
  },
  async embedOne(input) {
    const attempt = async (): Promise<number[] | null> => {
      const base = Deno.env.get("TEXT_EMBED_URL");
      if (!base) {
        console.error("TEXT_EMBED_URL is not configured; semantic leg skipped");
        return null;
      }
      const key = Deno.env.get("TEXT_EMBED_KEY") ?? "";
      try {
        const res = await fetch(new URL("/embed-text", base), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(key ? { "X-Embed-Key": key } : {}),
          },
          body: JSON.stringify({ text: input.slice(0, 8000) }),
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) {
          console.error(`text-embed failed: HTTP ${res.status}`);
          return null;
        }
        const payload = await res.json() as {
          ok?: boolean;
          dim?: number;
          model?: string;
          vector?: number[];
        };
        if (!payload.ok || !Array.isArray(payload.vector) || payload.vector.length !== SIGLIP2_DIM) {
          console.error(`text-embed returned bad vector dim=${payload.vector?.length ?? 0}`);
          return null;
        }
        if (payload.model && payload.model !== SIGLIP2_MODEL) {
          console.error(`text-embed model mismatch: ${payload.model}`);
          return null;
        }
        return payload.vector;
      } catch (e) {
        console.error("text-embed call failed", e instanceof Error ? e.message : e);
        return null;
      }
    };
    const first = await attempt();
    if (first) return first;
    return attempt();
  },
});

const embedQueryText = (input: string) => queryEmbedder.embed(input);

async function handleRequest(req: Request, requestSignal: AbortSignal): Promise<Response> {
  if (req.method !== "POST") return err("Method not allowed", 405);

  const auth = await authenticateCaller(req);
  if (!auth) return err("Unauthorized", 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "search";

  if (action === "search-modes") {
    if (auth.serviceRole) return err("A user session is required", 403);
    try {
      const dam = await loadDamSearchMode(
        auth.client,
        () => serviceClient().from("admin_config").select("value").eq("key", "SEARCH_MODE").maybeSingle(),
      );
      return json({ ok: true, modes: { dam } });
    } catch (error) {
      return err("Search mode unavailable", searchAccessStatus(error) ?? 503);
    }
  }

  if (action === "popsg-query-embedding") {
    // PopSG users need not have DAM access, so this stays apart from search-modes.
    // search_style_guide_library_v2 enforces its own access; this only reads
    // the two search switches and embeds the words the caller typed.
    if (auth.serviceRole) return err("A user session is required", 403);
    const { data, error } = await serviceClient().from("admin_config").select("key, value")
      .in("key", ["POPSG_SEARCH_MODE", "POPSG_SEARCH_MIN_SEMANTIC_SCORE"]);
    if (error) return err("Search mode unavailable", 503);
    const stored = (key: string) => data?.find((row) => row.key === key)?.value;
    const mode = unwrapConfigValue(stored("POPSG_SEARCH_MODE")) === "hybrid" ? "hybrid" : "keyword";
    const query = typeof body.query === "string" ? body.query.trim() : "";
    let semantic;
    try {
      semantic = await getPopSGQueryEmbedding(
        mode,
        query,
        async (pattern) => await serviceClient().from("style_groups").select("id").ilike("sku", pattern).limit(1),
        embedQueryText,
        (text) => checkSpelling(text, spellingLookup),
      );
    } catch {
      return err("Search unavailable. Please try again.", 503);
    }
    // Optional help: a missing or stale name list only skips the expansion.
    // An exact known name ("captain america") already searches well; widening it to
    // its property (Avengers) only floods the top. Only inexact words get the help.
    await spellingLookup.vocabulary().catch(() => null);
    const expansion = knownFullNames.has(normalizeName(query)) ? null : nameExpansion(semantic.embedding, await popsgNameVectors());
    return json({
      ok: true,
      mode,
      // The vector stays here: PopSG searches by names only (see getPopSGQueryEmbedding).
      embedding: null,
      skipped: semantic.skipped ?? (mode === "hybrid" && semantic.embedding ? "names_only" : null),
      expansion,
      min_semantic_score: parseSemanticFloor(stored("POPSG_SEARCH_MIN_SEMANTIC_SCORE")),
    });
  }

  if (action === "embed-batch") {
    return err("embed-batch was retired; document picture vectors come from the GPU image pipeline", 410);
  }

  if (action === "embed-leased") {
    // Document embeddings are picture vectors from thumbnails (SigLIP2 image
    // tower on the GPU runner), not text vectors of search_text. Writing text
    // vectors here would mix modalities and break ranking.
    return err(
      "embed-leased was retired for picture vectors; run the SigLIP2 GPU image re-embed instead",
      410,
    );
  }

  if (action === "embedding-status") {
    if (!auth.admin) return err("Admin authorization required", 403);
    const db = serviceClient();
    const { data, error } = await db.rpc("get_dam_search_embedding_status");
    if (error) throw error;
    return json({ ok: true, status: data });
  }

  if (action === "reset-embedding-errors") {
    if (!auth.admin) return err("Admin authorization required", 403);
    const { data, error } = await serviceClient().rpc("reset_dam_search_embedding_errors", {
      p_document_type: typeof body.document_type === "string" ? body.document_type : null,
      p_entity_ids: null,
    });
    if (error) throw error;
    return json({ ok: true, reset: data });
  }

  if (action === "search") {
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return err("Missing query", 400);
    const limit = Math.min(200, Math.max(1, Math.trunc(Number(body.limit) || 50)));
    const offset = Math.min(10_000, Math.max(0, Math.trunc(Number(body.offset) || 0)));
    const minRank = Number.isFinite(Number(body.min_rank)) ? Math.min(1, Math.max(0, Number(body.min_rank))) : 0;
    const documentTypes = Array.isArray(body.document_types)
      ? body.document_types.filter((v): v is "asset" | "style_group" => v === "asset" || v === "style_group")
      : null;
    if (Array.isArray(body.document_types) && documentTypes?.length !== body.document_types.length) {
      return err("Invalid document_types", 400);
    }
    const filters = body.filters === undefined || body.filters === null ? {} : body.filters;
    if (typeof filters !== "object" || Array.isArray(filters)) {
      return err("Invalid filters", 400);
    }
    // A real product code, whole or its start, has no visual meaning: its picture leg only returns
    // lookalikes (VDD83MVSP01 returned 7; HXP83MVSX02 returned 367). Match it by words only.
    // The product-code check and spelling resolve together so neither waits on the other.
    const [productCodeSearch, spellingHelp] = await Promise.all([
      isProductCodeSearch(
        query,
        async (pattern) => await serviceClient().from("style_groups").select("id").ilike("sku", pattern).limit(1),
      ),
      checkSpelling(query, spellingLookup),
    ]);
    let unknownCatalogFormat = false;
    try {
      if (!productCodeSearch) {
        unknownCatalogFormat = await hasCatalogCodeFormat(
          query,
          (format, signal) => serviceClient().rpc("dam_catalog_code_format_exists", { p_format: format }).abortSignal(signal),
          requestSignal,
        );
      }
    } catch {
      return err("Search unavailable", 503);
    }
    const spelling = productCodeSearch || unknownCatalogFormat ? { corrected: null, meaningful: true } : spellingHelp;
    const usePictures = !productCodeSearch && spelling.meaningful;
    // Product-type phrases ("floor covering") also run as catalog nouns
    // ("mat", "rug") so compound queries do not drop real mats.
    // Keyword-only variants skip the picture leg (no embedding).
    const expanded = [...expandProductQueries(query), ...(spelling.corrected ? expandProductQueries(spelling.corrected) : [])]
      .filter((variant, index, all) => all.findIndex((other) => other.query === variant.query) === index);
    // Every text the picture leg needs — the typed query plus its product-phrase
    // variants — rides ONE batched text-embed call: the service answers one CPU
    // forward pass per request and serialises concurrent requests, so separate
    // calls (one per variant, or query-then-variants) queue behind each other
    // and pay 1–3 s of tail (#804). One call, one latency draw.
    const semanticTexts = usePictures ? [...new Set(expanded.filter(({ semantic }) => semantic).map(({ query: variant }) => variant))] : [];
    const [embeddings, floorConfig] = await Promise.all([
      semanticTexts.length ? queryEmbedder.embedAll(semanticTexts) : Promise.resolve(null),
      // Server-side only: callers cannot override the admin-configured floor.
      serviceClient().from("admin_config").select("value").eq("key", SEARCH_MIN_SEMANTIC_SCORE_KEY).maybeSingle(),
    ]);
    const embedding = embeddings?.get(query) ?? null;
    // Fail open: a config read failure must not take search down; it only
    // drops the optional floor for this request.
    if (floorConfig.error) {
      console.error("SEARCH_MIN_SEMANTIC_SCORE read failed; searching without floor", floorConfig.error.message);
    }
    const minSemanticScore = floorConfig.error ? null : parseSemanticFloor(floorConfig.data?.value);
    if (usePictures && !embedding) {
      return err("Search unavailable", 503);
    }

    // The caller-scoped client is required here: the RPC enforces DAM access
    // from auth.uid(), which a service-role client would bypass.
    // A required embedding failure must remain unavailable, never a partial keyword answer.
    const queryVariants = expanded.map((v) => v.query);
    const variantEmbeddings = new Map<string, number[] | null>();
    for (const { query: variant, semantic } of expanded) {
      variantEmbeddings.set(variant, !semantic || !usePictures ? null : (embeddings?.get(variant) ?? null));
    }

    if (expanded.some(({ query: variant, semantic }) => semantic && usePictures && !variantEmbeddings.get(variant))) {
      return err("Search unavailable", 503);
    }

    // One immediate retry per RPC call: statement timeouts under load are
    // transient. After the retry, ANY failed variant fails the whole search —
    // merging only the variants that happened to survive produced silently
    // different result sets between refreshes ("13 groups" vs "140+").
    const callSearch = async (variant: string) => {
      const variantEmbedding = variantEmbeddings.get(variant) ?? null;
      // Keep only picture matches near this query's best one. When the semantic
      // leg is active the anchor is REQUIRED: failing open to no floor floods
      // the result set with weak picture matches (measured live: 288 groups for
      // "spiderman coir"), so an anchor that fails twice fails the search.
      let bestSemanticScore: number | null = null;
      let anchorError: unknown = null;
      if (variantEmbedding) {
        const anchorCall = () =>
          auth.client.rpc("dam_search_semantic_anchor", {
            p_query_embedding: variantEmbedding,
            p_document_types: documentTypes,
          });
        let anchor = await anchorCall();
        if (anchor.error) {
          console.error("dam_search_semantic_anchor failed; retrying once", anchor.error.message);
          anchor = await anchorCall();
        }
        if (anchor.error) anchorError = anchor.error;
        else if (typeof anchor.data !== "number") anchorError = new Error("dam_search_semantic_anchor returned no score");
        else bestSemanticScore = anchor.data;
      }
      if (anchorError !== null) return { data: null, error: anchorError };
      const floor = effectiveSemanticFloor(minSemanticScore, bestSemanticScore);
      const invoke = () =>
        auth.client.rpc("search_dam_documents", {
          p_query: variant,
          p_filters: filters,
          p_limit: limit,
          p_offset: offset,
          p_document_types: documentTypes,
          p_query_embedding: variantEmbedding,
          p_min_rank: minRank,
          p_min_semantic_score: floor,
        });
      let { data, error } = await invoke();
      if (error) {
        console.error(`search_dam_documents variant "${variant}" failed; retrying once`, error.message);
        ({ data, error } = await invoke());
      }
      return { data, error };
    };

    const variantResults = await Promise.all(
      queryVariants.map(async (variant) => ({ variant, result: await callSearch(variant) })),
    );
    const failed = variantResults.find(({ result }) => result.error);
    if (failed) {
      // Fail loud: a partial merge is a wrong answer, not a degraded one.
      return err("Search unavailable", searchAccessStatus(failed.result.error) ?? 503);
    }

    const pages: SearchPage[] = variantResults.map(({ result }) => {
      const rows = Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : [];
      const results: SearchHit[] = rows
        .filter((row) => typeof row.entity_id === "string" && row.entity_id)
        .map((row) => ({
          document_type: String(row.document_type ?? ""),
          entity_id: String(row.entity_id),
          asset_id: (row.asset_id as string | null) ?? null,
          style_group_id: (row.style_group_id as string | null) ?? null,
          keyword_rank: (row.keyword_rank as number | null) ?? null,
          semantic_rank: (row.semantic_rank as number | null) ?? null,
          rank: Number(row.rank ?? 0),
        }));
      const first = rows.find((row) => row.total_count !== undefined && row.total_count !== null) ?? rows[0] ?? null;
      return {
        results,
        total_count: typeof first?.total_count === "number" ? first.total_count : 0,
        has_more: first?.has_more === true,
        facets: first?.facets && typeof first.facets === "object" ? (first.facets as Record<string, unknown>) : {},
      } satisfies SearchPage;
    });
    const merged = mergeSearchPages(pages);
    return json({
      ok: true,
      results: merged.results,
      total_count: merged.total_count,
      has_more: merged.has_more,
      facets: merged.facets,
      semantic: embedding ? "siglip2" : "skipped",
      corrected_query: spelling.corrected,
    });
  }

  // PopSG runs its own library search but shares this spelling help.
  if (action === "spelling") {
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return err("Missing query", 400);
    return json({ ok: true, ...(await checkSpelling(query, spellingLookup)) });
  }

  return err(`Unknown action: ${action}`, 404);
}

corsServe((req) => withSearchRequestBudget(req, (signal) => handleRequest(req, signal)));
