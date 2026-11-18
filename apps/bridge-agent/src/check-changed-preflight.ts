/**
 * Scan change-detection preflight (#1117).
 *
 * The cloud tells the bridge which discovered files are new or changed. A
 * failed lookup must never be read as "everything changed": that turned one
 * slow minute into a multi-day reprocess of the whole library. A failing chunk
 * is retried with long pauses; if it still fails the scan fails and the next
 * scheduled scan tries again.
 */

export interface PreflightFile {
  relative_path: string;
  modified_at: string;
  file_size: number;
}

export interface PreflightChunkResult {
  changed: string[];
  needs_thumbnail: string[];
  existing_content_identities: Array<{ relative_path: string; filename: string; quick_hash: string }>;
  existing_thumbnails: Array<{ relative_path: string; quick_hash: string; thumbnail_url: string }>;
}

export interface PreflightDeps {
  checkChanged: (files: PreflightFile[]) => Promise<PreflightChunkResult>;
  sleep: (ms: number) => Promise<void>;
  warn: (message: string, details: Record<string, unknown>) => void;
  shouldAbort?: () => boolean;
  /** Server caps check-changed at 500 files per request. */
  chunkSize?: number;
  /** Pause before each extra attempt of one chunk; its length is the retry count. */
  retryDelaysMs?: number[];
}

/** About 18 minutes of patience per chunk on top of the transport's own retries. */
export const PREFLIGHT_RETRY_DELAYS_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

export class PreflightFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreflightFailedError";
  }
}

export async function runCheckChangedPreflight(
  files: PreflightFile[],
  deps: PreflightDeps,
): Promise<PreflightChunkResult> {
  const chunkSize = deps.chunkSize ?? 500;
  const delays = deps.retryDelaysMs ?? PREFLIGHT_RETRY_DELAYS_MS;
  const total: PreflightChunkResult = {
    changed: [],
    needs_thumbnail: [],
    existing_content_identities: [],
    existing_thumbnails: [],
  };

  for (let start = 0; start < files.length; start += chunkSize) {
    const chunk = files.slice(start, start + chunkSize);
    let result: PreflightChunkResult | undefined;
    let lastError = "";
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      if (deps.shouldAbort?.()) throw new PreflightFailedError("Aborted by user");
      try {
        result = await deps.checkChanged(chunk);
        break;
      } catch (e) {
        lastError = (e as Error).message;
        if (attempt < delays.length) {
          deps.warn("check-changed failed; retrying this chunk", {
            chunk_start: start,
            attempt: attempt + 1,
            retry_in_ms: delays[attempt],
            error: lastError,
          });
          await deps.sleep(delays[attempt]);
        }
      }
    }
    if (!result) {
      throw new PreflightFailedError(
        `Change check failed for files ${start + 1}-${start + chunk.length} of ${files.length} after ${delays.length + 1} attempts: ${lastError}`,
      );
    }
    total.changed.push(...result.changed);
    total.needs_thumbnail.push(...result.needs_thumbnail);
    total.existing_content_identities.push(...result.existing_content_identities);
    total.existing_thumbnails.push(...result.existing_thumbnails);
  }
  return total;
}

const THUMBNAIL_NAME = /\/thumbnails\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jpg(?:\?.*)?$/i;

/**
 * Name to store a regenerated thumbnail under. When the file's content hash
 * is the one already on record, the stored name is reused so the record's
 * address does not change and no orphan is left in storage.
 */
export function reusableThumbnailId(
  existing: { quick_hash: string; thumbnail_url: string } | undefined,
  quickHash: string,
): string | null {
  if (!existing || existing.quick_hash !== quickHash) return null;
  return THUMBNAIL_NAME.exec(existing.thumbnail_url)?.[1] ?? null;
}
