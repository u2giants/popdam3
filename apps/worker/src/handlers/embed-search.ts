import { config } from "../config.js";
import { logger } from "../logger.js";
import { db } from "../supabase.js";
import type { BatchResult, OpState } from "../types.js";

// Production samples exceeded the hosted edge runtime at 25 and 10 documents,
// and a longer run proved that five can still exceed it after partial success.
// Three keeps each invocation comfortably below the hosted runtime ceiling.
const DEFAULT_BATCH_SIZE = 3;
const WORKER_ID = `railway-search-${process.pid}`;

export interface SearchEmbeddingStatus {
  total_documents: number; embedded_documents: number; pending_documents: number;
  leased_documents: number; errored_documents: number; exhausted_documents: number;
  oldest_pending_indexed_at?: string | null;
}

interface LeasedDocument {
  document_type: "asset" | "style_group"; entity_id: string; search_text: string;
  content_sha256: string; lease_token: string;
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

async function claimDocuments(limit: number): Promise<LeasedDocument[]> {
  const { data, error } = await db().rpc("claim_dam_search_embedding_documents", {
    p_limit: limit, p_worker_id: WORKER_ID, p_lease_seconds: 300,
  });
  if (error) throw new Error(`Embedding claim failed: ${error.message}`);
  return (data ?? []) as LeasedDocument[];
}

async function embedLeasedDocuments(documents: LeasedDocument[]) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/dam-search-ai`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.supabaseServiceRoleKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "embed-leased", documents }),
    signal: AbortSignal.timeout(240_000),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || payload.ok !== true) {
    throw new Error(`Embedding edge failed (${response.status}): ${String(payload.error || "unknown error")}`);
  }
  return payload;
}

export async function handleEmbedSearch(op: OpState): Promise<BatchResult> {
  const configured = Number(op.params?.batch_size);
  const batchSize = Math.min(100, Math.max(1, Number.isFinite(configured) ? configured : DEFAULT_BATCH_SIZE));
  const before = await getStatus();
  if (before.pending_documents === 0 && before.leased_documents === 0) {
    return { ok: true, done: true, claimed: 0, embedded: 0, failed: 0, status: before };
  }
  const documents = await claimDocuments(batchSize);
  if (documents.length === 0) {
    return { ok: true, done: before.pending_documents === 0, claimed: 0, embedded: 0, failed: 0, status: before };
  }
  const result = await embedLeasedDocuments(documents);
  const after = normalizeEmbeddingStatus(result.status ?? await getStatus());
  return {
    ok: true, done: after.pending_documents === 0 && after.leased_documents === 0,
    claimed: documents.length, embedded: Number(result.embedded) || 0,
    failed: Number(result.failed) || 0, stale: Number(result.stale) || 0,
    total_documents: after.total_documents, embedded_documents: after.embedded_documents,
    pending_documents: after.pending_documents, exhausted_documents: after.exhausted_documents, status: after,
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
    logger.info("automatic search embedding batch", { claimed: result.claimed, embedded: result.embedded, failed: result.failed, pending: result.pending_documents });
  })().catch((error) => {
    logger.error("automatic search embedding batch failed", { error: error instanceof Error ? error.message : String(error) });
  }).finally(() => { automaticRun = null; });
  return automaticRun;
}
