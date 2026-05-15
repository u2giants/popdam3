/**
 * Handlers for finding and removing .ai assets that have a .pdf sibling
 * with the same base filename in the same directory.
 *
 * Rule: if assets A.ai and A.pdf exist in the same folder, A.ai is redundant
 * (the PDF is the canonical distributable; the .ai is the source).
 * This removes A.ai: soft-deletes the DB record and deletes its DO Spaces thumbnail.
 */

import { err, json } from "../http.ts";
import { serviceClient } from "../service-client.ts";
import { credentialsFromConfig, deleteSpacesObjects } from "../spaces-delete.ts";

// ── Query: find .ai assets that have a .pdf sibling ──────────────────

async function queryAiDuplicates(): Promise<
  Array<{ id: string; filename: string; relative_path: string; thumbnail_url: string | null; style_group_id: string | null }>
> {
  const db = serviceClient();

  // Use a raw RPC query so we can do the regexp-based directory/basename matching in SQL.
  // Matches where a .pdf asset exists in the same folder (same dir prefix in relative_path)
  // with the same base filename (case-insensitive, ignoring the final .ext).
  const { data, error } = await db.rpc("find_ai_pdf_duplicates");
  if (error) throw new Error(`find_ai_pdf_duplicates RPC failed: ${error.message}`);

  return (data as Array<{ id: string; filename: string; relative_path: string; thumbnail_url: string | null; style_group_id: string | null }>) ?? [];
}

// ── GET: preview what would be deleted ──────────────────────────────

export async function handleFindAiPdfDuplicates() {
  try {
    const duplicates = await queryAiDuplicates();
    return json({
      ok: true,
      count: duplicates.length,
      duplicates: duplicates.map((a) => ({
        id: a.id,
        filename: a.filename,
        relative_path: a.relative_path,
        has_thumbnail: !!a.thumbnail_url,
      })),
    });
  } catch (e) {
    return err((e as Error).message, 500);
  }
}

// ── DELETE: remove .ai duplicates from DB + DO Spaces ────────────────

export async function handleDeleteAiPdfDuplicates() {
  const db = serviceClient();

  // ── 1. Find duplicates ──
  let duplicates: Array<{ id: string; filename: string; relative_path: string; thumbnail_url: string | null; style_group_id: string | null }>;
  try {
    duplicates = await queryAiDuplicates();
  } catch (e) {
    return err((e as Error).message, 500);
  }

  if (duplicates.length === 0) {
    return json({ ok: true, deleted: 0, thumbnails_deleted: 0, message: "No .ai/.pdf duplicates found" });
  }

  const assetIds = duplicates.map((d) => d.id);
  const affectedGroupIds = [...new Set(duplicates.map((d) => d.style_group_id).filter(Boolean))] as string[];

  // ── 2. Soft-delete assets in DB and clear thumbnail_url ──
  const { error: delErr } = await db
    .from("assets")
    .update({ is_deleted: true, thumbnail_url: null })
    .in("id", assetIds);

  if (delErr) return err(`DB delete failed: ${delErr.message}`, 500);

  // ── 3. Refresh style groups ──
  if (affectedGroupIds.length > 0) {
    try {
      const { data: groupCounts } = await db
        .from("assets")
        .select("style_group_id")
        .eq("is_deleted", false)
        .in("style_group_id", affectedGroupIds);

      const groupsWithAssets = new Set((groupCounts ?? []).map((r: { style_group_id: string }) => r.style_group_id));
      const emptyGroups = affectedGroupIds.filter((id) => !groupsWithAssets.has(id));
      const nonEmptyGroups = affectedGroupIds.filter((id) => groupsWithAssets.has(id));

      if (emptyGroups.length > 0) {
        await db.from("style_groups").delete().in("id", emptyGroups);
      }
      if (nonEmptyGroups.length > 0) {
        await db.rpc("refresh_style_group_counts_batch", { p_group_ids: nonEmptyGroups });
        await db.rpc("refresh_style_group_primaries", { p_group_ids: nonEmptyGroups });
      }
    } catch (e) {
      console.warn("ai-duplicate delete: group refresh failed (non-fatal):", (e as Error).message);
    }
  }

  // ── 4. Delete thumbnails from DO Spaces ──
  let thumbDeleted = 0;
  let thumbErrors: string[] = [];

  const thumbnailKeys = duplicates
    .filter((d) => d.thumbnail_url)
    .map((d) => `thumbnails/${d.id}.jpg`);

  if (thumbnailKeys.length > 0) {
    const { data: configRows } = await db
      .from("admin_config")
      .select("key, value")
      .in("key", ["DO_SPACES_KEY", "DO_SPACES_SECRET", "SPACES_CONFIG"]);

    const configMap: Record<string, unknown> = {};
    for (const row of configRows ?? []) configMap[row.key] = row.value;

    const creds = credentialsFromConfig(configMap);
    if (creds) {
      const result = await deleteSpacesObjects(thumbnailKeys, creds);
      thumbDeleted = result.deleted + result.notFound;
      thumbErrors = result.errors;
      if (result.errors.length > 0) {
        console.warn("ai-duplicate delete: some thumbnail deletions failed:", result.errors);
      }
    } else {
      console.warn("ai-duplicate delete: DO Spaces credentials not configured — thumbnails NOT deleted from Spaces");
    }
  }

  return json({
    ok: true,
    deleted: assetIds.length,
    thumbnails_deleted: thumbDeleted,
    thumbnail_errors: thumbErrors.length > 0 ? thumbErrors : undefined,
    message: `Deleted ${assetIds.length} .ai duplicate assets${thumbDeleted > 0 ? ` and ${thumbDeleted} thumbnails from DO Spaces` : ""}`,
  });
}
