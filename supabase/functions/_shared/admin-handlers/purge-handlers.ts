/**
 * Extracted admin-api handler for purging old assets.
 */

import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";

export async function handlePurgeOldAssets(body: Record<string, unknown>) {
  const cutoffDate = typeof body.cutoff_date === "string" ? body.cutoff_date : null;
  if (!cutoffDate) return err("cutoff_date is required");

  const BATCH_SIZE = 200;
  const db = serviceClient();

  // Always query from 0 — deleted rows disappear from results
  const { data: oldAssets, error: fetchErr } = await db
    .from("assets")
    .select("id, style_group_id, modified_at")
    .eq("is_deleted", false)
    .lt("modified_at", cutoffDate)
    .order("id")
    .range(0, BATCH_SIZE - 1);

  if (fetchErr) return err(fetchErr.message, 500);
  if (!oldAssets || oldAssets.length === 0) {
    return json({
      ok: true,
      assets_purged: 0,
      groups_removed: 0,
      groups_updated: 0,
      done: true,
    });
  }

  const assetIds = oldAssets.map((a: any) => a.id);
  const affectedGroupIds = [
    ...new Set(
      oldAssets.map((a: any) => a.style_group_id).filter(Boolean),
    ),
  ] as string[];

  const { error: deleteErr } = await db
    .from("assets")
    .update({ is_deleted: true })
    .in("id", assetIds);
  if (deleteErr) return err(deleteErr.message, 500);

  let groupsRemoved = 0;
  let groupsUpdated = 0;

  if (affectedGroupIds.length > 0) {
    // Use a consolidated query to find groups with zero remaining assets
    const { data: groupCounts } = await db
      .from("assets")
      .select("style_group_id")
      .eq("is_deleted", false)
      .in("style_group_id", affectedGroupIds);

    const groupsWithAssets = new Set(
      (groupCounts ?? []).map((r: any) => r.style_group_id),
    );

    const emptyGroups = affectedGroupIds.filter((id) => !groupsWithAssets.has(id));
    const nonEmptyGroups = affectedGroupIds.filter((id) => groupsWithAssets.has(id));

    // Delete empty groups
    if (emptyGroups.length > 0) {
      const { error: delGroupErr } = await db
        .from("style_groups")
        .delete()
        .in("id", emptyGroups);
      if (!delGroupErr) groupsRemoved = emptyGroups.length;
    }

    // Refresh counts for non-empty groups
    if (nonEmptyGroups.length > 0) {
      try {
        await db.rpc("refresh_style_group_counts_batch", { p_group_ids: nonEmptyGroups });
        await db.rpc("refresh_style_group_primaries", { p_group_ids: nonEmptyGroups });
        groupsUpdated = nonEmptyGroups.length;
      } catch (e) {
        console.warn("Failed to refresh style group stats after purge:", e);
      }
    }
  }

  // Check if there are more assets to purge
  const { count: remaining } = await db
    .from("assets")
    .select("id", { count: "exact", head: true })
    .eq("is_deleted", false)
    .lt("modified_at", cutoffDate);

  return json({
    ok: true,
    assets_purged: assetIds.length,
    groups_removed: groupsRemoved,
    groups_updated: groupsUpdated,
    done: (remaining ?? 0) === 0,
    remaining: remaining ?? 0,
  });
}

// ── handlePurgeExcludedSubfolderAssets ──────────────────────────────
// Soft-deletes assets whose relative_path contains an excluded subfolder
// segment (_old or SAMPLE, case-insensitive exact segment match).
// Follows the same batch + group-cleanup pattern as handlePurgeOldAssets.

export async function handlePurgeExcludedSubfolderAssets() {
  const BATCH_SIZE = 500;
  const db = serviceClient();

  // Two queries (one per pattern) to avoid PostgREST OR regex parsing issues.
  // Both use case-insensitive regex (~*) to match the segment exactly.
  const [q1, q2] = await Promise.all([
    db.from("assets")
      .select("id, style_group_id")
      .eq("is_deleted", false)
      .filter("relative_path", "~*", "(^|/)_old(/|$)")
      .order("id")
      .range(0, BATCH_SIZE - 1),
    db.from("assets")
      .select("id, style_group_id")
      .eq("is_deleted", false)
      .filter("relative_path", "~*", "(^|/)sample(/|$)")
      .order("id")
      .range(0, BATCH_SIZE - 1),
  ]);

  if (q1.error) return err(q1.error.message, 500);
  if (q2.error) return err(q2.error.message, 500);

  // Deduplicate (an asset could match both patterns if path has both)
  const seen = new Set<string>();
  const assets = [...(q1.data ?? []), ...(q2.data ?? [])].filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  if (assets.length === 0) {
    return json({ ok: true, assets_purged: 0, groups_removed: 0, groups_updated: 0, done: true });
  }

  const assetIds = assets.map((a: any) => a.id);
  const affectedGroupIds = [
    ...new Set(assets.map((a: any) => a.style_group_id).filter(Boolean)),
  ] as string[];

  const { error: deleteErr } = await db
    .from("assets")
    .update({ is_deleted: true })
    .in("id", assetIds);
  if (deleteErr) return err(deleteErr.message, 500);

  let groupsRemoved = 0;
  let groupsUpdated = 0;

  if (affectedGroupIds.length > 0) {
    const { data: groupCounts } = await db
      .from("assets")
      .select("style_group_id")
      .eq("is_deleted", false)
      .in("style_group_id", affectedGroupIds);

    const groupsWithAssets = new Set((groupCounts ?? []).map((r: any) => r.style_group_id));
    const emptyGroups = affectedGroupIds.filter((id) => !groupsWithAssets.has(id));
    const nonEmptyGroups = affectedGroupIds.filter((id) => groupsWithAssets.has(id));

    if (emptyGroups.length > 0) {
      const { error: delGroupErr } = await db.from("style_groups").delete().in("id", emptyGroups);
      if (!delGroupErr) groupsRemoved = emptyGroups.length;
    }

    if (nonEmptyGroups.length > 0) {
      try {
        await db.rpc("refresh_style_group_counts_batch", { p_group_ids: nonEmptyGroups });
        await db.rpc("refresh_style_group_primaries", { p_group_ids: nonEmptyGroups });
        groupsUpdated = nonEmptyGroups.length;
      } catch (e) {
        console.warn("Failed to refresh style group stats after excluded-subfolder purge:", e);
      }
    }
  }

  // Check if more remain (batch may not have covered everything)
  const [c1, c2] = await Promise.all([
    db.from("assets").select("id", { count: "exact", head: true }).eq("is_deleted", false).filter("relative_path", "~*", "(^|/)_old(/|$)"),
    db.from("assets").select("id", { count: "exact", head: true }).eq("is_deleted", false).filter("relative_path", "~*", "(^|/)sample(/|$)"),
  ]);
  const remaining = (c1.count ?? 0) + (c2.count ?? 0);

  return json({
    ok: true,
    assets_purged: assetIds.length,
    groups_removed: groupsRemoved,
    groups_updated: groupsUpdated,
    done: remaining === 0,
    remaining,
  });
}
