/**
 * Merges flagged assets sent by a compat audit preview scan into the stored list.
 * Agents send only newly flagged assets, so the stored list grows by append.
 * Entries are keyed by asset id: a retried or repeated write never duplicates,
 * and older agents that still send their full list merge to the same result.
 */
export function mergeCompatAuditFlagged(
  stored: unknown,
  incoming: unknown,
): Array<Record<string, unknown>> {
  const merged: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const entry of [...asEntries(stored), ...asEntries(incoming)]) {
    const id = entry.id;
    if (typeof id !== "string" || seen.has(id)) continue;
    seen.add(id);
    merged.push(entry);
  }
  return merged;
}

function asEntries(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null);
}
