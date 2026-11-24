// Pure planning for the rebuild-character-stats admin route (#1095, #1301).
// Usage counts and priority live in dam.character_usage, keyed by the shared
// core.character id. The route publishes every changed row in ONE write, so a
// failure never leaves a half-reset table.

export interface CharacterUsageRow {
  core_character_id: string;
  usage_count: number;
  is_priority: boolean;
}

/**
 * Rows (for one atomic upsert) whose stats change. Covers every character
 * that has links now or had a published row before (which drops to zero).
 */
export function planCharacterStats(
  existing: CharacterUsageRow[],
  tally: Map<string, number>,
  threshold: number,
): { changed: CharacterUsageRow[]; priorityCount: number } {
  const previous = new Map(existing.map((r) => [r.core_character_id, r]));
  const ids = new Set<string>([...previous.keys(), ...tally.keys()]);
  const changed: CharacterUsageRow[] = [];
  let priorityCount = 0;
  for (const id of ids) {
    const usage_count = tally.get(id) ?? 0;
    const is_priority = usage_count >= threshold;
    if (is_priority) priorityCount++;
    const old = previous.get(id);
    if (!old || usage_count !== old.usage_count || is_priority !== old.is_priority) {
      changed.push({ core_character_id: id, usage_count, is_priority });
    }
  }
  return { changed, priorityCount };
}
