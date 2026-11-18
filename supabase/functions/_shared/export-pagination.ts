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
  /** Rows may be deleted mid-export; chunks may come back short, never long (#1132). */
  volatile: boolean;
}

/**
 * Work queues delete finished rows while the system runs, so a live export
 * can legitimately see fewer rows than the manifest counted (#1132). The
 * insert-time cutoff still rules out extra rows; every other table must
 * match its count exactly.
 */
export function deletesDuringExport(table: string): boolean {
  return table === "processing_queue" || table === "render_queue" || table === "tiff_optimization_queue";
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
  return { table, rows: count, chunks: count === 0 ? 0 : Math.ceil(count / chunkSize), volatile: deletesDuringExport(table) };
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

/**
 * Statement that clears a table before its first chunk is restored (#1134).
 * Shared core master data is never wiped: its rows are upserted instead.
 * PopDAM tables use DELETE under session_replication_role=replica, which
 * never cascades into other applications' tables (TRUNCATE ... CASCADE
 * reached the append-only plm tables and was refused).
 */
export function clearTableSQL(target: string): string | null {
  return target.startsWith("core.") ? null : `DELETE FROM ${target};`;
}

/** Largest chunk the exporter serves; the manifest must use the same value (#1096). */
export const MAX_CHUNK = 10000;

/** Clamp a requested chunk size identically in manifest and chunk modes (#1096). */
export function clampChunkSize(requested: number): number {
  if (!Number.isSafeInteger(requested) || requested < 1) throw new Error("Invalid chunk_size");
  return Math.min(requested, MAX_CHUNK);
}

/**
 * Insert-time column that freezes a table at the manifest's cutoff (#1132).
 * Rows ingested after the cutoff are excluded from both the count and every
 * chunk, so a live export sees a stable row set. null = no such column
 * (low-churn master data); its live count still guards completeness.
 */
export function snapshotColumn(table: string): string | null {
  switch (table) {
    case "licensors":
    case "properties":
    case "asset_characters":
      return null;
    case "erp_sync_runs":
      return "started_at";
    case "asset_path_history":
      return "detected_at";
    case "erp_enrichment_log":
      return "applied_at";
    default:
      return "created_at";
  }
}

/** Opaque keyset cursor: the order-key values of the last exported row. */
export function encodeCursor(table: string, row: Record<string, unknown>): string {
  const key = exportOrderColumns(table).map((c) => {
    const v = row[c];
    if (v === null || v === undefined) throw new Error(`Row in ${table} has no ${c}`);
    return String(v);
  });
  return btoa(JSON.stringify(key)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(table: string, cursor: string): string[] {
  const b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
  const key = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
  const cols = exportOrderColumns(table);
  if (!Array.isArray(key) || key.length !== cols.length || !key.every((v) => typeof v === "string")) {
    throw new Error("Invalid cursor");
  }
  return key;
}

function pgValue(v: string): string {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * PostgREST `or` filter selecting rows strictly after the cursor key. Keyset
 * paging, unlike offsets, never shifts when rows are inserted or deleted ahead
 * of the cursor (#1132) and never depends on chunk arithmetic (#1096).
 */
export function afterCursorFilter(table: string, key: string[]): string {
  const cols = exportOrderColumns(table);
  const terms: string[] = [];
  for (let i = 0; i < cols.length; i++) {
    const eqs = cols.slice(0, i).map((c, j) => `${c}.eq.${pgValue(key[j])}`);
    const gt = `${cols[i]}.gt.${pgValue(key[i])}`;
    terms.push(eqs.length ? `and(${[...eqs, gt].join(",")})` : gt);
  }
  return terms.join(",");
}

/** Parse the manifest's snapshot cutoff; it must be a real ISO timestamp. */
export function parseCutoff(raw: string | null): string | null {
  if (raw === null || raw === "") return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) throw new Error("Invalid cutoff");
  return new Date(t).toISOString();
}
