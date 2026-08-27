/**
 * Style Group metadata refresh handlers.
 *
 * These used to call `propagate_group_tags_batch`, which copied one asset's tags,
 * characters, and identity onto every sibling in the group — the cross-file
 * contamination issue #96 removes. They now perform a SAFE refresh: authoritative
 * group facts are reconciled on the Style Group itself and the group's search
 * document is rebuilt. No asset row is ever read from or written to.
 *
 * The old `bulk-propagate-group-tags` and `sync-group-tags` action names are kept
 * as compatibility aliases so the owner's existing buttons and any queued work
 * keep functioning; both return a deprecation notice.
 */

import { serviceClient } from "../service-client.ts";
import { err, json } from "../http.ts";
import { AUTHORITATIVE_TAG_MODEL, AUTHORITATIVE_TAG_SOURCE, authoritativeTagsAreCurrent, deriveAuthoritativeGroupTags } from "../tagging-metadata-policy.js";

export const LEGACY_PROPAGATION_DEPRECATION =
  "Tag propagation is deprecated and no longer copies tags between files. This ran the safe group-metadata refresh instead.";

// Source/model and the comparison are owned by the shared policy module so the
// worker and this edge path can never drift. The group RPC's DELETE is scoped by
// source AND model, so drift would leave old rows permanently un-superseded.
type GroupRow = {
  id: string;
  product_category: string | null;
  group_ai_description: string | null;
  group_ai_description_source: string | null;
  group_ai_description_model: string | null;
  group_ai_evidence_asset_ids: string[] | null;
  group_ai_tagged_at: string | null;
};

const GROUP_COLUMNS = "id, product_category, group_ai_description, group_ai_description_source, " +
  "group_ai_description_model, group_ai_evidence_asset_ids, group_ai_tagged_at";

function desiredTags(group: GroupRow) {
  return deriveAuthoritativeGroupTags(group as unknown as Record<string, unknown>).map((row: Record<string, unknown>) => ({
    tag: row.tag,
    category: row.category,
    status: "active",
    confidence: 1,
    evidence: row.evidence,
  }));
}

/** Reconcile one group's authoritative facts and rebuild its search document. */
async function refreshOneGroup(
  db: ReturnType<typeof serviceClient>,
  group: GroupRow,
): Promise<"refreshed" | "unchanged"> {
  const desired = desiredTags(group);
  const { data: stored } = await db
    .from("style_group_tags")
    .select("tag, category, status")
    .eq("style_group_id", group.id)
    .eq("source", AUTHORITATIVE_TAG_SOURCE);

  const current = authoritativeTagsAreCurrent(
    desired as Array<{ tag: string; category: string }>,
    (stored ?? []) as Array<{ tag: string; category: string; status: string }>,
  );

  if (current) {
    const { error } = await db.rpc("refresh_dam_search_documents_batch", {
      p_asset_ids: [],
      p_style_group_ids: [group.id],
      p_limit: 1,
    });
    if (error) throw new Error(error.message);
    return "unchanged";
  }

  const { error } = await db.rpc("replace_style_group_ai_profile", {
    p_style_group_id: group.id,
    p_source: AUTHORITATIVE_TAG_SOURCE,
    p_model: AUTHORITATIVE_TAG_MODEL,
    // The group's own summary is passed straight back; a refresh never invents,
    // rewrites, or blanks it.
    p_description: group.group_ai_description,
    p_tags: desired,
    p_evidence_asset_ids: group.group_ai_evidence_asset_ids ?? [],
  });
  if (error) throw new Error(error.message);

  // The RPC stamps its own source/model onto the group. If the summary came from
  // a vision model, restore that provenance so the UI does not relabel it.
  const hadOtherProvenance = Boolean(group.group_ai_description) &&
    (group.group_ai_description_source !== AUTHORITATIVE_TAG_SOURCE ||
      (group.group_ai_description_model ?? AUTHORITATIVE_TAG_MODEL) !== AUTHORITATIVE_TAG_MODEL);
  if (hadOtherProvenance) {
    const restore = await db
      .from("style_groups")
      .update({
        group_ai_description_source: group.group_ai_description_source,
        group_ai_description_model: group.group_ai_description_model,
        group_ai_evidence_asset_ids: group.group_ai_evidence_asset_ids ?? [],
        group_ai_tagged_at: group.group_ai_tagged_at,
      })
      .eq("id", group.id);
    if (restore.error) throw new Error(restore.error.message);
  }
  return "refreshed";
}

/**
 * Bulk refresh. Accepts `offset` (uuid cursor) from the Railway worker, which is
 * the primary runner; this endpoint exists for compatibility and manual use.
 */
export async function handleBulkPropagateGroupTags(body: Record<string, unknown>) {
  const cursor = typeof body.offset === "string" && body.offset !== "0" ? body.offset : null;
  const batchSize = typeof body.batch_size === "number" ? body.batch_size : 200;
  const db = serviceClient();

  let query = db.from("style_groups").select(GROUP_COLUMNS).order("id", { ascending: true }).limit(batchSize);
  if (cursor) query = query.gt("id", cursor);
  const { data, error } = await query;
  if (error) return err(error.message, 500);

  const groups = (data ?? []) as unknown as GroupRow[];
  if (!groups.length) {
    return json({
      ok: true,
      refreshed: 0,
      unchanged: 0,
      failed: 0,
      done: true,
      nextOffset: cursor,
      deprecated: true,
      deprecation_notice: LEGACY_PROPAGATION_DEPRECATION,
    });
  }

  let refreshed = 0, unchanged = 0, failed = 0;
  for (const group of groups) {
    try {
      const outcome = await refreshOneGroup(db, group);
      if (outcome === "refreshed") refreshed++;
      else unchanged++;
    } catch (refreshError) {
      failed++;
      console.error("refresh-group-metadata: group failed", {
        style_group_id: group.id,
        error: refreshError instanceof Error ? refreshError.message : String(refreshError),
        prior_provenance: {
          source: group.group_ai_description_source,
          model: group.group_ai_description_model,
          tagged_at: group.group_ai_tagged_at,
        },
      });
    }
  }

  return json({
    ok: true,
    refreshed,
    unchanged,
    failed,
    done: false,
    nextOffset: groups[groups.length - 1].id,
    deprecated: true,
    deprecation_notice: LEGACY_PROPAGATION_DEPRECATION,
  });
}

/** Single-group refresh — the action behind the "Refresh Group Metadata" button. */
export async function handleRefreshGroupMetadata(body: Record<string, unknown>) {
  const groupId = typeof body.group_id === "string" ? body.group_id : null;
  if (!groupId) return err("group_id is required");
  const db = serviceClient();
  const { data, error } = await db.from("style_groups").select(GROUP_COLUMNS).eq("id", groupId).maybeSingle();
  if (error) return err(error.message, 500);
  if (!data) return err("Style group not found", 404);

  try {
    const outcome = await refreshOneGroup(db, data as unknown as GroupRow);
    return json({
      ok: true,
      style_group_id: groupId,
      outcome,
      refreshed: outcome === "refreshed" ? 1 : 0,
      unchanged: outcome === "unchanged" ? 1 : 0,
      // Explicitly reported so no caller can mistake this for the old behavior.
      assets_modified: 0,
    });
  } catch (refreshError) {
    return err(refreshError instanceof Error ? refreshError.message : String(refreshError), 500);
  }
}

export async function handleCountGroupsForPropagation() {
  const db = serviceClient();

  const { count, error } = await db
    .from("style_groups")
    .select("*", { count: "exact", head: true });

  if (error) return err(error.message, 500);

  return json({ ok: true, total_groups: count ?? 0 });
}
