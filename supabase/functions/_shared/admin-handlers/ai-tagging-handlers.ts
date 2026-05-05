/**
 * AI tagging admin-api handlers.
 *
 * Bulk AI tagging (bulk-ai-tag / bulk-ai-tag-all) was removed: the Railway
 * worker handles all bulk tagging via persistent operations. Only lightweight
 * read-only helpers remain here.
 */

import { serviceClient } from "../service-client.ts";
import { err, json } from "../http.ts";

// ── count-untagged-assets ────────────────────────────────────────────

export async function handleCountUntaggedAssets() {
  const db = serviceClient();

  // Fetch style_group_ids that already have a tagged asset (Set for O(1) lookup)
  const { data: taggedGroupRows } = await db
    .from("assets")
    .select("style_group_id")
    .eq("is_deleted", false)
    .eq("status", "tagged")
    .not("ai_tagged_at", "is", null)
    .not("style_group_id", "is", null)
    .limit(100_000);

  const taggedGroupSet = new Set<string>(
    (taggedGroupRows ?? []).map((r) => r.style_group_id as string),
  );

  // Fetch style_group_ids that have taggable assets (non-packaging, with thumbnail)
  const { data: taggableGroupRows } = await db
    .from("assets")
    .select("style_group_id")
    .eq("is_deleted", false)
    .not("thumbnail_url", "is", null)
    .not("style_group_id", "is", null)
    .not("primary_sort_tier", "in", "(4,8)")
    .limit(100_000);

  const taggableGroupSet = new Set<string>(
    (taggableGroupRows ?? []).map((r) => r.style_group_id as string),
  );

  let groupsNeedingTag = 0;
  for (const id of taggableGroupSet) {
    if (!taggedGroupSet.has(id)) groupsNeedingTag++;
  }

  const { count: ungroupedCount } = await db
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("is_deleted", false)
    .not("thumbnail_url", "is", null)
    .is("style_group_id", null)
    .neq("status", "tagged")
    .not("primary_sort_tier", "in", "(4,8)");

  const { count: totalWithThumb } = await db
    .from("assets")
    .select("*", { count: "exact", head: true })
    .eq("is_deleted", false)
    .not("thumbnail_url", "is", null);

  const smartCount = groupsNeedingTag + (ungroupedCount ?? 0);

  return json({
    ok: true,
    count: smartCount,
    totalWithThumbnails: totalWithThumb ?? 0,
    waitingForSiblings: 0,
  });
}
