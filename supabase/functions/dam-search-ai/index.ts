import { createClient } from "../_shared/supabase-js.ts";
import { corsServe, err, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/service-client.ts";
import { authenticateUser } from "../_shared/admin-auth.ts";
import { rolesGrantAdmin } from "../_shared/auth-policy.ts";
import { parseSemanticFloor, SEARCH_MIN_SEMANTIC_SCORE_KEY } from "../_shared/semantic-floor.ts";
import { loadDamSearchMode, searchAccessStatus } from "../_shared/search-access.ts";

/**
 * Query embeddings must use the SAME model as document picture vectors:
 * google/siglip2-base-patch16-naflex text tower → 768, L2-normalized.
 * Hosted by apps/text-embed (TEXT_EMBED_URL). Never mix gte-small/384 here.
 */
const SIGLIP2_MODEL = "google/siglip2-base-patch16-naflex";
const SIGLIP2_DIM = 768;

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
 * Returns null when the service is not configured or unavailable so the
 * search call can still run the keyword leg.
 */
async function embedQueryText(input: string): Promise<number[] | null> {
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
}

corsServe(async (req) => {
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
    const [embedding, floorConfig] = await Promise.all([
      embedQueryText(query),
      // Server-side only: callers cannot override the admin-configured floor.
      serviceClient().from("admin_config").select("value").eq("key", SEARCH_MIN_SEMANTIC_SCORE_KEY).maybeSingle(),
    ]);
    // Fail open: a config read failure must not take search down; it only
    // drops the optional floor for this request.
    if (floorConfig.error) console.error("SEARCH_MIN_SEMANTIC_SCORE read failed; searching without floor", floorConfig.error.message);
    const minSemanticScore = floorConfig.error ? null : parseSemanticFloor(floorConfig.data?.value);

    // The caller-scoped client is required here: the RPC enforces DAM access
    // from auth.uid(), which a service-role client would bypass.
    // p_query_embedding stays null when the text-embed service is down so the
    // keyword leg still answers (hybrid degrades, never mixes models).
    const { data, error } = await auth.client.rpc("search_dam_documents", {
      p_query: query,
      p_filters: filters,
      p_limit: limit,
      p_offset: offset,
      p_document_types: documentTypes,
      p_query_embedding: embedding,
      p_min_rank: minRank,
      p_min_semantic_score: minSemanticScore,
    });
    if (error) return err("Search unavailable", searchAccessStatus(error) ?? 503);
    // Summary-only rows (out-of-range page) carry total_count/facets with a
    // null entity_id; they are never search hits.
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const results = rows
      .filter((row) => typeof row.entity_id === "string" && row.entity_id)
      .map((row) => ({
        document_type: row.document_type,
        entity_id: row.entity_id,
        asset_id: row.asset_id,
        style_group_id: row.style_group_id,
        keyword_rank: row.keyword_rank,
        semantic_rank: row.semantic_rank,
        rank: row.rank,
      }));
    const first = rows.find((row) => row.total_count !== undefined && row.total_count !== null) ?? rows[0] ?? null;
    return json({
      ok: true,
      results,
      total_count: typeof first?.total_count === "number" ? first.total_count : 0,
      has_more: first?.has_more === true,
      facets: first?.facets && typeof first.facets === "object" ? first.facets : {},
      semantic: embedding ? "siglip2" : "skipped",
    });
  }

  return err(`Unknown action: ${action}`, 404);
});
