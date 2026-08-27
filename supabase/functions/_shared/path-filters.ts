/**
 * Deno-compatible path filters for PopDAM.
 *
 * This module provides filtering logic for junk files and excluded directories.
 * It's designed to work in both Deno (edge functions) and Node.js (agents).
 *
 * NOTE: This is a Deno-compatible copy of the Node.js package in packages/path-filters/.
 * Both should be kept in sync. See KNOWN_QUIRKS.md §10 for rationale.
 */

/**
 * Set of known junk filenames that should be skipped during scanning.
 * These are typically system files, temporary files, and macOS resource forks.
 */
export const JUNK_FILENAMES = new Set<string>([
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
  "~$*", // Office temp files
  // PERMANENT — DO NOT REMOVE: canary file owned by ANOTHER application.
  // PopDAM/PopSG must never crawl, record, process, render, open, or modify it.
  "seafile-ignore.txt",
]);

/**
 * Glob patterns from JUNK_FILENAMES, compiled once at module load.
 *
 * Every character outside the `*` wildcard is regex-escaped. Without escaping,
 * the Office temp pattern "~$*" compiled to /^~$.*$/ — where `$` is an
 * end-of-string anchor, not a literal — so it matched only the single
 * character "~" and never matched "~$budget.xlsx".
 */
const JUNK_GLOB_PATTERNS: RegExp[] = [...JUNK_FILENAMES]
  .filter((pattern) => pattern.includes("*"))
  .map((pattern) =>
    new RegExp(
      "^" +
        pattern
          .split("*")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*") +
        "$",
    )
  );

/**
 * Check if a filename matches any known junk patterns.
 * Supports exact matches and glob patterns (e.g., "~$*" matches "~$foo.docx").
 *
 * Called once per scanned file, so the patterns are precompiled above rather
 * than rebuilt on every call.
 */
export function isJunkFilename(filename: string): boolean {
  // Exact match
  if (JUNK_FILENAMES.has(filename)) {
    return true;
  }

  // Glob pattern matching (for patterns like "~$*")
  return JUNK_GLOB_PATTERNS.some((regex) => regex.test(filename));
}

/**
 * Check if a filename starts with a known junk prefix.
 */
export function isJunkPrefix(filename: string): boolean {
  return filename.startsWith("._") || filename.startsWith("~");
}

/**
 * Check if a filename is a macOS resource fork.
 */
export function isMacResourceFork(filename: string): boolean {
  return filename.startsWith("._");
}

/**
 * Check if a directory name is a known excluded directory.
 */
export function isExcludedDirectory(dirname: string): boolean {
  const upper = dirname.toUpperCase();
  return (
    upper === "__MACOSX" ||
    upper === "__OLD" ||
    upper === "___OLD" ||
    upper === ".GIT" ||
    upper === ".SVN" ||
    upper === ".HG" ||
    upper === "NODE_MODULES" ||
    upper === ".TEMP" ||
    upper === "TEMP" ||
    upper === ".TRASH" ||
    upper === ".RECYCLE.BIN"
  );
}

/**
 * Check if a relative path contains any excluded directory.
 */
export function isExcludedRelativePath(relativePath: string): boolean {
  const parts = relativePath.split("/");

  for (const part of parts) {
    if (isExcludedDirectory(part)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a filename should be skipped based on various junk criteria.
 * Combines multiple checks into a single function.
 */
export function shouldSkipFile(filename: string, relativePath?: string): boolean {
  // Check for junk prefixes
  if (isJunkPrefix(filename)) {
    return true;
  }

  // Check for exact junk filenames
  if (isJunkFilename(filename)) {
    return true;
  }

  // Check for excluded directories in path
  if (relativePath && isExcludedRelativePath(relativePath)) {
    return true;
  }

  // Check for __MACOSX in path
  if (relativePath && relativePath.includes("__MACOSX")) {
    return true;
  }

  return false;
}

/**
 * Common file extensions for PDF keywords that indicate these aren't
 * actual PDF files but rather style guide or reference documents.
 */
export const PDF_KEYWORD_EXCLUSIONS = new Set<string>([
  "cover",
  "styleguide",
  "style-guide",
  "style guide",
  "guidelines",
  "brand guide",
  "brand-guide",
  "brandguide",
]);

/**
 * Check if a PDF filename looks like a style guide document
 * (based on filename keywords).
 */
export function isPdfStyleGuide(filename: string): boolean {
  const lower = filename.toLowerCase();
  for (const keyword of PDF_KEYWORD_EXCLUSIONS) {
    if (lower.includes(keyword)) {
      return true;
    }
  }
  return false;
}
