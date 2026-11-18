// Pure planning for the rebuild-character-stats admin route (#1095).
// The route publishes every changed character's count and priority in ONE
// write, so a failure never leaves a half-reset catalog.

export interface CharacterStatsRow {
  id: string;
  name: string;
  property_id: string;
  usage_count: number;
  is_priority: boolean;
}

/** Full rows (for one atomic upsert) for characters whose stats change. */
export function planCharacterStats(
  characters: CharacterStatsRow[],
  tally: Map<string, number>,
  threshold: number,
): { changed: CharacterStatsRow[]; priorityCount: number } {
  const changed: CharacterStatsRow[] = [];
  let priorityCount = 0;
  for (const c of characters) {
    const usage_count = tally.get(c.id) ?? 0;
    const is_priority = usage_count >= threshold;
    if (is_priority) priorityCount++;
    if (usage_count !== c.usage_count || is_priority !== c.is_priority) {
      changed.push({ ...c, usage_count, is_priority });
    }
  }
  return { changed, priorityCount };
}
