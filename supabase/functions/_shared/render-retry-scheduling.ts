// Schedules Windows render retries for unchanged files whose previews need the
// alternate render path (thumbnail_error = "no_pdf_compat"). Every lookup and
// insert error is surfaced so check-changed can report the paths that were NOT
// scheduled; they stay "no_pdf_compat" and the next scan retries them. Pending
// and claimed jobs are skipped so retries never duplicate queued work.

export type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

export interface RenderRetryWriter {
  findAssets(relativePaths: string[]): Promise<QueryResult<{ id: string; relative_path: string }>>;
  findQueued(assetIds: string[]): Promise<QueryResult<{ asset_id: string }>>;
  insertJobs(rows: Array<{ asset_id: string; status: "pending" }>): Promise<{ error: { message: string } | null }>;
}

export interface RenderRetryResult {
  queued: number;
  failedPaths: string[];
  error: string | null;
}

export async function scheduleRenderRetries(
  relativePaths: string[],
  writer: RenderRetryWriter,
): Promise<RenderRetryResult> {
  if (relativePaths.length === 0) return { queued: 0, failedPaths: [], error: null };

  const assets = await writer.findAssets(relativePaths);
  if (assets.error) {
    return { queued: 0, failedPaths: [...relativePaths], error: `asset lookup failed: ${assets.error.message}` };
  }
  const rows = assets.data ?? [];
  if (rows.length === 0) return { queued: 0, failedPaths: [], error: null };

  const queued = await writer.findQueued(rows.map((a) => a.id));
  if (queued.error) {
    return {
      queued: 0,
      failedPaths: rows.map((a) => a.relative_path),
      error: `queue lookup failed: ${queued.error.message}`,
    };
  }
  const already = new Set((queued.data ?? []).map((q) => q.asset_id));
  const toQueue = rows.filter((a) => !already.has(a.id));
  if (toQueue.length === 0) return { queued: 0, failedPaths: [], error: null };

  const inserted = await writer.insertJobs(toQueue.map((a) => ({ asset_id: a.id, status: "pending" as const })));
  if (inserted.error) {
    return {
      queued: 0,
      failedPaths: toQueue.map((a) => a.relative_path),
      error: `queue insert failed: ${inserted.error.message}`,
    };
  }
  return { queued: toQueue.length, failedPaths: [], error: null };
}
