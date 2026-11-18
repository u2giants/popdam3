/**
 * Decide which style groups are empty after a purge batch (popdam3#1078).
 *
 * Each group is checked on its own with a one-row probe, so a result cap can
 * never hide an occupied group, and any lookup error aborts the decision so
 * no group is deleted on incomplete evidence.
 */

// deno-lint-ignore no-explicit-any
type Db = any;

export type OccupancyResult =
  | { ok: true; empty: string[]; occupied: string[] }
  | { ok: false; error: string };

export async function partitionStyleGroupsByOccupancy(
  db: Db,
  groupIds: string[],
  concurrency = 20,
): Promise<OccupancyResult> {
  const empty: string[] = [];
  const occupied: string[] = [];
  for (let i = 0; i < groupIds.length; i += concurrency) {
    const chunk = groupIds.slice(i, i + concurrency);
    const results = await Promise.all(chunk.map(async (id) => {
      const { data, error } = await db
        .from("assets")
        .select("id")
        .eq("is_deleted", false)
        .eq("style_group_id", id)
        .limit(1);
      return { id, data, error };
    }));
    for (const r of results) {
      if (r.error || !Array.isArray(r.data)) {
        return { ok: false, error: r.error?.message ?? `occupancy lookup failed for group ${r.id}` };
      }
      (r.data.length > 0 ? occupied : empty).push(r.id);
    }
  }
  return { ok: true, empty, occupied };
}
