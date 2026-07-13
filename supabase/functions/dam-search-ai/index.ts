import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsServe, err, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/service-client.ts";

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

function authHeader(req: Request) {
  const header = req.headers.get("Authorization");
  return header?.startsWith("Bearer ") ? header : null;
}

async function authenticateUser(req: Request) {
  const header = authHeader(req);
  if (!header) return null;

  const token = header.replace("Bearer ", "");
  const serviceRoleClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    token,
    { global: { headers: { Authorization: header } } },
  );
  const { error: serviceRoleError } = await serviceRoleClient.rpc("get_dam_search_embedding_status");
  if (!serviceRoleError) return { userId: "system", serviceRole: true };

  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: header } } },
  );
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.id) return null;
  return { userId: data.user.id, serviceRole: false };
}

async function embedText(input: string) {
  return await model.run(input.slice(0, 8000), {
    mean_pool: true,
    normalize: true,
  });
}

corsServe(async (req) => {
  if (req.method !== "POST") return err("Method not allowed", 405);

  const auth = await authenticateUser(req);
  if (!auth) return err("Unauthorized", 401);

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "search";

  if (action === "embed-batch") {
    if (!auth.serviceRole) return err("embed-batch requires service-role authorization", 403);

    const limit = Math.min(100, Math.max(1, Number(body.limit) || 25));
    const db = serviceClient();
    const { data: docs, error: claimError } = await db.rpc("claim_dam_search_embedding_documents", {
      p_limit: limit,
    });
    if (claimError) throw claimError;

    let embedded = 0;
    let failed = 0;
    for (const doc of docs ?? []) {
      const row = doc as {
        document_type: string;
        entity_id: string;
        search_text: string;
        content_sha256: string;
      };

      try {
        const embedding = await embedText(row.search_text);
        const { data: updated, error } = await db.rpc("upsert_dam_search_embedding", {
          p_document_type: row.document_type,
          p_entity_id: row.entity_id,
          p_content_sha256: row.content_sha256,
          p_embedding: embedding,
          p_embedding_model: "gte-small",
        });
        if (error) throw error;
        if (updated) embedded += 1;
      } catch (e) {
        failed += 1;
        await db.rpc("mark_dam_search_embedding_error", {
          p_document_type: row.document_type,
          p_entity_id: row.entity_id,
          p_content_sha256: row.content_sha256,
          p_error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const { data: status } = await db.rpc("get_dam_search_embedding_status");
    return json({ ok: true, claimed: docs?.length ?? 0, embedded, failed, status });
  }

  if (action === "embedding-status") {
    const db = serviceClient();
    const { data, error } = await db.rpc("get_dam_search_embedding_status");
    if (error) throw error;
    return json({ ok: true, status: data });
  }

  if (action === "search") {
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return err("Missing query", 400);
    const limit = Math.min(500, Math.max(1, Number(body.limit) || 100));
    const documentTypes = Array.isArray(body.document_types) ? body.document_types.filter((v): v is string => typeof v === "string") : null;
    const embedding = await embedText(query);

    const db = serviceClient();
    const { data, error } = await db.rpc("search_dam_documents", {
      p_query: query,
      p_limit: limit,
      p_document_types: documentTypes,
      p_query_embedding: embedding,
    });
    if (error) throw error;
    return json({ ok: true, results: data ?? [] });
  }

  return err(`Unknown action: ${action}`, 404);
});
