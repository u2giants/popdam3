/**
 * Centralized NAS/filesystem path exclusion logic (Deno-compatible copy).
 * 
 * This is a COPY of packages/path-filters/index.ts for Deno edge functions.
 * If you update the source, update this file too.
 * 
 * See packages/path-filters/index.ts for the canonical version.
 */

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

const SKIP_PREFIXES = [".", "$", "@", "#"];

export function shouldSkipFolder(folderName: string): boolean {
  if (!folderName) return false;
  const firstChar = folderName[0];
  if (SKIP_PREFIXES.includes(firstChar)) return true;
  if (BLOCKLIST.has(folderName.toLowerCase())) return true;
  return false;
}

export function shouldSkipPath(fullPath: string): boolean {
  const segments = fullPath.replace(/\\/g, "/").split("/").filter(Boolean);
  for (const seg of segments) {
    if (shouldSkipFolder(seg)) return true;
  }
  return false;
}

export function isExcludedRelativePath(relativePath: string): boolean {
  return shouldSkipPath(relativePath);
}
