/** Bound each PostgREST request to the rows still belonging to this export page. */
export function exportRange(offset: number, remaining: number, maximum = 1000): [number, number] {
  return [offset, offset + Math.min(maximum, remaining) - 1];
}

/** Every exported row needs its complete stable identity. */
export function exportOrderColumns(table: string): string[] {
  return table === "asset_characters" ? ["asset_id", "character_id"] : ["id"];
}
