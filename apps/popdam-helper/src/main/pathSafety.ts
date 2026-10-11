/**
 * Path containment for server/web-supplied names and paths (#229).
 *
 * Kept free of Electron imports so it can be unit-tested directly.
 */
import { resolveWithinRoot } from "./localServerSecurity";

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Validate a single path segment (a filename or an id used as a folder name).
 * Rejects separators, traversal, drive prefixes, control characters and
 * Windows device names. Returns the name unchanged when safe.
 */
export function safePathSegment(name: string, what = "filename"): string {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > 255 ||
    name === "." ||
    name === ".." ||
    /[\\/:]/.test(name) ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f]/.test(name) ||
    WINDOWS_RESERVED.test(name)
  ) {
    throw new Error(`Unsafe ${what} rejected: "${String(name)}"`);
  }
  return name;
}

/** Join `subPath` under `root`, throwing if the result escapes `root`. */
export function joinWithinRoot(root: string, subPath: string): string {
  const target = resolveWithinRoot(root, subPath);
  if (target === null) {
    throw new Error(`Path escapes its root and was rejected: "${subPath}"`);
  }
  return target;
}
