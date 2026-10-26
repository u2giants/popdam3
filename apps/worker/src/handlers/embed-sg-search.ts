import os from "node:os";
import { logger } from "../logger.js";
import { db, type DB } from "../supabase.js";
import { config } from "../config.js";
import { withDependencyTimeout } from "../bounded-dependency.js";
import type { BatchResult, OpState } from "../types.js";

/**
 * PopSG search-document embedding loop (shared-db #4437 stage 1, popdam3 #107).
 *
 * One operation batch = claim → embed → write, mirroring the lease contract the
 * stage-1 migration (20261025180137) defines:
 *
 *   claim_sg_search_embedding_documents(p_limit, p_worker_id, p_lease_seconds)
 *     → style_guide_file_id, search_text, thumbnail_url, content_sha256,
 *       lease_token, lease_expires_at, attempt
 *   upsert_sg_search_embedding(p_style_guide_file_id, p_content_sha256,
 *     p_lease_token, p_embedding vector(768), p_embedding_model)
 *   mark_sg_search_embedding_error(p_style_guide_file_id, p_content_sha256,
 *     p_lease_token, p_error, p_category 'transient'|'permanent')
 *
 * Text is embedded through apps/text-embed (`POST /embed-text`), the SigLIP2
 * text tower that also embeds typed queries — document and query vectors share
 * one model and space (google/siglip2-base-patch16-naflex/768), the only model
 * and dimension upsert_sg_search_embedding accepts.
 *
 * The stage-1 RPCs do not exist in production until the shared-db migration is
 * promoted. Until then every claim fails and this handler surfaces that as an
 * operation error — never a fake success.
 */

const SIGLIP2_MODEL = "google/siglip2-base-patch16-naflex";
const SIGLIP2_DIM = 768;
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 500;
const CLAIM_LEASE_SECONDS = 600;
const EMBED_CONCURRENCY = 6;
const EMBED_TIMEOUT_MS = 10_000;
const CONFIG_CACHE_TTL_MS = 60_000;
const STAGE_ONE_MISSING_HINT =
  "claim_sg_search_embedding_documents is missing: PopSG semantic-search stage 1 (shared-db migration 20261025180137, popcre/shared-db#4772) is not applied to this database yet";

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

async function getStatus(client: DB = db()): Promise<SgSearchEmbeddingStatus> {
  const { data, error } = await client.rpc("get_sg_search_embedding_status");
  if (error) throw new Error(`PopSG embedding status failed: ${error.message}`);
  return normalizeSgEmbeddingStatus(data);
}

/** PostgREST reports a missing function as PGRST202 / 404 / undefined-function 42883. */
export function isMissingRpcError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.code === "PGRST202"
    || message.includes("could not find the function")
    || message.includes("function public.claim_sg_search_embedding_documents")
    || message.includes("does not exist")
    || message.includes("42883");
}

export interface ClaimedSgDocument {
  style_guide_file_id: string;
  search_text: string | null;
  thumbnail_url: string | null;
  content_sha256: string | null;
  lease_token: string | null;
  lease_expires_at: string | null;
  attempt: number | null;
}

/** Only rows with the full lease triple (id + token + hash) can be written back. */
export function normalizeClaimedSgDocuments(value: unknown): ClaimedSgDocument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row): ClaimedSgDocument[] => {
    if (!row || typeof row !== "object") return [];
    const doc = row as Record<string, unknown>;
    const id = typeof doc.style_guide_file_id === "string" ? doc.style_guide_file_id : "";
    const token = typeof doc.lease_token === "string" ? doc.lease_token : "";
    const hash = typeof doc.content_sha256 === "string" ? doc.content_sha256 : "";
    return id && token && hash ? [{
      style_guide_file_id: id,
      search_text: typeof doc.search_text === "string" ? doc.search_text : "",
      thumbnail_url: typeof doc.thumbnail_url === "string" ? doc.thumbnail_url : null,
      content_sha256: hash,
      lease_token: token,
      lease_expires_at: typeof doc.lease_expires_at === "string" ? doc.lease_expires_at : null,
      attempt: Number.isFinite(Number(doc.attempt)) ? Number(doc.attempt) : null,
    }] : [];
  });
}

/** A validated SigLIP2 vector, or the reason the service answer is unusable. */
export function parseEmbedVector(body: unknown): { vector?: number[]; reason?: string } {
  const row = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (row.ok !== true) return { reason: "embed service answered ok:false" };
  if (typeof row.model === "string" && row.model !== SIGLIP2_MODEL) {
    return { reason: `embed service model mismatch: ${row.model}` };
  }
  const dim = Number(row.dim);
  if (dim !== SIGLIP2_DIM) return { reason: `embed service dimension mismatch: ${dim}` };
  if (!Array.isArray(row.vector) || row.vector.length !== SIGLIP2_DIM) {
    return { reason: "embed service returned no 768-float vector" };
  }
  const vector = row.vector.map(Number);
  if (vector.some((n) => !Number.isFinite(n))) return { reason: "embed service vector has non-finite values" };
  return { vector };
}

export type EmbedTextFn = (text: string) => Promise<unknown>;

async function embedTextViaService(url: string, key: string, text: string): Promise<unknown> {
  const res = await fetch(new URL("/embed-text", url), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "X-Embed-Key": key } : {}) },
    body: JSON.stringify({ text: text.slice(0, 8000) }),
    signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`text-embed HTTP ${res.status}`) as Error & { httpStatus?: number };
    err.httpStatus = res.status;
    throw err;
  }
  return res.json();
}

export interface TextEmbedConfig {
  url: string;
  key: string;
}

let cachedConfig: TextEmbedConfig | null = null;
let cachedConfigAt = 0;

function unwrapConfigValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const inner = (value as Record<string, unknown>).value;
    if (typeof inner === "string") return inner.trim();
  }
  return "";
}

async function readConfigFromAdminConfig(client: DB): Promise<Record<string, string>> {
  const { data, error } = await withDependencyTimeout(
    "text-embed config read",
    client.from("admin_config").select("key, value").in("key", ["TEXT_EMBED_URL", "TEXT_EMBED_KEY"]),
  );
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const key = typeof row.key === "string" ? row.key : "";
    if (key) out[key] = unwrapConfigValue(row.value);
  }
  return out;
}

/**
 * admin_config (`TEXT_EMBED_URL` / `TEXT_EMBED_KEY`) wins; the Railway env vars
 * are a deployment fallback only — the same single-source rule as the
 * OpenRouter key. Exported with injectable loaders for tests. Returns null when
 * no URL is configured anywhere, which the handler surfaces as an error.
 */
export async function resolveTextEmbedConfig(
  loadFromDb: () => Promise<Record<string, string>> = () => readConfigFromAdminConfig(db()),
  envUrl: string = config.textEmbedUrl,
  envKey: string = config.textEmbedKey,
  nowMs: number = Date.now(),
): Promise<TextEmbedConfig | null> {
  if (cachedConfig && nowMs - cachedConfigAt < CONFIG_CACHE_TTL_MS) return cachedConfig;
  let dbValues: Record<string, string> = {};
  try {
    dbValues = await loadFromDb();
  } catch (err) {
    logger.error("embed-sg-search: could not read admin_config text-embed keys; trying env fallback", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const resolved: TextEmbedConfig = {
    url: dbValues.TEXT_EMBED_URL || envUrl,
    key: dbValues.TEXT_EMBED_KEY || envKey,
  };
  cachedConfig = resolved.url ? resolved : null;
  cachedConfigAt = nowMs;
  return cachedConfig;
}

/** Tests only: drop the cached admin_config answer between scenarios. */
export function resetTextEmbedConfigCache(): void {
  cachedConfig = null;
  cachedConfigAt = 0;
}

function workerId(): string {
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA;
  return `railway-worker:${sha || os.hostname()}`;
}

export interface SgEmbedBatchOutcome {
  claimed: number;
  embedded: number;
  failed: number;
  skipped_stale: number;
  service_level_error?: string;
}

/**
 * Embed one claimed batch. A service-level problem (wrong model/dimension, or
 * the answer shape unusable) stops the batch, requeues every untouched claim
 * transient and reports the error; per-document problems mark only that
 * document with the migration's bounded transient/permanent backoff.
 */
export async function processClaimedSgBatch(
  documents: ClaimedSgDocument[],
  embedText: EmbedTextFn,
  client: DB,
): Promise<SgEmbedBatchOutcome> {
  const outcome: SgEmbedBatchOutcome = { claimed: documents.length, embedded: 0, failed: 0, skipped_stale: 0 };
  const settled = new Set<number>();

  const markError = async (doc: ClaimedSgDocument, message: string, category: "transient" | "permanent") => {
    const { error } = await client.rpc("mark_sg_search_embedding_error", {
      p_style_guide_file_id: doc.style_guide_file_id,
      p_content_sha256: doc.content_sha256,
      p_lease_token: doc.lease_token,
      p_error: message.slice(0, 1000),
      p_category: category,
    });
    if (error) logger.warn("embed-sg-search: mark_sg_search_embedding_error failed", { error: error.message });
  };

  for (let i = 0; i < documents.length && !outcome.service_level_error; i += EMBED_CONCURRENCY) {
    const chunk = documents.slice(i, i + EMBED_CONCURRENCY);
    await Promise.all(chunk.map(async (doc, indexInChunk) => {
      const index = i + indexInChunk;
      const text = (doc.search_text ?? "").trim();
      if (!text) {
        settled.add(index);
        outcome.failed += 1;
        await markError(doc, "document search_text is empty; nothing to embed", "permanent");
        return;
      }
      let body: unknown;
      try {
        body = await embedText(text);
      } catch (err) {
        settled.add(index);
        outcome.failed += 1;
        const httpStatus = (err as { httpStatus?: number }).httpStatus;
        // 4xx (minus auth/rate limits) means this exact payload is rejected and
        // will be rejected again; everything else deserves a bounded retry.
        const category = httpStatus !== undefined && httpStatus >= 400 && httpStatus < 500
          && httpStatus !== 401 && httpStatus !== 403 && httpStatus !== 408 && httpStatus !== 429
          ? "permanent" : "transient";
        await markError(doc, err instanceof Error ? err.message : String(err), category);
        return;
      }
      const parsed = parseEmbedVector(body);
      if (!parsed.vector) {
        // The service answered but is misconfigured (wrong model/dim). Retrying
        // cannot fix any row: stop the batch and requeue the untouched rest.
        settled.add(index);
        outcome.failed += 1;
        outcome.service_level_error = parsed.reason ?? "embed service returned an unusable answer";
        await markError(doc, outcome.service_level_error, "transient");
        return;
      }
      const { data, error } = await client.rpc("upsert_sg_search_embedding", {
        p_style_guide_file_id: doc.style_guide_file_id,
        p_content_sha256: doc.content_sha256,
        p_lease_token: doc.lease_token,
        p_embedding: `[${parsed.vector.join(",")}]`,
        p_embedding_model: SIGLIP2_MODEL,
      });
      if (error) {
        settled.add(index);
        outcome.failed += 1;
        await markError(doc, `upsert_sg_search_embedding failed: ${error.message}`, "transient");
        return;
      }
      settled.add(index);
      // found = false: the lease expired or content changed under us — the row
      // requeues on its own; this is not a failure.
      if (data === true) outcome.embedded += 1;
      else outcome.skipped_stale += 1;
    }));
  }

  if (outcome.service_level_error) {
    // Requeue every untouched claim so a fixed service drains them later
    // instead of burning their bounded attempts against the same outage.
    for (let i = 0; i < documents.length; i += 1) {
      if (settled.has(i)) continue;
      await markError(documents[i], outcome.service_level_error, "transient");
      outcome.failed += 1;
    }
  }
  return outcome;
}

export async function handleEmbedSgSearch(
  opState: OpState,
  client: DB = db(),
  embedText: EmbedTextFn | null = null,
  loadConfig: () => Promise<TextEmbedConfig | null> = () => resolveTextEmbedConfig(),
): Promise<BatchResult> {
  const requested = Number(opState.params?.batch_size);
  const batchSize = Number.isInteger(requested) && requested > 0
    ? Math.min(requested, MAX_BATCH_SIZE) : DEFAULT_BATCH_SIZE;

  const embedConfig = await loadConfig();
  if (!embedConfig) {
    return {
      ok: false,
      done: false,
      error: "TEXT_EMBED_URL is not configured (admin_config.TEXT_EMBED_URL or the worker env); PopSG embedding cannot run",
    };
  }

  const { data, error } = await client.rpc("claim_sg_search_embedding_documents", {
    p_limit: batchSize,
    p_worker_id: workerId(),
    p_lease_seconds: CLAIM_LEASE_SECONDS,
  });
  if (error) {
    return {
      ok: false,
      done: false,
      error: isMissingRpcError(error as { message?: string; code?: string })
        ? STAGE_ONE_MISSING_HINT
        : `claim_sg_search_embedding_documents failed: ${error.message}`,
      postgres_code: (error as { code?: string }).code,
    };
  }

  const documents = normalizeClaimedSgDocuments(data);
  const malformed = (Array.isArray(data) ? data.length : 0) - documents.length;
  if (malformed > 0) {
    // Claims missing the lease triple cannot be written or marked; their lease
    // expires on its own and the rows requeue. Never silently ignored.
    logger.warn("embed-sg-search: claim returned rows without a usable lease triple", { count: malformed });
  }

  if (documents.length === 0) {
    let status: SgSearchEmbeddingStatus | undefined;
    let message = "PopSG embedding backlog drained";
    try {
      status = await getStatus(client);
      message = `PopSG embedding backlog drained: ${status.embedded_documents}/${status.total_documents} documents embedded`;
    } catch (err) {
      logger.warn("embed-sg-search: status read after empty claim failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return {
      ok: true,
      done: true,
      claimed: 0,
      embedded: 0,
      failed: 0,
      skipped: malformed,
      message,
      status,
    };
  }

  const outcome = await processClaimedSgBatch(
    documents,
    embedText ?? ((text: string) => embedTextViaService(embedConfig.url, embedConfig.key, text)),
    client,
  );
  if (outcome.service_level_error) {
    return {
      ok: false,
      done: false,
      claimed: outcome.claimed,
      embedded: outcome.embedded,
      failed: outcome.failed,
      skipped: outcome.skipped_stale,
      error: `text-embed service problem: ${outcome.service_level_error}`,
    };
  }

  let status: SgSearchEmbeddingStatus | undefined;
  try {
    status = await getStatus(client);
  } catch (err) {
    logger.warn("embed-sg-search: status read after batch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return {
    ok: true,
    done: false,
    claimed: outcome.claimed,
    embedded: outcome.embedded,
    failed: outcome.failed,
    skipped: outcome.skipped_stale + malformed,
    message: `Embedded ${outcome.embedded}, failed ${outcome.failed}, stale ${outcome.skipped_stale} of ${outcome.claimed} claimed`,
    status,
  };
}

let automaticRun: Promise<void> | null = null;
let nextAutomaticRunAt = 0;
const AUTOMATIC_BATCH_SIZE = 25;

/**
 * Bounded automatic freshness: one small batch per minute while
 * `POPSG_SEARCH_AUTO_EMBED_ENABLED` is exactly `true` (the SG-specific switch;
 * DAM keeps its own SEARCH_AUTO_EMBED_ENABLED). Mirrors the DAM auto-embed
 * cadence so a nightly crawl's new documents become searchable without a
 * manual run.
 */
export function maybeEmbedPendingSgSearchDocuments(): Promise<void> {
  if (automaticRun) return automaticRun;
  if (Date.now() < nextAutomaticRunAt) return Promise.resolve();
  nextAutomaticRunAt = Date.now() + 60_000;
  automaticRun = (async () => {
    const { data, error } = await db().from("admin_config").select("value").eq("key", "POPSG_SEARCH_AUTO_EMBED_ENABLED").maybeSingle();
    if (error || data?.value !== true) return;
    const result = await handleEmbedSgSearch({ status: "running", params: { batch_size: AUTOMATIC_BATCH_SIZE } });
    const status = result.status as SgSearchEmbeddingStatus | undefined;
    if (!result.ok) {
      logger.error("automatic popsg search embedding batch failed", { error: result.error });
      return;
    }
    logger.info("automatic popsg search embedding batch", {
      embedded: result.embedded ?? 0,
      failed: result.failed ?? 0,
      pending: status?.pending_documents ?? 0,
    });
  })().catch((error) => {
    logger.error("automatic popsg search embedding batch crashed", { error: error instanceof Error ? error.message : String(error) });
  }).finally(() => { automaticRun = null; });
  return automaticRun;
}
