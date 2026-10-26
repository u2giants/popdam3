import { logger } from "../logger.js";
import { db } from "../supabase.js";
import type { BatchResult, OpState } from "../types.js";

/**
 * rebuild-image-vectors — enqueue/status ONLY backfill (plan Step 4b).
 *
 * The worker NEVER embeds. Embedding happens on the GPU pollers
 * (apps/image-embed-worker), which claim index jobs from dam.image_embed_jobs
 * over the pooler. This handler walks the stale set — assets with no vector,
 * a changed thumbnail watermark, or a stamp outside the active window — via
 * public.image_embed_stale_assets (SECURITY DEFINER; service_role cannot read
 * dam.* over PostgREST) and enqueues each id through the designed
 * public.image_embed_enqueue_index wrapper (idempotent: the unique partial
 * index keeps one active index job per asset).
 */

const STALE_PAGE_SIZE = 2000; // ids per enumeration page (wrapper clamps to 5000)
const ENQUEUE_CONCURRENCY = 100; // parallel enqueue_index RPCs per wave

export interface ImageEmbedQueueStatus {
  pending: number;
  leased: number;
  failed: number;
  done: number;
  workers_fresh: boolean;
  stale_after_seconds: number;
}

export function normalizeImageEmbedStatus(value: unknown): ImageEmbedQueueStatus {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const count = (key: string) => Math.max(0, Number(row[key]) || 0);
  return {
    pending: count("pending"),
    leased: count("leased"),
    failed: count("failed"),
    done: count("done"),
    workers_fresh: row.workers_fresh === true,
    stale_after_seconds: count("stale_after_seconds") || 90,
  };
}

async function readQueueStatus(): Promise<ImageEmbedQueueStatus | null> {
  const { data, error } = await db().rpc("image_embed_status");
  if (error) {
    logger.warn("image_embed_status read failed during backfill", { error: error.message });
    return null;
  }
  return normalizeImageEmbedStatus(data);
}

function parseCursor(op: OpState): string | null {
  // Cursor 0 is the start of a run; a UUID is the last enqueued asset id.
  if (typeof op.cursor === "string" && op.cursor !== "0") return op.cursor;
  return null;
}

export async function handleImageEmbedBackfill(op: OpState): Promise<BatchResult> {
  const started = Date.now();
  const afterAssetId = parseCursor(op);

  const { data: pageData, error: pageError } = await db().rpc("image_embed_stale_assets", {
    p_after_asset_id: afterAssetId,
    p_limit: STALE_PAGE_SIZE,
  });
  if (pageError) {
    return {
      ok: false,
      done: true,
      error: `stale enumeration failed: ${pageError.message}`,
      error_stage: "candidate_fetch",
    };
  }
  const page = (Array.isArray(pageData) ? pageData : []).filter((id): id is string => typeof id === "string");
  if (page.length === 0) {
    // Enumeration exhausted: the backfill's job (enqueue) is complete. The
    // queue itself is drained by the GPU pollers afterwards — report the
    // snapshot so the UI can say what is still in flight.
    const status = await readQueueStatus();
    return {
      ok: true,
      done: true,
      stale_found: 0,
      enqueued: 0,
      failed: 0,
      elapsed_ms: Date.now() - started,
      image_embed_status: status,
      message:
        status && status.workers_fresh === false
          ? "Backfill enqueue complete; no GPU worker heartbeat is fresh — start the image-embed worker to drain the queue."
          : "Backfill enqueue complete; GPU workers drain the queue from here.",
    };
  }

  let enqueued = 0;
  let failed = 0;
  const failureSamples: string[] = [];
  for (let offset = 0; offset < page.length; offset += ENQUEUE_CONCURRENCY) {
    const wave = page.slice(offset, offset + ENQUEUE_CONCURRENCY);
    const results = await Promise.all(
      wave.map((assetId) => db().rpc("image_embed_enqueue_index", { p_asset_id: assetId })),
    );
    for (let i = 0; i < results.length; i++) {
      if (results[i].error) {
        failed += 1;
        if (failureSamples.length < 100) {
          failureSamples.push(`${wave[i]}: ${results[i].error!.message}`);
        }
      } else {
        enqueued += 1;
      }
    }
  }

  logger.info("image-embed backfill page", {
    after: afterAssetId,
    stale_found: page.length,
    enqueued,
    failed,
    elapsed_ms: Date.now() - started,
  });

  return {
    // Per-asset enqueue failures are recorded and sampled; only a page where
    // EVERY enqueue failed (e.g. the wrapper is missing) fails the batch.
    ok: failed < page.length,
    done: false, // a partial page still means one more (empty) page to confirm exhaustion
    nextOffset: page[page.length - 1],
    stale_found: page.length,
    enqueued,
    failed,
    failure_samples: failureSamples,
    elapsed_ms: Date.now() - started,
  };
}
