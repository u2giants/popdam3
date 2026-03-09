/**
 * Bulk tag propagation handler — iterates style groups in batches,
 * propagating product-level tags from the primary/tagged asset to siblings.
 */

import { serviceClient } from "../service-client.ts";
import { err, json } from "../http.ts";
import { propagateGroupTags } from "../tag-propagation.ts";

export async function handleBulkPropagateGroupTags(body: Record<string, unknown>) {
  const offset = typeof body.offset === "number" ? body.offset : 0;
  const BATCH_SIZE = 20;
  const db = serviceClient();

  // Fetch a batch of style groups that have at least one tagged asset
  const { data: groups, error } = await db
    .from("style_groups")
    .select("id, primary_asset_id")
    .order("id")
    .range(offset, offset + BATCH_SIZE - 1);

  if (error) return err(error.message, 500);
  if (!groups || groups.length === 0) {
    return json({ ok: true, propagated: 0, skipped: 0, done: true, nextOffset: offset });
  }

  let propagated = 0;
  let skipped = 0;

  for (const group of groups) {
    // Find source: primary asset if tagged, else first tagged asset
    let sourceId: string | null = group.primary_asset_id;

    if (sourceId) {
      const { data: src } = await db
        .from("assets")
        .select("id, ai_tagged_at")
        .eq("id", sourceId)
        .eq("is_deleted", false)
        .single();
      if (!src?.ai_tagged_at) sourceId = null;
    }

    if (!sourceId) {
      const { data: tagged } = await db
        .from("assets")
        .select("id")
        .eq("style_group_id", group.id)
        .eq("is_deleted", false)
        .not("ai_tagged_at", "is", null)
        .order("primary_sort_tier", { ascending: true })
        .limit(1)
        .maybeSingle();
      sourceId = tagged?.id ?? null;
    }

    if (!sourceId) {
      skipped++;
      continue;
    }

    const result = await propagateGroupTags(sourceId, group.id, { onlyUntagged: false });
    if (result.siblings_updated > 0 || result.tags_propagated > 0 || result.characters_propagated > 0) {
      propagated++;
    } else {
      skipped++;
    }
  }

  const done = groups.length < BATCH_SIZE;
  return json({
    ok: true,
    propagated,
    skipped,
    done,
    nextOffset: offset + groups.length,
  });
}

export async function handleCountGroupsForPropagation() {
  const db = serviceClient();

  // Count style groups that have at least one tagged asset
  const { count, error } = await db
    .from("style_groups")
    .select("*", { count: "exact", head: true });

  if (error) return err(error.message, 500);

  return json({ ok: true, total_groups: count ?? 0 });
}
