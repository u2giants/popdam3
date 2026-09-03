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
