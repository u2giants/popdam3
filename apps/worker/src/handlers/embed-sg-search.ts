import { logger } from "../logger.js";
import { db } from "../supabase.js";
import type { BatchResult, OpState } from "../types.js";

export interface SgSearchEmbeddingStatus {
  total_documents: number; embedded_documents: number; pending_documents: number;
  unidentified_documents: number; leased_documents: number; errored_documents: number;
  exhausted_documents: number; oldest_pending_updated_at?: string | null;
}

export function normalizeSgEmbeddingStatus(value: unknown): SgSearchEmbeddingStatus {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const count = (key: string) => Math.max(0, Number(row[key]) || 0);
  return {
    total_documents: count("total_documents"), embedded_documents: count("embedded_documents"),
    pending_documents: count("pending_documents"), unidentified_documents: count("unidentified_documents"),
    leased_documents: count("leased_documents"), errored_documents: count("errored_documents"),
    exhausted_documents: count("exhausted_documents"),
    oldest_pending_updated_at: typeof row.oldest_pending_updated_at === "string" ? row.oldest_pending_updated_at : null,
  };
}

async function getStatus(): Promise<SgSearchEmbeddingStatus> {
  const { data, error } = await db().rpc("get_sg_search_embedding_status");
  if (error) throw new Error(`PopSG embedding status failed: ${error.message}`);
  return normalizeSgEmbeddingStatus(data);
}

/**
 * PopSG document embeddings are picture vectors of thumbnail_url (SigLIP2
 * image tower, shared-db #4437 stage 1). Mirrors the DAM posture: this worker
 * never claims — claiming here would race the GPU runner that owns image
 * inference. The GPU loop claims via claim_sg_search_embedding_documents and
 * writes through upsert_sg_search_embedding under a lease token.
 */
export async function handleEmbedSgSearch(_op: OpState): Promise<BatchResult> {
  const before = await getStatus();
  return {
    ok: true,
    done: before.pending_documents === 0 && before.leased_documents === 0,
    claimed: 0,
    embedded: 0,
    failed: 0,
    skipped: before.pending_documents,
    message: "PopSG embedding coverage meter; document vectors come from the SigLIP2 GPU image loop (claim_sg_search_embedding_documents).",
    status: before,
  };
}

let automaticRun: Promise<void> | null = null;
let nextAutomaticRunAt = 0;

export function maybeEmbedPendingSgSearchDocuments(): Promise<void> {
  if (automaticRun) return automaticRun;
  if (Date.now() < nextAutomaticRunAt) return Promise.resolve();
  nextAutomaticRunAt = Date.now() + 60_000;
  automaticRun = (async () => {
    const { data, error } = await db().from("admin_config").select("value").eq("key", "SEARCH_AUTO_EMBED_ENABLED").maybeSingle();
    if (error || data?.value !== true) return;
    const result = await handleEmbedSgSearch({ status: "running", params: {} });
    const status = result.status as SgSearchEmbeddingStatus | undefined;
    logger.info("automatic popsg search embedding status", {
      pending: status?.pending_documents ?? 0,
      embedded: status?.embedded_documents ?? 0,
    });
  })().catch((error) => {
    logger.error("automatic popsg search embedding status failed", { error: error instanceof Error ? error.message : String(error) });
  }).finally(() => { automaticRun = null; });
  return automaticRun;
}
