/** Bound each PostgREST request to the rows still belonging to this export page. */
export function exportRange(offset: number, remaining: number, maximum = 1000): [number, number] {
  return [offset, offset + Math.min(maximum, remaining) - 1];
}

/** Every exported row needs its complete stable identity. */
export function exportOrderColumns(table: string): string[] {
  return table === "asset_characters" ? ["asset_id", "character_id"] : ["id"];
}

export interface ManifestEntry {
  table: string;
  rows: number;
  chunks: number;
}

/**
 * Build one manifest row from a PostgREST exact count. A failed or missing
 * count must never be reported as an empty table (#1082): throw instead so
 * no complete-looking manifest is released.
 */
export function manifestEntry(
  table: string,
  count: number | null | undefined,
  error: { message?: string } | null | undefined,
  chunkSize: number,
): ManifestEntry {
  if (error) throw new Error(`Count failed for ${table}: ${error.message ?? "unknown error"}`);
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Count missing for ${table}`);
  }
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) throw new Error("Invalid chunk_size");
  return { table, rows: count, chunks: count === 0 ? 0 : Math.ceil(count / chunkSize) };
}

/** Rows a given chunk must contain for the download to count as complete (#1084). */
export function expectedChunkRows(totalRows: number, chunk: number, chunkSize: number): number {
  return Math.max(0, Math.min(chunkSize, totalRows - chunk * chunkSize));
}

/**
 * One restorable INSERT for an exported row. The row travels as JSON and the
 * target table's own column types decode it (jsonb_populate_record), so a JSON
 * array lands correctly in both jsonb and Postgres array columns. Naming the
 * columns on both sides makes an unknown column fail the restore instead of
 * being silently dropped.
 */
export function insertRowSQL(target: string, row: Record<string, unknown>): string {
  const cols = Object.keys(row).map((c) => `"${c.replace(/"/g, '""')}"`).join(", ");
  const json = JSON.stringify(row).replace(/'/g, "''");
  return `INSERT INTO ${target} (${cols}) SELECT ${cols} FROM jsonb_populate_record(NULL::${target}, '${json}'::jsonb);`;
}
