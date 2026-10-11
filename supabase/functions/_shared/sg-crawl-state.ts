export type SgCrawlStage = "ingesting" | "reconciling" | "refreshing" | "completed" | "failed" | "attention_required";

export interface SgCrawlCounters {
  discovered: number;
  received: number;
  accepted: number;
  rejected: number;
  staleCandidates: number;
  deactivated: number;
  remaining: number;
}

export interface SgDropGuardConfig {
  absoluteDrop: number;
  percentageDrop: number;
  minimumPriorCount: number;
}

export interface SgDropGuardResult {
  blocked: boolean;
  reason: "empty" | "inaccessible" | "absolute_drop" | "percentage_drop" | null;
  dropCount: number;
  dropPercentage: number;
}

export function buildSgIngestCompletionUpdate(
  discoveredCount: number,
  acceptedCount: number,
  inaccessibleRoots: string[],
  completedAt: string,
): Record<string, unknown> {
  return {
    files_found: discoveredCount,
    files_upserted: acceptedCount,
    ingest_completed_at: completedAt,
    lifecycle_state: "reconciling",
    ...(inaccessibleRoots.length ? { inaccessible_roots: inaccessibleRoots } : {}),
  };
}

export function buildSgCrawlCompletionUpdate(
  discoveredCount: number,
  inaccessibleRoots: string[],
  completedAt: string,
): Record<string, unknown> {
  return {
    status: "completed",
    lifecycle_state: "completed",
    completed_at: completedAt,
    files_found: discoveredCount,
    ...(inaccessibleRoots.length ? { inaccessible_roots: inaccessibleRoots } : {}),
  };
}

export function countAcceptedExtensions(
  files: Array<Record<string, unknown>>,
  allowedExtensions: ReadonlySet<string>,
): { accepted: Array<Record<string, unknown>>; rejected: number } {
  const accepted = files.filter((file) => {
    const extension = typeof file.file_extension === "string" ? file.file_extension.toLowerCase() : "";
    return allowedExtensions.has(extension);
  });
  return { accepted, rejected: files.length - accepted.length };
}

export function evaluateSgDropGuard(
  acceptedCount: number,
  priorAcceptedCount: number | null,
  inaccessibleRootCount: number,
  config: SgDropGuardConfig,
): SgDropGuardResult {
  const dropCount = Math.max(0, (priorAcceptedCount ?? 0) - acceptedCount);
  const dropPercentage = priorAcceptedCount && priorAcceptedCount > 0 ? dropCount / priorAcceptedCount : 0;

  if (inaccessibleRootCount > 0) return { blocked: true, reason: "inaccessible", dropCount, dropPercentage };
  if (acceptedCount === 0) return { blocked: true, reason: "empty", dropCount, dropPercentage };
  if (priorAcceptedCount === null || priorAcceptedCount < config.minimumPriorCount) {
    return { blocked: false, reason: null, dropCount, dropPercentage };
  }
  if (dropCount >= config.absoluteDrop) return { blocked: true, reason: "absolute_drop", dropCount, dropPercentage };
  if (dropPercentage >= config.percentageDrop) return { blocked: true, reason: "percentage_drop", dropCount, dropPercentage };
  return { blocked: false, reason: null, dropCount, dropPercentage };
}

export function canCompleteSgCrawl(stage: SgCrawlStage, counters: Pick<SgCrawlCounters, "remaining">, aggregateFresh: boolean): boolean {
  return stage === "refreshing" && counters.remaining === 0 && aggregateFresh;
}

export function hasMoreSgSearchDocuments(synced: number, batchSize: number): boolean {
  return synced >= batchSize;
}

export type SgRefreshStep = "scheduled_refresh" | "search";
export type SgRefreshResult = {
  data: unknown;
  error: { message: string } | null;
};

/** Await the existing scheduler, then synchronize only one bounded search slice. */
export async function runScheduledSgRefresh(
  runId: string,
  batchSize: number,
  awaitRefresh: (args: { p_run_id: string }) => Promise<SgRefreshResult>,
  synchronizeSearch: (args: { p_run_id: string; p_search_batch_size: number; p_step: "search" }) => Promise<SgRefreshResult>,
): Promise<{ synced: number; pending?: boolean; refreshedAt?: string; failedStep?: SgRefreshStep; error?: string }> {
  const readiness = await awaitRefresh({ p_run_id: runId });
  if (readiness.error) return { synced: 0, failedStep: "scheduled_refresh", error: readiness.error.message };
  const row = Array.isArray(readiness.data) && readiness.data.length === 1 ? readiness.data[0] : null;
  const ready = (row as { ready?: unknown } | null)?.ready;
  const refreshedAt = (row as { refreshed_at?: unknown } | null)?.refreshed_at;
  if (ready === false && refreshedAt === null) return { synced: 0, pending: true };
  if (ready !== true || typeof refreshedAt !== "string" || !Number.isFinite(Date.parse(refreshedAt))) {
    return { synced: 0, failedStep: "scheduled_refresh", error: "RPC returned invalid scheduled-refresh readiness" };
  }
  const search = await synchronizeSearch({ p_run_id: runId, p_search_batch_size: batchSize, p_step: "search" });
  if (search.error) return { synced: 0, refreshedAt, failedStep: "search", error: search.error.message };
  const searchRow = Array.isArray(search.data) && search.data.length === 1 ? search.data[0] : null;
  const synced = (searchRow as { search_documents_synced?: unknown } | null)?.search_documents_synced;
  if (!Number.isSafeInteger(synced) || (synced as number) < 0 || (synced as number) > batchSize) {
    return { synced: 0, refreshedAt, failedStep: "search", error: "RPC returned an invalid synchronization count" };
  }
  return { synced: synced as number, refreshedAt };
}

export const SG_SCHEDULED_REFRESH_RETRY_MS = 30_000;

// 5,000-row reconciliation timed out in ordinary production runs even though
// the contract is restart-safe. The smaller batch preserves the same guard and
// continuation semantics without increasing the statement ceiling.
export const SG_RECONCILE_BATCH_SIZE = 250;

/** Wait between retries of a refresh step that hit the API statement ceiling. */
export const SG_REFRESH_TIMEOUT_RETRY_MS = 5_000;
/** Total time after scheduled refresh completion for retrying bounded search timeouts. */
export const SG_REFRESH_TIMEOUT_RETRY_WINDOW_MS = 15 * 60_000;

/**
 * Search synchronization is restart-safe. Other errors and expired retry
 * windows fail the run; aggregate refresh never runs through this request.
 */
export function shouldRetrySgRefreshTimeout(error: string, ingestCompletedAt: string, nowMs: number): boolean {
  const message = error.toLowerCase();
  if (!message.includes("statement timeout") && !message.includes("57014")) return false;
  const startedMs = Date.parse(ingestCompletedAt);
  if (!Number.isFinite(startedMs)) return false;
  return nowMs - startedMs < SG_REFRESH_TIMEOUT_RETRY_WINDOW_MS;
}
