/**
 * Shared admin_config value unwrapper.
 *
 * admin_config stores values as JSONB. Depending on how values were written,
 * the shape can be:
 *   - raw value:  "2025-01-01"
 *   - wrapped:    { value: "2025-01-01" }
 *
 * This utility normalises both forms into the raw value.
 */

// deno-lint-ignore no-explicit-any
export function unwrapConfigValue<T = unknown>(raw: any): T | null {
  if (raw === null || raw === undefined) return null;
  // If it's a plain object with a .value key, unwrap it
  if (typeof raw === "object" && !Array.isArray(raw) && "value" in raw) {
    return raw.value as T;
  }
  return raw as T;
}

/**
 * Unwrap and coerce to a string, returning null if empty/missing.
 */
// deno-lint-ignore no-explicit-any
export function unwrapConfigString(raw: any): string | null {
  const val = unwrapConfigValue(raw);
  if (val === null || val === undefined) return null;
  const str = typeof val === "string" ? val : String(val);
  return str.trim() || null;
}
