export function modelAllowedForTask(modelId: string, taskKey: string, fallback = false): boolean {
  if (!modelId.startsWith("google-direct/") || !modelId.endsWith(":batch")) return true;
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
