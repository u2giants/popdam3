/**
 * Shared input validation helpers for edge functions.
 *
 * Single source of truth — imported by agent-api, admin-api, and any
 * other function that parses request bodies.
 */

export function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`Missing required string field: ${key}`);
  }
  return v.trim();
}

export function optionalString(
  obj: Record<string, unknown>,
  key: string,
): string | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new Error(`Field ${key} must be a string`);
  return v.trim() || null;
}

export function requireNumber(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== "number") throw new Error(`Field ${key} must be a number`);
  return v;
}

export function optionalNumber(
  obj: Record<string, unknown>,
  key: string,
): number | null {
  const v = obj[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "number") throw new Error(`Field ${key} must be a number`);
  return v;
}

/**
 * Validates and canonicalizes a relative path:
 * - POSIX separators (/)
 * - No leading/trailing slashes
 * - No empty segments (//)
 */
export function requireCanonicalRelativePath(
  obj: Record<string, unknown>,
  key: string,
): string {
  const raw = obj[key];
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error(`Missing required string field: ${key}`);
  }
  let p = raw.trim().replace(/\\/g, "/");
  p = p.replace(/^\/+/, "").replace(/\/+$/, "");
  if (p === "") {
    throw new Error(`${key} cannot be empty after normalization`);
  }
  if (p.includes("//")) {
    throw new Error(`${key} contains empty path segments (//)`);
  }
  return p;
}
