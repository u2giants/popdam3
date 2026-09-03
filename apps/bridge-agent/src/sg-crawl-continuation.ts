export type StyleGuideCompletionState = "ingesting" | "reconciling" | "refreshing" | "completed" | "failed" | "attention_required";

export interface StyleGuideCrawlCompletion {
  ok: true;
  state?: StyleGuideCompletionState;
  retry_after_ms?: number;
  error?: string;
  counters?: Record<string, number>;
}

export type CompletionDisposition = "complete" | "continue" | "stop";

/** Legacy Edge responses contain only `{ok:true}` and remain complete/safe. */
export function completionDisposition(response: StyleGuideCrawlCompletion): CompletionDisposition {
  if (!response.state || response.state === "completed") return "complete";
  if (response.state === "reconciling" || response.state === "refreshing" || response.state === "ingesting") return "continue";
  return "stop";
}

export function boundedRetryDelay(response: StyleGuideCrawlCompletion): number {
  const requested = Number(response.retry_after_ms ?? 1_000);
  if (!Number.isFinite(requested)) return 1_000;
  return Math.min(30_000, Math.max(250, requested));
}
