// Normalisation, hashing and SQL literals.
//
// Every rule here exists because the database refuses the un-normalised form, or because
// the vendor uses a sentinel that would otherwise be stored as a fact:
//
//   * 1900-01-01 is ColdLion's EMPTY DATE. Landing tables CHECK that no date column
//     holds it. It becomes NULL here or the row is refused there.
//   * Empty strings become NULL, so a '' can never masquerade as a real code and so the
//     NULLS NOT DISTINCT identities behave.
//   * The source hash is taken over the CANONICAL projection — keys sorted, values in a
//     stable form — so the same source row always hashes the same way and a replay is a
//     no-op rather than a second "version".

import { createHash } from "node:crypto";

export const EMPTY_DATE_MARKER = "1900-01-01";

export function text(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function num(value) {
  if (value === null || value === undefined) return null;
  // A blank field is blank whether it arrives as "", a space or a tab. `Number("")` is 0, so
  // trimming to empty MUST short-circuit here: a whitespace-only quantity that became a
  // real zero would pass every not-null check and land as a fact the vendor never sent.
  const raw = typeof value === "number" ? value : text(value);
  if (raw === null) return null;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error("a numeric field was not a finite number");
  }
  return parsed;
}

export function bigint(value) {
  const parsed = num(value);
  if (parsed === null) return null;
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("an integer field was not a safe integer");
  }
  return parsed;
}

/**
 * A date, or NULL for the vendor's empty marker.
 *
 * Accepts `YYYY-MM-DD` and the ISO timestamps ColdLion sometimes sends for the same
 * field; anything else is refused rather than coerced, because a silently mis-parsed
 * date is worse than a failed window.
 */
export function date(value) {
  const raw = text(value);
  if (raw === null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})([T ].*)?$/.exec(raw);
  if (!match) throw new Error("a date field was not an ISO date");
  const day = match[1];
  if (day <= EMPTY_DATE_MARKER) return null;
  return day;
}

/** Canonical JSON: sorted keys, stable numbers. The input to every source hash. */
export function canonical(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sourceHash(projection) {
  return createHash("sha256").update(canonical(projection), "utf8").digest("hex");
}

/** Split a vendor comma-separated token list, preserving order, dropping blanks. */
export function splitTokens(value) {
  const raw = text(value);
  if (raw === null) return [];
  return raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

// ---------------------------------------------------------------------------------
// SQL literals. Everything reaching the database goes through these.
// ---------------------------------------------------------------------------------

export function sqlText(value) {
  if (value === null || value === undefined) return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function sqlNumber(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("refusing to emit a non-finite number as SQL");
  }
  return String(value);
}

export function sqlBool(value) {
  if (value === null || value === undefined) return "null";
  return value ? "true" : "false";
}

export function sqlDate(value) {
  return value === null || value === undefined ? "null" : `date ${sqlText(value)}`;
}

export function sqlTimestamp(value) {
  return value === null || value === undefined ? "null" : `timestamptz ${sqlText(value)}`;
}

export function sqlUuid(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value ?? "")) {
    throw new Error("refusing to emit a value that is not a UUID");
  }
  return `uuid ${sqlText(value)}`;
}

export function sqlJson(value) {
  return `${sqlText(JSON.stringify(value))}::jsonb`;
}

/** Emit one VALUES row from a column->emitter spec, in the spec's column order. */
export function sqlRow(spec, row) {
  return `(${spec.map(([, emit, key]) => emit(row[key])).join(", ")})`;
}

export function sqlColumns(spec) {
  return spec.map(([column]) => column).join(", ");
}
