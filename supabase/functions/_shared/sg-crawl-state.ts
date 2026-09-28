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

// The database marks a run refreshing at file_groups, before folders or search.
// The search stamp proves a search step ran, including an empty queue. The old
// caller clears that stamp on a full batch, but preserves the positive count.
export function shouldResumeSgSearch(lifecycleState: unknown, refreshCompletedAt: unknown, searchDocumentsSynced: unknown): boolean {
  return lifecycleState === "refreshing" &&
    (typeof refreshCompletedAt === "string" && refreshCompletedAt.length > 0 ||
      Number.isSafeInteger(searchDocumentsSynced) && (searchDocumentsSynced as number) > 0);
}

export type SgRefreshStep = "file_groups" | "folders" | "search";
export type SgRefreshResult = {
  data: unknown;
  error: { message: string } | null;
};

/** Each callback invocation is one independent RPC statement. */
export async function runSteppableSgRefresh(
  runId: string,
  batchSize: number,
  resumeSearch: boolean,
  call: (args: { p_run_id: string; p_search_batch_size: number; p_step: SgRefreshStep }) => Promise<SgRefreshResult>,
): Promise<{ synced: number; failedStep?: SgRefreshStep; error?: string }> {
  const steps: SgRefreshStep[] = resumeSearch ? ["search"] : ["file_groups", "folders", "search"];
  for (const step of steps) {
    const { data, error } = await call({
      p_run_id: runId,
      p_search_batch_size: batchSize,
      p_step: step,
    });
    if (error) return { synced: 0, failedStep: step, error: error.message };
    const row = Array.isArray(data) ? data[0] : data;
    const synced = (row as { search_documents_synced?: unknown } | null)?.search_documents_synced;
    if (
      !Number.isSafeInteger(synced) || (synced as number) < 0 ||
      (step !== "search" && synced !== 0) ||
      (step === "search" && (synced as number) > batchSize)
    ) {
      return { synced: 0, failedStep: step, error: "RPC returned an invalid synchronization count" };
    }
    if (step === "search") return { synced: synced as number };
  }
  return { synced: 0, failedStep: "search", error: "Search step was not called" };
}

// 5,000-row reconciliation timed out in ordinary production runs even though
// the contract is restart-safe. The smaller batch preserves the same guard and
// continuation semantics without increasing the statement ceiling.
export const SG_RECONCILE_BATCH_SIZE = 250;
