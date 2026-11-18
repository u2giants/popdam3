/**
 * Export a flat thumbnail manifest as CSV for migration.
 *
 * GET /export-thumbnail-manifest
 *
 * Returns CSV with columns:
 *   old_asset_id, relative_path, filename, quick_hash, thumbnail_url
 *
 * Only includes rows where thumbnail_url IS NOT NULL.
 * Keyset-paginates (1000-row pages) and streams each page as it arrives,
 * so memory stays bounded as the catalog grows (#1099).
 *
 * Auth: admin JWT or service role key.
 */

import { requireAdmin } from "../_shared/admin-auth.ts";
import { corsServe, err } from "../_shared/http.ts";
import { serviceClient } from "../_shared/service-client.ts";
import { type FetchManifestPage, type ManifestRow, streamThumbnailManifest } from "../_shared/thumbnail-manifest.ts";

async function authorizeAdmin(req: Request): Promise<boolean> {
  const auth = await requireAdmin(req, { parseMode: "loose", allowServiceRole: true });
  return auth.ok;
}

const COLUMNS = "id,relative_path,filename,quick_hash,thumbnail_url";

corsServe(async (req) => {
  try {
    if (!(await authorizeAdmin(req))) {
      return err("Unauthorized", 401);
    }

    const db = serviceClient();

    // Cheap count for the X-Row-Count header; rows themselves are streamed.
    const { count, error: countError } = await db
      .from("assets")
      .select("id", { count: "exact", head: true })
      .not("thumbnail_url", "is", null)
      .eq("is_deleted", false);
    if (countError) return err(countError.message, 500);

    const fetchPage: FetchManifestPage = async (afterId, limit) => {
      let q = db
        .from("assets")
        .select(COLUMNS)
        .not("thumbnail_url", "is", null)
        .eq("is_deleted", false);
      if (afterId !== null) q = q.gt("id", afterId);
      const { data, error } = await q.order("id").limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as ManifestRow[];
    };

    return new Response(streamThumbnailManifest(fetchPage), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="thumbnail_manifest.csv"`,
        "X-Row-Count": count === null || count === undefined ? "?" : String(count),
      },
    });
  } catch (e) {
    return err(String(e), 500);
  }
});
