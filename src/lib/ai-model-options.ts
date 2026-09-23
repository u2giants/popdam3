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
