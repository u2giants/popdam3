/**
 * Proof lookup for the missing-file step (#1198): the live record at another
 * path that holds the same file — or the same artwork — as a record whose own
 * file is gone from the NAS.
 *
 * Matching is tiered (item 3, owner ruling 2026-11-19): (nas_volume, nas_ino)
 * first, then content_sha256 (name-free — a renamed copy still holds the
 * artwork), then the colliding (filename, size, quick_hash) hint (KNOWN_QUIRKS
 * #51) as the last resort for records ingested before the identity columns.
 * A record is hidden only when this returns a survivor; without one the record
 * keeps its place and is marked "no longer on the NAS".
 *
 * Used by agent-api's retire-missing-assets (hide only with proof) and
 * admin-api's restore-missing-assets (restore only without proof).
 */
import type { ServiceClient } from "./service-client.ts";
import { artworkMatchTier, type FileIdentity } from "./file-identity.ts";
import { provenSurvivingCopy, type RetirementIdentity } from "./stale-asset-retirement.ts";

const IDENTITY_COLUMNS = "id, filename, quick_hash, file_size, relative_path, is_deleted, nas_volume, nas_ino, content_sha256";

async function candidates(
  db: ServiceClient,
  where: { column: string; value: string } | { column: string; value: string }[],
  stale: RetirementIdentity,
): Promise<RetirementIdentity[]> {
  const filters = Array.isArray(where) ? where : [where];
  let query = db
    .from("assets")
    .select(IDENTITY_COLUMNS)
    .eq("is_deleted", false)
    .neq("id", stale.id)
    .neq("relative_path", stale.relative_path);
  for (const f of filters) query = query.eq(f.column, f.value);
  const { data, error } = await query.limit(5);
  if (error) throw new Error(error.message);
  return (data ?? []) as RetirementIdentity[];
}

/** Returns the survivor proving the artwork survives, or null when the record must keep its place. */
export async function findSurvivingCopy(db: ServiceClient, stale: RetirementIdentity): Promise<RetirementIdentity | null> {
  const probe: FileIdentity = { ...stale, is_deleted: false };

  // Tier 1 — the same file instance (inode; a rename still proves it).
  if (stale.nas_volume && stale.nas_ino != null) {
    const rows = await candidates(db, [
      { column: "nas_volume", value: stale.nas_volume },
      { column: "nas_ino", value: String(stale.nas_ino) },
    ], stale);
    for (const row of rows) {
      if (artworkMatchTier(probe, { ...row, is_deleted: false }) === "inode") return row;
    }
  }

  // Tier 2 — byte-identical content (name-free: a renamed copy holds the artwork).
  if (stale.content_sha256) {
    const rows = await candidates(db, { column: "content_sha256", value: stale.content_sha256 }, stale);
    for (const row of rows) {
      if (artworkMatchTier(probe, { ...row, is_deleted: false }) === "content_hash") return row;
    }
  }

  // Tier 3 — the colliding hint, kept as the last resort for records ingested
  // before the identity columns (and still the strictest pair check).
  if (!stale.filename || !stale.file_size || !stale.quick_hash) return null;
  const rows = await candidates(db, [
    { column: "filename", value: stale.filename },
    { column: "file_size", value: stale.file_size as unknown as string },
    { column: "quick_hash", value: stale.quick_hash },
  ], stale);
  return provenSurvivingCopy(probe, rows, stale.relative_path);
}
