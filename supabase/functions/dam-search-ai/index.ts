import { createClient } from "../_shared/supabase-js.ts";
import { corsServe, err, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/service-client.ts";
import { authenticateUser } from "../_shared/admin-auth.ts";
import { rolesGrantAdmin } from "../_shared/auth-policy.ts";
import { parseSemanticFloor, SEARCH_MIN_SEMANTIC_SCORE_KEY } from "../_shared/semantic-floor.ts";
import { loadDamSearchMode, searchAccessStatus } from "../_shared/search-access.ts";

declare const Supabase: {
  ai: {
    Session: new (
      model: "gte-small",
    ) => {
      run: (
        input: string,
        options?: { mean_pool?: boolean; normalize?: boolean },
      ) => Promise<number[]>;
    };
  };
};

const model = new Supabase.ai.Session("gte-small");

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

async function embedText(input: string) {
  return await model.run(input.slice(0, 8000), {
    mean_pool: true,
    normalize: true,
  });
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
    return err("embed-batch was retired; the Railway worker is the only embedding claimer", 410);
  }

  if (action === "embed-leased") {
    if (!auth.serviceRole) return err("embed-leased requires service-role authorization", 403);
    const input = Array.isArray(body.documents) ? body.documents.slice(0, 100) : [];
    if (input.length === 0) return err("No leased documents supplied", 400);
    const db = serviceClient();
    let embedded = 0;
    let failed = 0;
    let stale = 0;
    for (const doc of input) {
      const row = doc as {
        document_type: string;
        entity_id: string;
        search_text: string;
        content_sha256: string;
        lease_token: string;
      };

      if (!(["asset", "style_group"].includes(row.document_type)) || !row.entity_id || !row.search_text || !row.content_sha256 || !row.lease_token) {
        failed += 1;
        continue;
      }

      try {
        const embedding = await embedText(row.search_text);
        if (!Array.isArray(embedding) || embedding.length !== 384) {
          throw new Error(`Permanent: expected 384 embedding dimensions, received ${embedding?.length ?? 0}`);
        }
        const { data: updated, error } = await db.rpc("upsert_dam_search_embedding", {
          p_document_type: row.document_type,
          p_entity_id: row.entity_id,
          p_content_sha256: row.content_sha256,
          p_lease_token: row.lease_token,
          p_embedding: embedding,
          p_embedding_model: "gte-small",
        });
        if (error) throw error;
        if (updated) embedded += 1;
        else stale += 1;
      } catch (e) {
        failed += 1;
        const message = e instanceof Error ? e.message : String(e);
        await db.rpc("mark_dam_search_embedding_error", {
          p_document_type: row.document_type,
          p_entity_id: row.entity_id,
          p_content_sha256: row.content_sha256,
          p_lease_token: row.lease_token,
          p_error: message,
          p_category: message.startsWith("Permanent:") ? "permanent" : "transient",
        });
      }
    }

    const { data: status } = await db.rpc("get_dam_search_embedding_status");
    return json({ ok: true, embedded, failed, stale, status });
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
      embedText(query),
      // Server-side only: callers cannot override the admin-configured floor.
      serviceClient().from("admin_config").select("value").eq("key", SEARCH_MIN_SEMANTIC_SCORE_KEY).maybeSingle(),
    ]);
    // Fail open: a config read failure must not take search down; it only
    // drops the optional floor for this request.
    if (floorConfig.error) console.error("SEARCH_MIN_SEMANTIC_SCORE read failed; searching without floor", floorConfig.error.message);
    const minSemanticScore = floorConfig.error ? null : parseSemanticFloor(floorConfig.data?.value);

    // The caller-scoped client is required here: the RPC enforces DAM access
    // from auth.uid(), which a service-role client would bypass.
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
    });
  }

  return err(`Unknown action: ${action}`, 404);
});
