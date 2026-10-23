import { logger } from "../logger.js";
import { db } from "../supabase.js";
import type { BatchResult, OpState } from "../types.js";

const DEFAULT_BATCH_SIZE = 3;

export interface SearchEmbeddingStatus {
  total_documents: number; embedded_documents: number; pending_documents: number;
  leased_documents: number; errored_documents: number; exhausted_documents: number;
  oldest_pending_indexed_at?: string | null;
}

export function normalizeEmbeddingStatus(value: unknown): SearchEmbeddingStatus {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const count = (key: string) => Math.max(0, Number(row[key]) || 0);
  return {
    total_documents: count("total_documents"), embedded_documents: count("embedded_documents"),
    pending_documents: count("pending_documents"), leased_documents: count("leased_documents"),
    errored_documents: count("errored_documents"), exhausted_documents: count("exhausted_documents"),
    oldest_pending_indexed_at: typeof row.oldest_pending_indexed_at === "string" ? row.oldest_pending_indexed_at : null,
  };
}

async function getStatus(): Promise<SearchEmbeddingStatus> {
  const { data, error } = await db().rpc("get_dam_search_embedding_status");
  if (error) throw new Error(`Embedding status failed: ${error.message}`);
  return normalizeEmbeddingStatus(data);
}

/**
 * Document embeddings are picture vectors from thumbnails (SigLIP2 image
 * tower on the edge-dev GPU runner). The old search_text → gte-small path is
 * retired: claiming here would steal rows from the GPU runner and write the
 * wrong modality into dam_search_documents.embedding.
 */
export async function handleEmbedSearch(_op: OpState): Promise<BatchResult> {
  const before = await getStatus();
  return {
    ok: true,
    done: before.pending_documents === 0 && before.leased_documents === 0,
    claimed: 0,
    embedded: 0,
    failed: 0,
    skipped: before.pending_documents,
    message: "Use the SigLIP2 GPU image re-embed (reembed_library.py); text embed-leased is retired.",
    status: before,
  };
}

let automaticRun: Promise<void> | null = null;
let nextAutomaticRunAt = 0;

export function maybeEmbedPendingSearchDocuments(): Promise<void> {
  if (automaticRun) return automaticRun;
  if (Date.now() < nextAutomaticRunAt) return Promise.resolve();
  nextAutomaticRunAt = Date.now() + 60_000;
  automaticRun = (async () => {
    const { data, error } = await db().from("admin_config").select("value").eq("key", "SEARCH_AUTO_EMBED_ENABLED").maybeSingle();
    if (error || data?.value !== true) return;
    const result = await handleEmbedSearch({ status: "running", params: { batch_size: DEFAULT_BATCH_SIZE } });
    logger.info("automatic search embedding status", {
      pending: result.pending_documents ?? 0,
      embedded: result.embedded_documents ?? 0,
    });
  })().catch((error) => {
    logger.error("automatic search embedding status failed", { error: error instanceof Error ? error.message : String(error) });
  }).finally(() => { automaticRun = null; });
  return automaticRun;
}
