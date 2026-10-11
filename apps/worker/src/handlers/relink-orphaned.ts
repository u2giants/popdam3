import { db, type DB } from "../supabase.js";
import { logger } from "../logger.js";
import type { BatchResult, OpState } from "../types.js";

const BATCH_SIZE = 500;
const GROUP_PAGE = 1000;

/** Page through every style group with a folder_path (no silent PostgREST row cap). */
async function loadGroupPaths(client: DB): Promise<{ byPath: Map<string, string>; error?: string }> {
  const byPath = new Map<string, string>();
  let lastId: string | null = null;
  for (;;) {
    let q = client
      .from("style_groups")
      .select("id, folder_path")
      .not("folder_path", "is", null)
      .order("id", { ascending: true })
      .limit(GROUP_PAGE);
    if (lastId) q = q.gt("id", lastId);
    const { data, error } = await q;
    if (error) return { byPath, error: error.message };
    const rows = (data ?? []) as Array<{ id: string; folder_path: string | null }>;
    for (const g of rows) if (g.folder_path && !byPath.has(g.folder_path)) byPath.set(g.folder_path, g.id);
    if (rows.length < GROUP_PAGE) break;
    lastId = rows[rows.length - 1].id;
  }
  return { byPath };
}

/** Longest group folder_path that prefixes relativePath, via map lookups (no linear scan). */
export function matchGroup(relativePath: string, byPath: Map<string, string>): string | null {
  for (let i = relativePath.length; i > 0; i--) {
    const id = byPath.get(relativePath.slice(0, i));
    if (id) return id;
  }
  return null;
}

export async function handleRelinkOrphanedAssets(opState: OpState, client: DB = db()): Promise<BatchResult> {
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

  const { byPath, error: groupErr } = await loadGroupPaths(client);
  if (groupErr) return { ok: false, done: false, error: groupErr };

  // Bucket assets by target group, then one set-based update per group.
  const byGroup = new Map<string, string[]>();
  for (const asset of orphans) {
    const gid = matchGroup((asset.relative_path as string | null) ?? "", byPath);
    if (!gid) continue;
    const list = byGroup.get(gid) ?? [];
    list.push(asset.id as string);
    byGroup.set(gid, list);
  }

  let relinked = 0;
  let errors = 0;
  for (const [groupId, assetIds] of byGroup) {
    const { error: updateErr } = await client
      .from("assets")
      .update({ style_group_id: groupId })
      .in("id", assetIds)
      .is("style_group_id", null);
    if (updateErr) {
      logger.warn("relink-orphaned: failed to update assets", { groupId, count: assetIds.length, error: updateErr.message });
      errors += assetIds.length;
    } else {
      relinked += assetIds.length;
    }
  }

  const lastId = orphans[orphans.length - 1].id as string;
  const done = orphans.length < BATCH_SIZE;
  return { ok: true, done, relinked, errors, nextOffset: done ? null : lastId };
}
