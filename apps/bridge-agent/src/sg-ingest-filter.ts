/**
 * PopSG ingestion allow-list.
 *
 * The style guide library only shows files it can render a preview for, so
 * anything we cannot thumbnail (fonts, web/code files, archives, video, 3D,
 * office docs, temp files) must never enter `style_guide_files` at all.
 *
 * Keep this in sync with:
 *  - the SQL render allow-list in `queue_sg_render_jobs*` / `sg_preview_stats`
 *    (shared-db migration 20260507231540_sg_render_eps_support.sql)
 *  - the server-side guard `SG_INGESTABLE_EXTENSIONS` in
 *    supabase/functions/agent-api/index.ts (complete-style-guide-crawl)
 *
 * Kept dependency-free so it can be unit tested without agent config/env.
 */
import eligibilityContract from "./sg-eligibility-contract.json";

export const INGESTABLE_EXTENSIONS = new Set(eligibilityContract.extensions);

/** True when a FILE (never a directory) is allowed into the library. */
export function isIngestableFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false; // no extension, or a dotfile → not renderable
  return INGESTABLE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}
