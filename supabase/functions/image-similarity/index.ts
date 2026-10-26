/**
 * Edge function: image-similarity (issue #486, plan Step 5).
 *
 * Actions (POST JSON):
 *   search        { image_base64 }        -> enqueue query job, wait <= 15 s,
 *                                            then caller-scoped similarity search
 *   query-status  { query_job_id }        -> poll a pending job to terminal,
 *                                            then run the same search leg
 *
 * Contract highlights:
 *   - verify_jwt=false + authenticateUser (strict); a user session is required
 *     (the search RPC is caller-scoped via auth.client — Muse 7).
 *   - NEVER call dam.* over PostgREST (quirk #64): enqueue/status/search go
 *     through public.* SECURITY DEFINER wrappers only.
 *   - unavailable iff public.image_embed_status().workers_fresh is false (H-1).
 *   - 410 while IMAGE_SIM_ENABLED is false; 400 bad upload; 413 oversize;
 *     503 unavailable; everything else 200 with a stable body shape.
 */

import { createClient } from "../_shared/supabase-js.ts";
import { corsServe, err, json } from "../_shared/http.ts";
import { serviceClient } from "../_shared/service-client.ts";
import { authenticateUser } from "../_shared/admin-auth.ts";
import {
  IMAGE_SIM_ENABLED_KEY,
  IMAGE_SIM_MAX_WAIT_MS,
  IMAGE_SIM_POLL_INTERVAL_MS,
  validateUploadPayload,
  resolveTunables,
  type ImageSimMatch,
  type ImageSimResponse,
} from "../_shared/image-similarity-config.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

interface QueryStatusRow {
  status: string;
  reason: string | null;
  dino: string | null;
  siglip: string | null;
  embedding_model: string | null;
}

async function readConfigRows() {
  const { data, error } = await serviceClient()
    .from("admin_config")
    .select("key, value")
    .in("key", [
      IMAGE_SIM_ENABLED_KEY,
      "IMAGE_SIM_FLOOR",
      "IMAGE_SIM_DINO_WEIGHT",
      "IMAGE_SIM_TOP_K",
      "IMAGE_SIM_EMBEDDING_MODEL",
      "IMAGE_SIM_EMBEDDING_MODEL_PREVIOUS",
      "IMAGE_SIM_REEMBED_IN_PROGRESS",
    ]);
  if (error) throw error;
  return data ?? [];
}

function configFlag(rows: Array<{ key: string; value: unknown }>, key: string): boolean {
  const row = rows.find((r) => r.key === key);
  const v = row?.value;
  const inner = v && typeof v === "object" && "value" in (v as Record<string, unknown>)
    ? (v as Record<string, unknown>).value
    : v;
  if (typeof inner === "boolean") return inner;
  if (typeof inner === "string") return inner.trim().toLowerCase() === "true";
  return false;
}

async function fetchQueryStatus(jobId: string): Promise<QueryStatusRow | null> {
  const { data, error } = await serviceClient().rpc("image_embed_query_status", { p_id: jobId });
  if (error) throw error;
  return (data as QueryStatusRow) ?? null;
}

async function fleetFresh(): Promise<boolean> {
  const { data, error } = await serviceClient().rpc("image_embed_status");
  if (error) throw error;
  return Boolean((data as { workers_fresh?: boolean } | null)?.workers_fresh);
}

function callerClient(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: req.headers.get("Authorization")! } } },
  );
}

/** Caller-scoped similarity search on already-embedded query vectors (Muse 7). */
async function runSearch(
  req: Request,
  dino: string,
  siglip: string,
  tunables: ReturnType<typeof resolveTunables>,
): Promise<{ matches: ImageSimMatch[]; truncated: boolean }> {
  const { data, error } = await callerClient(req).rpc("search_dam_image_similarity", {
    p_query_dino: dino,
    p_query_siglip: siglip,
    p_dino_weight: tunables.dinoWeight,
    p_floor: tunables.floor,
    p_top_k: tunables.topK,
    p_limit: tunables.limit,
    p_model_stamps: tunables.modelStamps.length ? tunables.modelStamps : null,
  });
  if (error) throw error;
  const matches = (data ?? []) as ImageSimMatch[];
  return { matches, truncated: matches.length >= tunables.limit };
}

function bodyWith(
  status: ImageSimResponse["status"],
  extra: Partial<ImageSimResponse> = {},
  http = 200,
): Response {
  return json({ status, matches: [], ...extra } satisfies ImageSimResponse, http);
}

corsServe(async (req) => {
  const auth = await authenticateUser(req, { parseMode: "strict" });
  if (!auth.ok) return err("Unauthorized", 401);
  if (auth.via === "service_role") {
    return err("A user session is required", 403);
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const action = typeof body.action === "string" ? body.action : "search";

  // Feature gate: hide the whole surface while IMAGE_SIM_ENABLED is false.
  const configRows = await readConfigRows();
  if (!configFlag(configRows, IMAGE_SIM_ENABLED_KEY)) {
    return bodyWith("disabled", { reason: "Image similarity is disabled" }, 410);
  }

  if (action === "query-status") {
    const jobId = typeof body.query_job_id === "string" ? body.query_job_id : "";
    if (!jobId) return err("Missing query_job_id", 400);
    const row = await fetchQueryStatus(jobId);
    if (!row) return err("Unknown query_job_id", 404);
    if (row.status === "done" && row.dino && row.siglip) {
      const tunables = resolveTunables(configRows);
      const { matches, truncated } = await runSearch(req, row.dino, row.siglip, tunables);
      return bodyWith("ok", {
        query_job_id: jobId,
        matches,
        floor: tunables.floor,
        weights: { dino: tunables.dinoWeight },
        truncated,
      });
    }
    if (row.status === "failed") {
      return bodyWith("rejected", { query_job_id: jobId, reason: row.reason });
    }
    return bodyWith("pending", { query_job_id: jobId });
  }

  if (action !== "search") {
    return err("Unknown action", 400);
  }

  // --- search -------------------------------------------------------------
  const imageBase64 = typeof body.image_base64 === "string" ? body.image_base64 : "";
  if (!imageBase64) return err("Missing image_base64", 400);
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
  } catch {
    return err("Invalid image_base64", 400);
  }
  const validation = validateUploadPayload(bytes);
  if (!validation.ok) {
    return err(validation.reason, validation.httpStatus);
  }

  // Fleet freshness first: a queued job with no live worker would strand the
  // user for the whole wait budget (H-1: public wrapper only, never dam.*).
  let fresh: boolean;
  try {
    fresh = await fleetFresh();
  } catch (error) {
    console.error("image_embed_status failed", error);
    return bodyWith("unavailable", { reason: "Embed worker status unavailable" }, 503);
  }
  if (!fresh) {
    return bodyWith("unavailable", { reason: "No image embed worker is currently active" }, 503);
  }

  // Enqueue the query job with the payload as a Postgres hex literal — the
  // encoding proven live against PostgREST (bytea round-trip, plan Step 1-7).
  const hex = "\\x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const { data: jobId, error: enqueueError } = await serviceClient().rpc(
    "image_embed_enqueue_query",
    { p_payload: hex },
  );
  if (enqueueError) throw enqueueError;
  if (typeof jobId !== "string") return err("Enqueue failed", 500);

  const tunables = resolveTunables(configRows);
  const deadline = Date.now() + IMAGE_SIM_MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(IMAGE_SIM_POLL_INTERVAL_MS);
    const row = await fetchQueryStatus(jobId);
    if (!row) break;
    if (row.status === "done" && row.dino && row.siglip) {
      const { matches, truncated } = await runSearch(req, row.dino, row.siglip, tunables);
      return bodyWith("ok", {
        query_job_id: jobId,
        matches,
        floor: tunables.floor,
        weights: { dino: tunables.dinoWeight },
        truncated,
      });
    }
    if (row.status === "failed") {
      return bodyWith("rejected", { query_job_id: jobId, reason: row.reason });
    }
  }
  // Honest timeout: the job is still queued/leased — hand the id back so the
  // UI keeps polling query-status instead of freezing on "pending".
  return bodyWith("pending", { query_job_id: jobId });
});
