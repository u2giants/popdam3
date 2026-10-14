export const AI_MODEL_ENDPOINTS = ["openrouter", "google-direct", "meta-direct", "scaledown-direct"] as const;

export type AiModelEndpoint = (typeof AI_MODEL_ENDPOINTS)[number];
export type AiModelPool = Partial<Record<AiModelEndpoint, string[]>>;

export function aiModelEndpoint(modelId: string): AiModelEndpoint {
  if (modelId.startsWith("google-direct/")) return "google-direct";
  if (modelId.startsWith("meta-direct/")) return "meta-direct";
  if (modelId.startsWith("scaledown/")) return "scaledown-direct";
  return "openrouter";
}

export function normalizeAiModelPool(value: unknown): AiModelPool {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const pool: AiModelPool = {};
  for (const endpoint of AI_MODEL_ENDPOINTS) {
    const models = raw[endpoint];
    if (!Array.isArray(models)) continue;
    pool[endpoint] = [...new Set(models.filter((model): model is string => typeof model === "string" && model.trim().length > 0))].sort();
  }
  return pool;
}

export function modelInPool(modelId: string, pool: AiModelPool): boolean {
  const endpointModels = pool[aiModelEndpoint(modelId)];
  return endpointModels === undefined || endpointModels.includes(modelId);
}

export function sameAiModelPool(left: unknown, right: unknown): boolean {
  const a = normalizeAiModelPool(left);
  const b = normalizeAiModelPool(right);
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  return aKeys.length === bKeys.length
    && aKeys.every((key, index) => key === bKeys[index]
      && JSON.stringify(a[key as AiModelEndpoint]) === JSON.stringify(b[key as AiModelEndpoint]));
}

export function modelAllowedForTask(modelId: string, taskKey: string, fallback = false): boolean {
  // Every `:batch` variant (OpenRouter or direct Gemini) needs the durable
  // asynchronous path, which only primary Image Tagging implements.
  if (!modelId.trim().endsWith(":batch")) return true;
  return taskKey === "vision_tagging" && !fallback;
}

export function preserveCatalogOnWarning<T extends { id: string }>(
  previous: T[] | undefined,
  incoming: T[],
  warning: string | null | undefined,
): T[] {
  if (!warning || !previous?.length) return incoming;
  const merged = new Map(previous.map((model) => [model.id, model]));
  for (const model of incoming) merged.set(model.id, model);
  return [...merged.values()];
}

/** Catalog payload with a warning keeps the last good catalog instead of discarding it. */
export function catalogWarningOf(data: unknown): string | null {
  const warning = (data as { catalog_warning?: unknown } | null | undefined)?.catalog_warning;
  return typeof warning === "string" && warning.trim() ? warning : null;
}
