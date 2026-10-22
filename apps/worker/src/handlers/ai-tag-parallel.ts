/** Explicit, single-run OpenRouter distribution. Existing provider receipts always finish first. */
export interface ParallelTagRun { run_id: string; models: string[]; concurrency: number; max_cursor?: number }
export function parallelTagRun(value: unknown, runId: string | undefined, explicitIds: unknown): ParallelTagRun | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid parallel tagging configuration");
  const v = value as Record<string, unknown>;
  if (v.enabled === false) return null;
  if (v.run_id !== runId) return null;
  if (typeof runId !== "string" || !runId || !Array.isArray(explicitIds) || !explicitIds.length || new Set(explicitIds).size !== explicitIds.length || explicitIds.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) throw new Error("Parallel tagging requires unique explicit asset IDs and a run identity");
  if (!Array.isArray(v.models) || v.models.length < 2 || v.models.length > 4 || new Set(v.models).size !== v.models.length || v.models.some(m => typeof m !== "string" || !/^[a-z0-9.-]+\/[a-zA-Z0-9._-]+$/.test(m) || /^(meta-direct|google-direct|scaledown)\//.test(m))) throw new Error("Parallel tagging requires two to four distinct synchronous OpenRouter models");
  if (!Number.isInteger(v.concurrency) || Number(v.concurrency) < 2 || Number(v.concurrency) > 8) throw new Error("Parallel tagging concurrency must be between two and eight");
  if (v.max_cursor !== undefined && (!Number.isSafeInteger(v.max_cursor) || Number(v.max_cursor) < 0 || Number(v.max_cursor) > explicitIds.length)) throw new Error("Invalid parallel tagging trial cursor");
  return { run_id: runId, models: v.models as string[], concurrency: Number(v.concurrency), ...(v.max_cursor === undefined ? {} : {max_cursor: Number(v.max_cursor)}) };
}
export function parallelModel(run: ParallelTagRun, assetId: string): string {
  // Assignment survives page-size changes, restart, and failed-asset retries.
  let hash = 0; for (const c of assetId) hash = (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0;
  return run.models[hash % run.models.length];
}

/** Put one asset for each model in the trial; preserve every remaining ID once. */
export function parallelTrialOrder(run: ParallelTagRun, ids: string[], trialSize = 12): string[] {
  if (!Number.isSafeInteger(trialSize) || trialSize < run.models.length || ids.length < trialSize) throw new Error("Trial cannot cover every model");
  const chosen = new Set<string>();
  for (const model of run.models) {
    const id = ids.find(id => parallelModel(run, id) === model);
    if (!id) throw new Error("Trial scope has no asset assigned to a selected model");
    chosen.add(id);
  }
  return [...chosen, ...ids.filter(id => !chosen.has(id))];
}
