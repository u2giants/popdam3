// Shared Phase 6 parser for `supabase db query` / psql function results.
//
// Accepts (in order):
//   1. JSON array / object / Supabase CLI { rows: [...] } envelope
//   2. Unicode box-table cells containing Go-style map[...] dumps
//      (Ubuntu hosted CLI renders jsonb this way — workflow run 30203386465)
//
// Fail-closed: returns null unless a required discriminator key is present
// with a real boolean. Never treats a loose "pass"/"ok" substring as success.

/**
 * @param {string} stdout
 * @param {{ requiredKey: "pass" | "ok" }} opts
 * @returns {Record<string, unknown> | null}
 */
export function parsePhase6FunctionResult(stdout, { requiredKey }) {
  if (!stdout || !String(stdout).trim()) return null;
  if (requiredKey !== "pass" && requiredKey !== "ok") return null;

  const trimmed = String(stdout).trim();

  // --- 1. JSON / envelope (existing contract) ---
  const fromJson = tryParseJsonShapes(trimmed, requiredKey);
  if (fromJson) return fromJson;

  // --- 2. Go-style map cell (box table or bare) ---
  const mapText = extractGoMapText(trimmed);
  if (!mapText) return null;
  const obj = parseGoMap(mapText);
  if (!obj || typeof obj !== "object") return null;
  if (!(requiredKey in obj)) return null;
  if (typeof obj[requiredKey] !== "boolean") return null;
  return obj;
}

export function parseComparisonResult(stdout) {
  return parsePhase6FunctionResult(stdout, { requiredKey: "pass" });
}

export function parseHealthResult(stdout) {
  return parsePhase6FunctionResult(stdout, { requiredKey: "ok" });
}

/** 0 = pass/ok true, 1 = explicit false, 2 = unparseable (fail-closed). */
export function phase6ExitCode(result, requiredKey) {
  if (!result || typeof result !== "object" || !(requiredKey in result)) return 2;
  if (typeof result[requiredKey] !== "boolean") return 2;
  return result[requiredKey] === true ? 0 : 1;
}

export function comparisonExitCode(result) {
  return phase6ExitCode(result, "pass");
}

export function healthExitCode(result) {
  return phase6ExitCode(result, "ok");
}

// ---------------------------------------------------------------------------
// JSON shapes
// ---------------------------------------------------------------------------

function tryParseJsonShapes(trimmed, requiredKey) {
  try {
    const parsed = JSON.parse(trimmed);
    const candidate = normalizeJsonCandidate(parsed);
    if (isValidResult(candidate, requiredKey)) return candidate;
  } catch {
    // not pure JSON
  }

  // JSON object embedded in noise (table wrappers that still use JSON text)
  const re =
    requiredKey === "pass"
      ? /\{[\s\S]*"pass"\s*:\s*(true|false)[\s\S]*\}/
      : /\{[\s\S]*"ok"\s*:\s*(true|false)[\s\S]*\}/;
  const match = trimmed.match(re);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (isValidResult(obj, requiredKey)) return obj;
    } catch {
      // fall through
    }
  }
  return null;
}

function normalizeJsonCandidate(parsed) {
  if (Array.isArray(parsed)) return parsed[0] ?? null;
  if (Array.isArray(parsed?.rows)) {
    const row = parsed.rows[0];
    if (row && typeof row === "object") {
      const first = Object.values(row)[0];
      if (typeof first === "object" && first !== null) return first;
      if (typeof first === "string") {
        // May be JSON or a Go-map string inside the envelope.
        try {
          return JSON.parse(first);
        } catch {
          const mapText = extractGoMapText(first);
          return mapText ? parseGoMap(mapText) : null;
        }
      }
      return row;
    }
  }
  if (parsed && typeof parsed === "object") return parsed;
  return null;
}

function isValidResult(obj, requiredKey) {
  return (
    obj &&
    typeof obj === "object" &&
    !Array.isArray(obj) &&
    requiredKey in obj &&
    typeof obj[requiredKey] === "boolean"
  );
}

// ---------------------------------------------------------------------------
// Locate map[...] in CLI noise (box tables, headers, etc.)
// ---------------------------------------------------------------------------

/**
 * Find the outermost `map[...]` span. Balanced brackets so nested map/array
 * values do not truncate the cell.
 */
export function extractGoMapText(text) {
  const s = String(text);
  const start = s.indexOf("map[");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start + 3; i < s.length; i++) {
    const ch = s[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Go map[...] parser (key order independent)
// ---------------------------------------------------------------------------

/**
 * Parse a full `map[...]` string into a plain object.
 * @param {string} mapText
 * @returns {Record<string, unknown> | null}
 */
export function parseGoMap(mapText) {
  const s = String(mapText).trim();
  if (!s.startsWith("map[")) return null;
  const innerEnd = findMatchingBracket(s, 3); // index of '[' is 3
  if (innerEnd < 0) return null;
  // Require the map to consume the whole string (no trailing junk on the cell).
  if (s.slice(innerEnd + 1).trim() !== "") {
    // Allow trailing box-drawing / whitespace only
    if (!/^[\s│┃─┌┐└┘├┤┬┴┼]+$/.test(s.slice(innerEnd + 1))) return null;
  }
  const inner = s.slice(4, innerEnd);
  return parseGoMapEntries(inner);
}

function findMatchingBracket(s, openBracketIndex) {
  // openBracketIndex points at '['
  let depth = 0;
  for (let i = openBracketIndex; i < s.length; i++) {
    if (s[i] === "[") depth += 1;
    else if (s[i] === "]") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function parseGoMapEntries(inner) {
  const out = {};
  let i = 0;
  const n = inner.length;
  while (i < n) {
    while (i < n && inner[i] === " ") i += 1;
    if (i >= n) break;

    const keyStart = i;
    while (i < n && isKeyChar(inner[i])) i += 1;
    if (i === keyStart || inner[i] !== ":") return null; // malformed
    const key = inner.slice(keyStart, i);
    i += 1; // skip ':'

    const parsed = parseGoValue(inner, i);
    if (!parsed) return null;
    // Fail-closed on duplicate keys — never let a later value shadow an earlier one
    // (ambiguous CLI dump / injection surface).
    if (Object.prototype.hasOwnProperty.call(out, key)) return null;
    out[key] = parsed.value;
    i = parsed.next;
  }
  return out;
}

function isKeyChar(ch) {
  return /[A-Za-z0-9_]/.test(ch);
}

/**
 * Parse one value starting at index i.
 * @returns {{ value: unknown, next: number } | null}
 */
export function parseGoValue(s, i) {
  if (i >= s.length) return null;

  // nested map
  if (s.startsWith("map[", i)) {
    const end = findMatchingBracket(s, i + 3);
    if (end < 0) return null;
    const nested = parseGoMap(s.slice(i, end + 1));
    if (!nested) return null;
    return { value: nested, next: end + 1 };
  }

  // array: [] or [map[...] map[...]] or nested
  if (s[i] === "[") {
    return parseGoArray(s, i);
  }

  // <nil>
  if (s.startsWith("<nil>", i)) {
    return { value: null, next: i + 5 };
  }

  // booleans (must not be prefix of a longer token)
  if (s.startsWith("true", i) && isValueBoundary(s, i + 4)) {
    return { value: true, next: i + 4 };
  }
  if (s.startsWith("false", i) && isValueBoundary(s, i + 5)) {
    return { value: false, next: i + 5 };
  }

  // integer (optional leading -)
  if (/[0-9-]/.test(s[i])) {
    const m = s.slice(i).match(/^-?\d+/);
    if (m && isValueBoundary(s, i + m[0].length)) {
      return { value: Number(m[0]), next: i + m[0].length };
    }
  }

  // scalar string / UUID / date — read until next ` key:` boundary or end
  const end = findScalarEnd(s, i);
  if (end <= i) return null;
  return { value: s.slice(i, end), next: end };
}

function isValueBoundary(s, idx) {
  if (idx >= s.length) return true;
  const ch = s[idx];
  // space starts next key, ] ends map/array
  return ch === " " || ch === "]";
}

/**
 * End of an unquoted scalar: next space followed by `ident:` or end/`]`.
 */
function findScalarEnd(s, start) {
  let i = start;
  while (i < s.length) {
    if (s[i] === "]") return i;
    if (s[i] === " ") {
      // Lookahead: space + key + ':' => next entry
      let j = i + 1;
      while (j < s.length && s[j] === " ") j += 1;
      if (j >= s.length || s[j] === "]") return i;
      let k = j;
      while (k < s.length && isKeyChar(s[k])) k += 1;
      if (k > j && s[k] === ":") return i;
      // space inside a free-form string value (e.g. note text) — continue
    }
    i += 1;
  }
  return i;
}

function parseGoArray(s, openIndex) {
  // s[openIndex] === '['
  let i = openIndex + 1;
  const items = [];
  while (i < s.length) {
    while (i < s.length && s[i] === " ") i += 1;
    if (i < s.length && s[i] === "]") {
      return { value: items, next: i + 1 };
    }
    if (i >= s.length) return null;
    const parsed = parseGoValue(s, i);
    if (!parsed) return null;
    items.push(parsed.value);
    i = parsed.next;
  }
  return null;
}
