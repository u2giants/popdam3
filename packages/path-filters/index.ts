/**
 * Centralized NAS/filesystem path exclusion logic.
 * Single source of truth — all agents and edge functions must import from here.
 *
 * See docs/PATH_UTILS.md and PROJECT_BIBLE.md §8 for context.
 *
 * Rules:
 *   Rule A — skip any folder whose name starts with: . (dot), $, @, or #
 *   Rule B — skip any folder whose name exactly matches the BLOCKLIST (case-insensitive)
 *
 * Both rules are applied at every depth level, not just the root.
 * All matching is case-insensitive to handle Windows, macOS, and Synology inconsistencies.
 * Both forward-slash and backslash path separators are handled.
 *
 * @module path-filters
 */

// ── Blocklist (case-insensitive exact match) ────────────────────────

const BLOCKLIST = new Set([
  "system volume information",
  "recycler",
  "$recycle.bin",
  "#recycle",
  "#snapshot",
  "#snapshots",
  "@eadir",
  "@sharebin",
  "@tmp",
  ".synologyworkingdirectory",
  "__macosx",
  ".spotlight-v100",
  ".trashes",
  ".fseventsd",
  ".appledouble",
  ".appledb",
  ".temporaryitems",
  "node_modules",
  ".git",
  ".svn",
  "recovered",
  "adobe premiere pro auto-save",
]);

// ── Prefix characters that trigger automatic skip (Rule A) ──────────

const SKIP_PREFIXES = [".", "$", "@", "#"];

// ── Per-session dedup for warning logs ──────────────────────────────

let warnedPaths = new Set<string>();

/**
 * Reset the per-session warning dedup set.
 * Call this at the start of each scan session so the first skip
 * in a new session is logged.
 */
export function resetSkipWarnings(): void {
  warnedPaths = new Set();
}

/**
 * Returns true if a single folder name should be excluded.
 * Case-insensitive. Handles both Rule A (prefix) and Rule B (blocklist).
 */
export function shouldSkipFolder(folderName: string): boolean {
  if (!folderName) return false;

  // Rule A: prefix check
  const firstChar = folderName[0];
  if (SKIP_PREFIXES.includes(firstChar)) return true;

  // Rule B: blocklist exact match (case-insensitive)
  if (BLOCKLIST.has(folderName.toLowerCase())) return true;

  return false;
}

/**
 * Returns true if ANY segment of the given path matches the exclusion rules.
 * Works with both forward-slash and backslash separators.
 *
 * @param fullPath - Absolute or relative path to check (e.g. "Z:\\Library\\@eaDir\\subfolder\\file.tif")
 * @param logFn   - Optional logger function(msg, meta) called once per unique skipped path per session.
 *                  The caller should pass their structured logger's .warn method.
 */
export function shouldSkipPath(
  fullPath: string,
  logFn?: (msg: string, meta: Record<string, unknown>) => void,
): boolean {
  // Normalize separators and split
  const segments = fullPath.replace(/\\/g, "/").split("/").filter(Boolean);

  for (const seg of segments) {
    if (shouldSkipFolder(seg)) {
      // Log once per unique path per session
      if (logFn && !warnedPaths.has(fullPath)) {
        warnedPaths.add(fullPath);
        logFn("Path skipped by exclusion filter", {
          path: fullPath,
          matchedSegment: seg,
        });
      }
      return true;
    }
  }

  return false;
}

/**
 * Convenience: check a canonical relative_path from the database.
 * Same as shouldSkipPath but named for clarity in edge-function context.
 */
export function isExcludedRelativePath(
  relativePath: string,
  logFn?: (msg: string, meta: Record<string, unknown>) => void,
): boolean {
  return shouldSkipPath(relativePath, logFn);
}
