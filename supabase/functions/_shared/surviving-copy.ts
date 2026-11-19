/**
 * Proof lookup for the missing-file step (#1198): the live record at another
 * path that holds the same file as a record whose own file is gone from the
 * NAS. Identity is (filename, file_size, quick_hash) — a hint that collides
 * for template-derived files (#51), so this is interim proof until foolproof
 * move identity (NAS file identity + full-content fallback) lands.
 *
 * Used by agent-api's retire-missing-assets (hide only with proof) and
 * admin-api's restore-missing-assets (restore only without proof).
 */
import type { ServiceClient } from "./service-client.ts";
import { provenSurvivingCopy, type RetirementIdentity } from "./stale-asset-retirement.ts";

/** Returns the survivor proving a move, or null when the record must keep its place. */
export async function findSurvivingCopy(db: ServiceClient, stale: RetirementIdentity): Promise<RetirementIdentity | null> {
  if (!stale.filename || !stale.file_size || !stale.quick_hash) return null;
  const { data, error } = await db
    .from("assets")
    .select("id, filename, quick_hash, file_size, relative_path, is_deleted")
    .eq("is_deleted", false)
    .eq("filename", stale.filename)
    .eq("file_size", stale.file_size)
    .eq("quick_hash", stale.quick_hash)
    .neq("id", stale.id)
    .neq("relative_path", stale.relative_path)
    .limit(2);
  if (error) throw new Error(error.message);
  // The record's own hidden/live state is the caller's question; the identity
  // match is ours, so the refusal check sees the pair as both live.
  return provenSurvivingCopy(
    { ...stale, is_deleted: false },
    (data ?? []) as RetirementIdentity[],
    stale.relative_path,
  );
}
