import { db } from "../supabase.js";
import { logger } from "../logger.js";
import type { BatchResult, OpState } from "../types.js";

const BATCH_SIZE = 500;

export async function handleRelinkOrphanedAssets(opState: OpState): Promise<BatchResult> {
  const client = db();
  const cursor = (opState.cursor === 0 || opState.cursor === null) ? null : opState.cursor as string;

  let q = client
    .from("assets")
    .select("id, relative_path")
    .is("style_group_id", null)
    .eq("is_deleted", false)
    .order("id", { ascending: true })
    .limit(BATCH_SIZE);
  if (cursor) q = q.gt("id", cursor);

  const { data: orphans, error: orphanErr } = await q;
  if (orphanErr) return { ok: false, done: false, error: orphanErr.message };
  if (!orphans || orphans.length === 0) return { ok: true, done: true, relinked: 0, errors: 0 };

  // Build group-path map once per batch (sorted longest-first for specificity)
  const { data: groups, error: groupErr } = await client
    .from("style_groups")
    .select("id, folder_path")
    .not("folder_path", "is", null);
  if (groupErr) return { ok: false, done: false, error: groupErr.message };

  const sortedPaths = (groups ?? [])
    .filter((g: { folder_path: string | null }) => g.folder_path)
    .map((g: { id: string; folder_path: string }) => ({ id: g.id, path: g.folder_path }))
    .sort((a: { path: string }, b: { path: string }) => b.path.length - a.path.length);

  let relinked = 0;
  let errors = 0;
  let lastId = cursor;

  for (const asset of orphans) {
    lastId = asset.id as string;
    const match = sortedPaths.find((g: { path: string }) => (asset.relative_path as string).startsWith(g.path));
    if (!match) continue;

    const { error: updateErr } = await client
      .from("assets")
      .update({ style_group_id: (match as { id: string }).id })
      .eq("id", asset.id)
      .is("style_group_id", null);

    if (updateErr) {
      logger.warn("relink-orphaned: failed to update asset", { assetId: asset.id, error: updateErr.message });
      errors++;
    } else {
      relinked++;
    }
  }

  const done = orphans.length < BATCH_SIZE;
  return { ok: true, done, relinked, errors, nextOffset: done ? null : lastId };
}
