/**
 * Tag propagation handler — persistent worker version.
 *
 * Calls the propagate_group_tags_batch RPC directly.
 * Same logic as the RPC_DIRECT_OPS path in bulk-job-runner/index.ts.
 */

import { db } from "../supabase.js";
import { logger } from "../logger.js";
import type { BatchResult, OpState } from "../types.js";

export async function handlePropagateGroupTags(opState: OpState): Promise<BatchResult> {
  const client = db();
  const rpcCursor =
    typeof opState.cursor === "string" && opState.cursor !== "0" && opState.cursor !== ""
      ? opState.cursor
      : null;

  const { data, error: rpcErr } = await client.rpc("propagate_group_tags_batch", {
    p_cursor: rpcCursor,
    p_batch_size: 200,
  });

  if (rpcErr) {
    logger.error("propagate-group-tags: rpc error", { error: rpcErr.message });
    return { ok: false, done: false, error: rpcErr.message };
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return { ok: false, done: false, error: "No result from propagate_group_tags_batch" };
  }

  return {
    ok: true,
    done: row.done ?? true,
    propagated: row.propagated ?? 0,
    skipped: row.skipped ?? 0,
    nextOffset: row.next_cursor ?? rpcCursor,
  };
}
