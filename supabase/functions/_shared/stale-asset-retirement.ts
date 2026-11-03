/**
 * Retiring a live record left behind when its file moved (docs/KNOWN_QUIRKS.md #81).
 * quick_hash is sampled and can collide (#51), so the caller must also have
 * confirmed on the file system that the stale path is gone.
 */

export const RETIRED_STALE_MARKER = "retired-stale-duplicate:";

export interface RetirementIdentity {
  id: string;
  filename: string | null;
  quick_hash: string | null;
  file_size: number | null;
  relative_path: string;
  is_deleted: boolean | null;
}

/** Returns why the pair must not be retired, or null when it is allowed. */
export function staleRetirementRefusal(
  stale: RetirementIdentity,
  survivor: RetirementIdentity,
  confirmedAbsentPath: string,
): string | null {
  if (stale.id === survivor.id) return "same_record";
  if (stale.is_deleted || survivor.is_deleted) return "not_live";
  if (stale.relative_path !== confirmedAbsentPath) return "path_changed_since_check";
  if (stale.relative_path === survivor.relative_path) return "same_path";
  if (!stale.quick_hash || stale.quick_hash !== survivor.quick_hash) return "hash_mismatch";
  if (!stale.filename || stale.filename !== survivor.filename) return "filename_mismatch";
  if (!stale.file_size || stale.file_size !== survivor.file_size) return "size_mismatch";
  return null;
}

const INHERITED_AI_FIELDS = [
  "ai_description",
  "scene_description",
  "cover_description",
  "art_source",
  "design_style",
  "design_ref",
] as const;

export const AI_INHERITANCE_COLUMNS = [...INHERITED_AI_FIELDS, "tags", "status", "ai_tagged_at", "ai_model"];

function isEmpty(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

/** Fields the survivor takes from the stale record. A survivor's own value always wins. */
export function inheritedAiFields(
  stale: Record<string, unknown>,
  survivor: Record<string, unknown>,
): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  for (const field of [...INHERITED_AI_FIELDS, "tags"]) {
    if (isEmpty(survivor[field]) && !isEmpty(stale[field])) updates[field] = stale[field];
  }
  if (!survivor.ai_tagged_at && stale.ai_tagged_at) {
    updates.ai_tagged_at = stale.ai_tagged_at;
    updates.ai_model = stale.ai_model;
    updates.status = stale.status;
  }
  return updates;
}
