// Returns only the fields of `next` whose values differ from `current`.
// Writing unchanged values to public.assets still creates a new row version
// and, when an indexed column is listed, a non-HOT update that bloats the
// table (popcre/shared-db#5747). Timestamps compare by instant, arrays and
// objects by JSON value, and null/undefined are treated as equal.
function normalize(value) {
  if (value === undefined) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value)) {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) return `t:${ms}`;
  }
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return value;
}

export function valuesEqual(a, b) {
  return normalize(a) === normalize(b);
}

export function changedFields(current, next) {
  if (!current) return { ...next };
  const out = {};
  for (const [key, value] of Object.entries(next)) {
    if (!(key in current) || !valuesEqual(current[key], value)) out[key] = value;
  }
  return out;
}
