import { db, type DB } from "../supabase.js";
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

/**
 * PopSG document embeddings are picture vectors from thumbnails, written by the
 * edge-dev GPU poller (#706). This operation only reports coverage: embedding
 * file names here would write the wrong modality into the same column.
 */
export async function handleEmbedSgSearch(_op: OpState, client: DB = db()): Promise<BatchResult> {
  const { data, error } = await client.rpc("get_sg_search_embedding_status");
  if (error) throw new Error(`PopSG embedding status failed: ${error.message}`);
  const status = normalizeSgEmbeddingStatus(data);
  return {
    ok: true,
    done: true,
    claimed: 0,
    embedded: 0,
    failed: 0,
    skipped: status.pending_documents,
    message: "PopSG picture vectors come from the edge-dev GPU poller; nothing to do here.",
    status,
  };
}
