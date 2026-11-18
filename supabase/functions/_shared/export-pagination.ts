/** Bound each PostgREST request to the rows still belonging to this export page. */
export function exportRange(offset: number, remaining: number, maximum = 1000): [number, number] {
  return [offset, offset + Math.min(maximum, remaining) - 1];
}


/** Every exported row needs its complete stable identity. */
export function exportOrderColumns(table: string): string[] {
  return table === "asset_characters" ? ["asset_id", "character_id"] : ["id"];
}

/**
 * Column that fixes a table at the manifest's cutoff time (#1132). Rows
 * created after the cutoff are left out of both the count and every chunk,
 * so a live export stays consistent while ingestion keeps adding rows.
 * asset_characters has no timestamp; it is still checked strictly.
 */
export function exportCutoffColumn(table: string): string | null {
  switch (table) {
    case "asset_characters": return null;
    case "asset_path_history": return "detected_at";
    case "erp_enrichment_log": return "applied_at";
    case "erp_sync_runs": return "started_at";
    default: return "created_at";
  }
}

/** Tables whose created_at may be null; null rows predate the cutoff. */
export function cutoffAllowsNull(table: string): boolean {
  return table === "style_groups";
}

/** Cursor the next chunk resumes after (#1133 keyset paging). */
export type ExportCursor = string[];

export function lastKey(table: string, row: Record<string, unknown>): ExportCursor {
  return exportOrderColumns(table).map((c) => String(row[c]));
}

export function encodeCursor(key: ExportCursor): string {
  return btoa(JSON.stringify(key)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(table: string, text: string | null): ExportCursor | null {
  if (!text) return null;
  const parsed = JSON.parse(atob(text.replace(/-/g, "+").replace(/_/g, "/")));
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!Array.isArray(parsed) || parsed.length !== exportOrderColumns(table).length || !parsed.every((v) => typeof v === "string" && uuid.test(v))) {
    throw new Error("Invalid after cursor");
  }
  return parsed;
}

/** PostgREST `or` filter selecting rows strictly after the cursor in key order. */
export function keysetFilter(table: string, key: ExportCursor): string {
  const cols = exportOrderColumns(table);
  const parts: string[] = [];
  for (let i = 0; i < cols.length; i++) {
    const eqs = cols.slice(0, i).map((c, j) => `${c}.eq.${key[j]}`);
    const gt = `${cols[i]}.gt.${key[i]}`;
    parts.push(eqs.length ? `and(${[...eqs, gt].join(",")})` : gt);
  }
  return parts.join(",");
}

/**
 * Statement that clears a table before its first chunk is restored (#1134).
 * Shared core master data is never wiped: its rows are upserted instead.
 * PopDAM tables use DELETE under session_replication_role=replica, which
 * never cascades into other applications' tables (TRUNCATE ... CASCADE
 * reached append-only plm tables and was refused).
 */
export function clearTableSQL(target: string): string | null {
  return target.startsWith("core.") ? null : `DELETE FROM ${target};`;
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
  const names = Object.keys(row).map((c) => `"${c.replace(/"/g, '""')}"`);
  const cols = names.join(", ");
  const json = JSON.stringify(row).replace(/'/g, "''");
  const base = `INSERT INTO ${target} (${cols}) SELECT ${cols} FROM jsonb_populate_record(NULL::${target}, '${json}'::jsonb)`;
  if (!target.startsWith("core.")) return `${base};`;
  // Shared master data: update in place, never delete (#1134).
  const sets = names.filter((n) => n !== '"id"').map((n) => `${n} = EXCLUDED.${n}`).join(", ");
  return `${base} ON CONFLICT ("id") DO ${sets ? `UPDATE SET ${sets}` : "NOTHING"};`;
}
