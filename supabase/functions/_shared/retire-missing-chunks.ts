/**
 * Soft-deletes records whose file is gone from the NAS, a few at a time (#1117).
 *
 * Each soft delete fires per-row search-index triggers that rebuild the
 * record's and its style group's search documents. A 100-row UPDATE hit the
 * database statement timeout on the live library; the edge function failed
 * after the revival markers were written, the bridge retried, and the
 * reconcile step finally aborted reporting nothing. Small chunks keep every
 * statement short, a failed chunk removes the markers it just wrote, and the
 * caller gets the count retired before the failure.
 */

export interface RetireChunkDb {
  /** Inserts revival markers; returns the inserted history row ids. */
  insertHistory: (rows: Array<{ asset_id: string; old_relative_path: string }>) => Promise<{ ids: string[]; error?: string }>;
  /** Soft-deletes still-live records; returns the ids actually changed. */
  softDelete: (assetIds: string[]) => Promise<{ ids: string[]; error?: string }>;
  /** Removes history rows by id (compensation for a failed chunk). */
  deleteHistory: (historyIds: string[]) => Promise<{ error?: string }>;
}

export interface RetireChunkResult {
  retired: number;
  error?: string;
}

export const RETIRE_MISSING_CHUNK = 10;

export async function retireMissingInChunks(
  rows: Array<{ id: string; relative_path: string }>,
  db: RetireChunkDb,
  chunkSize = RETIRE_MISSING_CHUNK,
): Promise<RetireChunkResult> {
  let retired = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    // History first: without the marker a returning file could not revive the record.
    const history = await db.insertHistory(chunk.map((r) => ({ asset_id: r.id, old_relative_path: r.relative_path })));
    if (history.error) return { retired, error: history.error };
    const updated = await db.softDelete(chunk.map((r) => r.id));
    if (updated.error) {
      await db.deleteHistory(history.ids);
      return { retired, error: updated.error };
    }
    retired += updated.ids.length;
  }
  return { retired };
}
