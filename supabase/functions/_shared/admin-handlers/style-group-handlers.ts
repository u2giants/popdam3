/**
 * Style group handlers.
 *
 * Heavy operations (rebuild-style-groups, reconcile-style-group-stats,
 * cleanup-mega-group-tags) run in the Railway worker — not here.
 * Only lightweight / cursor-batched helpers belong in this file.
 */

import { err, formatPostgrestError, json, serviceClient } from "../admin-utils.ts";

// ── relink-orphaned-assets ──────────────────────────────────────────
// One call processes up to 500 orphaned assets then returns done+cursor.
// The browser polls until done: true.

export async function handleRelinkOrphanedAssets(body: Record<string, unknown>) {
  const cursor = typeof body.cursor === "string" ? body.cursor : null;
  const BATCH_SIZE = 500;
  const db = serviceClient();

  let q = db
    .from("assets")
    .select("id, relative_path")
    .is("style_group_id", null)
    .eq("is_deleted", false)
    .order("id", { ascending: true })
    .limit(BATCH_SIZE);
  if (cursor) q = q.gt("id", cursor);

  const { data: orphans, error: orphanErr } = await q;
  if (orphanErr) return err(`Failed to fetch orphaned assets: ${formatPostgrestError(orphanErr)}`, 500);
  if (!orphans || orphans.length === 0) {
    return json({ ok: true, relinked: 0, errors: 0, done: true, cursor: null });
  }

  // Build group-path map once per batch (sorted longest-first for specificity)
  const { data: groups, error: groupErr } = await db
    .from("style_groups")
    .select("id, folder_path")
    .not("folder_path", "is", null);
  if (groupErr) return err(`Failed to fetch style groups: ${formatPostgrestError(groupErr)}`, 500);

  const sortedPaths = (groups ?? [])
    .filter((g) => g.folder_path)
    .map((g) => ({ id: g.id as string, path: g.folder_path as string }))
    .sort((a, b) => b.path.length - a.path.length);

  let relinked = 0;
  let errors = 0;
  let lastId = cursor;

  for (const asset of orphans) {
    lastId = asset.id as string;
    const match = sortedPaths.find((g) => (asset.relative_path as string).startsWith(g.path));
    if (!match) continue;

    const { error: updateErr } = await db
      .from("assets")
      .update({ style_group_id: match.id })
      .eq("id", asset.id)
      .is("style_group_id", null);

    if (updateErr) errors++;
    else relinked++;
  }

  const done = orphans.length < BATCH_SIZE;
  return json({ ok: true, relinked, errors, done, cursor: done ? null : lastId });
}
