/**
 * Tag propagation handlers — thin wrappers around the
 * propagate_group_tags_batch database function.
 *
 * The heavy logic now lives entirely in plpgsql (zero network hops).
 */

import { serviceClient } from "../service-client.ts";
import { err, json } from "../http.ts";

/**
 * Bulk propagate: calls the DB function directly.
 * Accepts `offset` (uuid cursor) from the bulk-job-runner.
 */
export async function handleBulkPropagateGroupTags(body: Record<string, unknown>) {
  const cursor = typeof body.offset === "string" && body.offset !== "0" ? body.offset : null;
  const batchSize = typeof body.batch_size === "number" ? body.batch_size : 200;
  const db = serviceClient();

  const { data, error } = await db.rpc("propagate_group_tags_batch", {
    p_cursor: cursor,
    p_batch_size: batchSize,
  });

  if (error) return err(error.message, 500);

  // The RPC returns an array of one row
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return err("No result from propagate_group_tags_batch", 500);

  return json({
    ok: true,
    propagated: row.propagated ?? 0,
    skipped: row.skipped ?? 0,
    done: row.done ?? true,
    nextOffset: row.next_cursor ?? cursor,
  });
}

export async function handleCountGroupsForPropagation() {
  const db = serviceClient();

  const { count, error } = await db
    .from("style_groups")
    .select("*", { count: "exact", head: true });

  if (error) return err(error.message, 500);

  return json({ ok: true, total_groups: count ?? 0 });
}
