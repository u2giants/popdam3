#!/usr/bin/env node
/**
 * Disney OPA property->character mirror runner.
 *
 * ============================================================================
 * THIS FILE CONTAINS NO DISNEY DATA, AND MUST NEVER CONTAIN ANY.
 * ============================================================================
 * `u2giants/shared-db` is a PUBLIC repository. The OPA extract is
 * business-confidential Disney data obtained under a commercial licensing
 * relationship, and it lives in the PRIVATE repository:
 *
 *     u2giants/licensor-source-data  ->  disney-opa/opa-characters.csv
 *
 * The design document (docs/verification/opa-source-of-truth-20260807/README.md
 * section 7.7) proposed a SEED MIGRATION generated from a CSV that used to be
 * committed here. That justification EXPIRED when PR #495 removed the CSV. A
 * seed would re-materialise 10,262 confidential rows as SQL INSERTs in
 * supabase/migrations/, permanently, in public git history.
 *
 *     SCHEMA IN GIT. DATA OUT OF GIT.
 *
 * So this runner reads the CSV from a local checkout of the PRIVATE repo at
 * runtime, builds a jsonb snapshot in memory, and POSTs it to the guarded
 * database importer. Nothing it reads is ever written back into this repo.
 *
 * Database side (all guards live there too -- this runner is not the only line
 * of defence, by design):
 *     plm.sync_opa_property_character(jsonb, text, numeric)
 *     public.sync_opa_property_character(jsonb, text, numeric)   <- called here
 * Migrations (all five, applied 2026-08-07):
 *     20260807170000  landing tables
 *     20260807170100  importer function
 *     20260807180000  re-entrancy fix
 *     20260807190000  security + view corrections (parameter validation)
 *     20260807200000  comment corrections
 *
 * ----------------------------------------------------------------------------
 * USAGE
 * ----------------------------------------------------------------------------
 *   OPA_CSV_PATH=/path/to/licensor-source-data/disney-opa/opa-characters.csv \
 *   OPA_CAPTURED_AT=2026-08-06 \
 *   OPA_SOURCE_URL='https://opa.disney.com/...' \
 *   OPA_MIN_ROWS=<how many data rows you expect AT MINIMUM> \
 *   SUPABASE_URL=https://<project-ref>.supabase.co \
 *   OPA_EXPECTED_PROJECT_REF=<the project ref you MEANT to write> \
 *   SUPABASE_SERVICE_ROLE_KEY=<from 1Password vault vibe_coding> \
 *   node tools/sync-opa-property-character.mjs --apply
 *
 * (`--expect-ref=<ref>` on the command line is equivalent to, and overrides,
 * OPA_EXPECTED_PROJECT_REF.)
 *
 * Without --apply it runs a DRY RUN: it parses, validates and prints counts,
 * and contacts no database at all.
 *
 * ----------------------------------------------------------------------------
 * WRONG-TARGET SAFETY -- READ THIS BEFORE CHANGING THE APPLY PATH
 * ----------------------------------------------------------------------------
 * Every guard in the database runs INSIDE whichever project you reached, so no
 * database guard can tell you that you reached the WRONG project. One mistyped
 * environment variable would load the whole confidential extract into the wrong
 * Supabase project. Printing the ref is not a gate -- nobody may be watching,
 * and CI cannot read a warning.
 *
 * So the ref is a REQUIRED, EXPLICIT input, it is compared against the ref
 * parsed out of SUPABASE_URL, and a mismatch ABORTS BEFORE THE FIRST BYTE IS
 * SENT (see resolveSupabaseTarget, which applySnapshot calls before it touches
 * fetch). Do not "simplify" this into a warning.
 *
 * Refresh is a MANUAL, one-off operation. There is no OPA API, no change feed
 * and no webhook; a refresh requires Albert to complete MFA in his own browser
 * and re-extract. Do not schedule this.
 *
 * NEVER hard-code a project ref, a URL or a key in this file. The service-role
 * key comes from 1Password (vault vibe_coding) via the environment, and is
 * never printed, logged or written to disk.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";

/** A Supabase project ref: 20 lowercase letters/digits. No ref is hard-coded here. */
const PROJECT_REF = /^[a-z0-9]{20}$/;

const REQUIRED_COLUMNS = [
  "licensedPropertyID",
  "characterID",
  "property",
  "character",
  "brandPropertyID",
  "optionSourceID",
];

const NUMERIC_COLUMNS = [
  "licensedPropertyID",
  "characterID",
  "brandPropertyID",
  "optionSourceID",
];

/**
 * Decode a file as STRICT UTF-8.
 *
 * WHY NOT `readFile(path, "utf8")`. Node's "utf8" decoding is lenient: an invalid
 * byte is silently replaced with U+FFFD. A licensor name would come through
 * corrupted, pass every check below, and land in the mirror as if it were correct.
 * Silent repair of licensor data is how a wrong name reaches a licensing decision,
 * so a bad byte must be an error, not a substitution.
 */
export function decodeUtf8Strict(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(
      "CSV is not valid UTF-8. Node's default decoding would have silently replaced the " +
        "bad bytes with U+FFFD and corrupted a name without any error. Re-export the CSV " +
        "as UTF-8; do not load this file."
    );
  }
}

/**
 * Minimal RFC4180 CSV parser. Handles quoted fields, embedded commas, embedded
 * newlines and doubled quotes. Deliberately dependency-free: this file must be
 * runnable from a bare checkout without installing anything.
 *
 * IT REJECTS MALFORMED QUOTING RATHER THAN REPAIRING IT. Every one of these was
 * previously accepted in silence, and each corrupts data in a way that reads as
 * success downstream:
 *   - text after a closing quote (`"Name"junk` used to become `Namejunk`);
 *   - a bare `"` inside an unquoted field, which flipped quote mode and then
 *     SWALLOWED THE FOLLOWING COMMAS, MERGING FIELDS -- the worst of the set,
 *     because a name can slide into an ID column and vice versa;
 *   - end-of-file in the middle of a quoted field, which used to be pushed as a
 *     complete row. A TRUNCATED DOWNLOAD ENDS EXACTLY THAT WAY.
 * Field-count agreement with the header is checked in buildSnapshot, which is
 * where the header is known.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let quoted = false; // this field opened with a quote
  let closed = false; // this field's closing quote has been consumed
  let line = 1;

  // Strip a UTF-8 BOM; Disney's export carries one and it corrupts the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const endField = () => {
    row.push(field);
    field = "";
    quoted = false;
    closed = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
          closed = true;
        }
      } else {
        if (c === "\n") line += 1;
        field += c;
      }
      continue;
    }

    if (c === '"' && field === "" && !quoted) {
      // A quote is only legal at the very start of a field: it OPENS it.
      inQuotes = true;
      quoted = true;
    } else if (c === '"') {
      throw new Error(
        `line ${line}, field ${row.length + 1}: an unescaped '"' inside an unquoted field. ` +
          "In CSV a quote may only open a field, and inside a quoted field it must be " +
          "doubled (\"\"). Accepting this flips quote mode and MERGES the following " +
          "fields, which moves values between columns. Fix the extract."
      );
    } else if (c === ",") {
      endField();
    } else if (c === "\n") {
      endField();
      rows.push(row);
      row = [];
      line += 1;
    } else if (c === "\r") {
      // CRLF is fine -- skip the \r and let the \n end the row. A BARE \r is not:
      // it used to be swallowed in silence, so `a,b\r1,2` parsed as the single row
      // ["a","b1","2"], joining the end of one line to the start of the next. The
      // field-count check catches that downstream, but this parser advertises
      // rejecting silent repair, and this was the last lenient path left in it.
      if (text[i + 1] !== "\n") {
        throw new Error(
          `line ${line}, field ${row.length + 1}: a bare carriage return that is not part of ` +
            "a CRLF line ending. It used to be swallowed silently, which JOINED two lines " +
            "into one row. Re-export the CSV with consistent line endings."
        );
      }
      continue;
    } else {
      if (closed) {
        throw new Error(
          `line ${line}, field ${row.length + 1}: text after a closing quote. The old parser ` +
            "appended it silently, so `\"Name\"junk` became `Namejunk`. Fix the extract."
        );
      }
      field += c;
    }
  }

  if (inQuotes) {
    throw new Error(
      `CSV ends inside a quoted field that opened on line ${line}. The file is TRUNCATED -- ` +
        "an interrupted download ends exactly like this, and the old parser pushed the " +
        "partial field as if it were a complete row. Re-download the extract."
    );
  }

  if (field !== "" || quoted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop only a genuinely empty line (a lone empty field). Anything else that
  // looks blank is now a blank-value or field-count error in buildSnapshot,
  // rather than a row that quietly disappears.
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/**
 * The capture date must be a REAL date, not merely a date-SHAPED string. The old
 * regex accepted `2026-99-99`; the database rejects it, so the run failed late
 * instead of never. Fail before anything is sent.
 */
export function assertIsoDate(capturedAt) {
  const s = String(capturedAt ?? "");
  const shaped = /^\d{4}-\d{2}-\d{2}$/.test(s);
  let real = false;
  if (shaped) {
    const d = new Date(`${s}T00:00:00Z`);
    // Invalid Date makes toISOString THROW, and a rolled-over date (2026-02-30
    // becomes 2026-03-02) comes back different. Both must be rejected.
    real = !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }
  if (!real) {
    throw new Error(
      `OPA_CAPTURED_AT must be an explicit, REAL ISO date (YYYY-MM-DD), got ${JSON.stringify(capturedAt)}. ` +
        "It is never derived from the clock: the database runs America/New_York and a " +
        "UTC-midnight timestamp reads back one day early."
    );
  }
  return s;
}

/** The expected-minimum row count. Must be a positive whole number. */
export function resolveMinRows(raw) {
  const n = Number(String(raw).trim());
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new Error(
      `OPA_MIN_ROWS must be a whole number of at least 1, got ${JSON.stringify(raw)}. ` +
        "It is the floor that stops a truncated extract loading into an empty mirror."
    );
  }
  return n;
}

const CREDENTIAL_WORDS = new Set([
  "token", "key", "apikey", "secret", "sig", "signature", "password", "passwd",
  "pwd", "auth", "authorization", "session", "sessionid", "sid", "jwt",
  "bearer", "credential", "credentials", "access",
]);

/** Split camelCase and snake/kebab case alike, so apiKey, api_key and API-KEY all match. */
function credentialWords(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function safeDecode(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/**
 * Does this look like an opaque secret rather than a readable path segment?
 * Tuned to catch tokens without tripping on ordinary slugs -- a false positive
 * costs the operator one edit and is loud, so it errs toward strict.
 */
function looksLikeAToken(segment) {
  if (/^eyJ/.test(segment)) return true; // a JWT always starts with the base64 of '{"'
  if (segment.length >= 32 && /^[0-9a-f]+$/i.test(segment)) return true; // hex digest
  if (segment.length >= 40 && /^[A-Za-z0-9._~+/=-]+$/.test(segment)) return true; // long opaque
  // Short-but-opaque: no separators at all, yet mixed case AND digits. Ordinary
  // slugs use hyphens or underscores ("licensed-properties-2026"), so they miss this.
  return (
    segment.length >= 20 &&
    /^[A-Za-z0-9]+$/.test(segment) &&
    /[0-9]/.test(segment) &&
    /[a-z]/.test(segment) &&
    /[A-Z]/.test(segment)
  );
}

/**
 * The source URL is stored VERBATIM as provenance on EVERY row -- ~10,262 of them --
 * so a portal URL that still carries a session token persists that token into the
 * database and into anything that later reads provenance. Refuse it.
 *
 * THIS CHECK FAILS CLOSED. An earlier version parsed with `new URL()` and, when that
 * threw, RETURNED THE STRING UNCHECKED. A scheme-less paste out of a browser address
 * bar -- `opa.example.invalid/x?session_token=SECRET` -- is not a parseable absolute
 * URL, so it skipped the check entirely and the token was stored. That is exactly
 * what a hurried operator produces. An unparseable value is now a hard error.
 *
 * DELIBERATE CONTRACT TIGHTENING: the query string and the fragment are refused
 * OUTRIGHT rather than inspected for suspicious names. Name-matching is a
 * blocklist, and a blocklist on a value that is persisted 10,262 times is the wrong
 * shape -- a parameter called `t` or a 12-character fragment slipped straight
 * through. Provenance needs to say WHERE the extract came from, which a bare page
 * URL does. Nothing here echoes the offending value.
 */
export function assertSourceUrlIsNotACredential(sourceUrl) {
  const s = String(sourceUrl ?? "");

  let parsed;
  try {
    parsed = new URL(s);
  } catch {
    throw new Error(
      "OPA_SOURCE_URL must be an absolute URL including the scheme, e.g. " +
        "https://portal.example/page. A scheme-less value (the sort pasted straight out " +
        "of a browser) used to SKIP the credential check entirely and could carry a " +
        "session token into every stored row. (The value is deliberately not shown.)"
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `OPA_SOURCE_URL must be an http(s) URL, got scheme ${JSON.stringify(parsed.protocol)}.`
    );
  }
  if (parsed.username || parsed.password) {
    throw new Error(
      "OPA_SOURCE_URL contains userinfo (user:password@host). It is stored verbatim as " +
        "provenance on every row. Strip the credentials and pass the plain page URL."
    );
  }
  if (parsed.search) {
    throw new Error(
      "OPA_SOURCE_URL must not carry a query string. It is stored verbatim as provenance " +
        "on every row, and a query string is where portals return session tokens and other " +
        "credentials. Strip it and pass the plain page URL. (The value is deliberately not " +
        "shown.)"
    );
  }
  if (parsed.hash) {
    throw new Error(
      "OPA_SOURCE_URL must not carry a URL fragment. It is stored verbatim as provenance " +
        "on every row, and a fragment is where portals return session tokens and other " +
        "credentials. Strip it and pass the plain page URL. (The value is deliberately not " +
        "shown.)"
    );
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  for (let i = 0; i < segments.length; i += 1) {
    const seg = safeDecode(segments[i]);
    // Report the POSITION, never the content -- the content may be the secret.
    if (credentialWords(seg).some((w) => CREDENTIAL_WORDS.has(w))) {
      throw new Error(
        `OPA_SOURCE_URL path segment ${i + 1} is named like a credential. This URL is stored ` +
          "verbatim as provenance on every row. Pass the plain page URL. (The segment is " +
          "deliberately not shown.)"
      );
    }
    if (looksLikeAToken(seg)) {
      throw new Error(
        `OPA_SOURCE_URL path segment ${i + 1} looks like an opaque token rather than a page ` +
          "path. This URL is stored verbatim as provenance on every row. Pass the plain page " +
          "URL. (The segment is deliberately not shown.)"
      );
    }
  }

  return s;
}

/**
 * Turn parsed CSV rows into the snapshot the database importer expects.
 *
 * Fails LOUDLY on anything unexpected. The database re-checks every one of
 * these independently (defence in depth) -- a guard here is a fast, readable
 * failure, not the security boundary.
 */
export function buildSnapshot(
  rows,
  { capturedAt, sourceUrl, lineOfBusiness = "Home", minRows = undefined }
) {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error("CSV has no data rows. A failed extract must not look like a success.");
  }

  // THE FIRST LOAD HAS NO FLOOR WITHOUT THIS. The database's shrink band only
  // fires when rows are ALREADY stored (`v_before > 0`, migration 20260807190000),
  // so importing a one-row snapshot into an EMPTY mirror passes every database
  // guard. That is precisely the "a failed extract must not look like a success"
  // case, and only the caller knows how many rows to expect.
  // The VALUE is validated here, early, because a malformed OPA_MIN_ROWS is a
  // configuration error and should fail before any parsing work. The COMPARISON
  // happens after the row loop, against the rows that actually SURVIVE the sentinel
  // filter -- the floor has to describe what will land in the mirror, not what was
  // read out of the file, or the sentinel rule would quietly consume one row of the
  // operator's safety margin.
  const rowFloor =
    minRows === undefined || minRows === null ? null : resolveMinRows(minRows);

  assertIsoDate(capturedAt);
  if (!String(sourceUrl ?? "").trim()) {
    throw new Error("OPA_SOURCE_URL is required; every row must carry its own provenance.");
  }
  assertSourceUrlIsNotACredential(sourceUrl);

  const header = rows[0].map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    throw new Error(
      `CSV is missing required column(s): ${missing.join(", ")}. ` +
        `Found: ${header.join(", ")}. The extract shape changed; do not load it blindly.`
    );
  }

  const idx = Object.fromEntries(REQUIRED_COLUMNS.map((c) => [c, header.indexOf(c)]));
  const out = [];
  const seen = new Map(); // natural key -> the row ordinal it was first seen on
  const duplicates = [];
  const rejected = []; // row ordinals dropped by the sentinel rule -- NEVER their values

  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    const rec = {};

    // A row with the wrong number of fields means the columns have SHIFTED.
    // Extra columns used to be ignored, so a shift could put a character name
    // into an ID column and never be noticed.
    if (r.length !== header.length) {
      throw new Error(
        `row ${i + 1}: has ${r.length} field(s) but the header has ${header.length}. ` +
          "The columns are misaligned; values would land in the wrong columns."
      );
    }

    for (const col of REQUIRED_COLUMNS) {
      const raw = (r[idx[col]] ?? "").trim();

      if (NUMERIC_COLUMNS.includes(col)) {
        // Disney uses NEGATIVE SENTINELS (the "Special Projects" node). Integers
        // here must accept them; any unsigned parsing silently drops that row.
        if (!/^-?\d+$/.test(raw)) {
          // ROW ORDINAL AND COLUMN NAME ONLY -- NEVER THE VALUE. This message used
          // to echo the offending field, on the reasoning that a non-integer in a
          // numeric column could only be numeric junk. That reasoning fails on
          // exactly the failure the parser now detects: if the columns SHIFT, a
          // character name lands in a numeric column and this line prints it --
          // into a terminal and into CI logs, for a PUBLIC repository. The operator
          // has the CSV; a row number is enough to find the field.
          throw new Error(
            `row ${i + 1}: ${col} is not an integer. The offending value is deliberately ` +
              "NOT printed -- it can be extract content, and this output lands in public " +
              "CI logs. Look the row up in your own copy of the CSV."
          );
        }
        const n = Number(raw);
        // Beyond 2^53 two DIFFERENT id strings round to the SAME Number, which
        // would silently merge two distinct rows onto one natural key. Disney's
        // ids are far below that today, so this is latent, not active.
        if (!Number.isSafeInteger(n)) {
          throw new Error(
            `row ${i + 1}: ${col} is outside the safe integer range, so it cannot be ` +
              "represented exactly and two distinct ids could collide."
          );
        }
        rec[col] = n;
      } else {
        if (raw === "") {
          throw new Error(`row ${i + 1}: ${col} is blank`);
        }
        // Disney's strings go through VERBATIM. No trimming beyond the CSV field
        // itself, no case folding, no backtick-to-apostrophe fix, no surname
        // reordering. Interpretation belongs in api.opa_property_character.
        rec[col] = r[idx[col]];
      }
    }

    if (rec.optionSourceID !== 1007) {
      throw new Error(
        `row ${i + 1}: optionSourceID is ${rec.optionSourceID}, not 1007. That value was ` +
          "constant across the whole 2026-08-06 extract and its meaning is not understood. " +
          "A different value means the extract shape changed -- stop and investigate."
      );
    }

    // ------------------------------------------------------------------------
    // SENTINEL ROWS ARE DROPPED. Owner ruling, Albert Hazan, 2026-08-07.
    //
    // Disney's extract carries a sentinel node -- measured in the 2026-08-06 file as
    // licensedPropertyID -9999 / characterID -9998, the ONLY negative ids in 10,262
    // rows (every other id runs from 38 to 1,159,383,366). It is not a real licensed
    // property and it must not reach the mirror, because anything counting Disney
    // properties off this mirror would be off by one.
    //
    // THE RULE IS GENERAL, NOT THE SPECIFIC PAIR. Hard-coding -9999/-9998 would rot
    // the moment Disney picks different sentinel values, and this shop's standing
    // rule is that nothing is hard-coded which should be a rule. A NEGATIVE
    // licensedPropertyID or a NEGATIVE characterID is not a real Disney record.
    // Zero is NOT rejected: it is a plausible (if unseen) real id, and the boundary
    // case that must keep working is the SMALLEST legitimate id, so the comparison
    // is strictly `< 0`.
    //
    // WHY THE PARSER STILL ACCEPTS NEGATIVES. The integer check above deliberately
    // permits a leading minus. That is load-bearing and must stay: if parsing
    // rejected negatives, the sentinel would blow up the whole run instead of being
    // counted, and a future change in Disney's sentinel scheme would be invisible.
    // Parse permissively, then reject deliberately, and COUNT what was rejected.
    //
    // NEVER SILENTLY. The count is returned in the snapshot and printed by the
    // runner. A silent filter is a silent failure, and an unexpectedly large reject
    // count is exactly the signal that Disney's export changed shape.
    // ------------------------------------------------------------------------
    if (rec.licensedPropertyID < 0 || rec.characterID < 0) {
      // ROW ORDINAL ONLY -- never the ids or the names. Same rule as everywhere else
      // in this file: this output reaches public CI logs.
      rejected.push(i + 1);
      continue;
    }

    // THE NATURAL KEY IS THE ID PAIR, NOT THE NAME PAIR. Measured on the
    // 2026-08-06 extract, the name pair yields 10,240 distinct values across
    // 10,262 rows -- 22 collisions -- so keying on names silently drops 22 rows.
    const key = `${rec.licensedPropertyID}\0${rec.characterID}`;
    // ROW ORDINALS ONLY -- NEVER THE ID PAIR ITSELF. This used to list the
    // colliding key values. Same rule as above: counts, ordinals and status, never
    // extract content. Two row numbers tell the operator exactly where to look.
    if (seen.has(key)) {
      duplicates.push(`row ${i + 1} repeats the ID pair first seen at row ${seen.get(key)}`);
    } else {
      seen.set(key, i + 1);
    }

    out.push(rec);
  }

  if (duplicates.length > 0) {
    throw new Error(
      `${duplicates.length} duplicate (licensedPropertyID, characterID) pair(s) in the CSV, ` +
        `e.g. ${duplicates.slice(0, 3).join("; ")}. The ID pair is the natural key; a ` +
        "duplicate means the extract is wrong, not that a winner should be picked."
    );
  }

  // Compared against SURVIVING rows, not rows read. See the note where rowFloor is set.
  if (rowFloor !== null && out.length < rowFloor) {
    throw new Error(
      `extract yields ${out.length} loadable data row(s) (${rows.length - 1} read, ` +
        `${rejected.length} rejected as sentinels), fewer than the expected minimum of ` +
        `${rowFloor}. A truncated or partly-scraped extract looks exactly like this, and ` +
        "on a FIRST load into an empty mirror no database guard would catch it. " +
        "Re-extract, or lower OPA_MIN_ROWS deliberately if the source really did shrink."
    );
  }

  return {
    captured_at: capturedAt,
    source_url: sourceUrl,
    line_of_business: lineOfBusiness,
    rows: out,
    // Provenance of the filtering, carried WITH the snapshot so the runner cannot
    // report a load without also reporting what was dropped from it.
    rows_read: rows.length - 1,
    rows_rejected_sentinel: rejected.length,
    // Ordinals only, capped. Enough to find the rows in the operator's own CSV
    // without ever putting extract content in a log.
    rejected_row_ordinals: rejected.slice(0, 10),
  };
}

/**
 * Resolve the shrink-band fraction, rejecting anything that is not a real number.
 *
 * WHY THIS IS NOT JUST `Number(x ?? 0.1)`. A non-numeric env var makes `Number()`
 * return `NaN`, and `JSON.stringify` serialises `NaN` as **`null`**. Postgres
 * `LEAST`/`GREATEST` **ignore NULL arguments**, so the database's
 * `greatest(0, least(1, p_max_shrink_fraction))` collapses to `1`, the threshold
 * becomes `rows_held * 0`, and `rows_seen < 0` can never be true — the
 * truncated-extract guard is silently disabled. A one-row extract would then
 * overwrite a 10,262-row mirror without a word of complaint.
 *
 * WHAT THE DATABASE ACTUALLY DOES -- DO NOT "SIMPLIFY" THIS. The database does NOT
 * coalesce the parameter: migration 20260807190000 (lines 351-357) REJECTS a NULL
 * fraction with an exception. That is deliberate, and the same migration warns at
 * lines 347-350 that wrapping `coalesce()` around the clamp DOES NOT FIX THE HOLE --
 * `coalesce(greatest(0, least(1, null)), 0.10)` returns 1, not NULL, because
 * LEAST/GREATEST ignore NULLs, so the guard stays disabled while looking corrected.
 * An earlier version of this comment claimed the opposite; a maintainer trusting it
 * would have reintroduced exactly the bug that migration removed.
 *
 * The database rejecting NULL is the boundary. This check exists so a typo in an
 * env var fails HERE, loudly, before anything is sent.
 */
export function resolveShrinkFraction(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return 0.1;

  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(
      `OPA_MAX_SHRINK_FRACTION must be a finite number between 0 and 1, got ` +
        `${JSON.stringify(raw)}. A non-numeric value becomes NaN, serialises to JSON ` +
        "null, and silently DISABLES the truncated-extract guard in the database."
    );
  }
  if (n < 0 || n > 1) {
    throw new Error(
      `OPA_MAX_SHRINK_FRACTION must be between 0 and 1 inclusive, got ${n}.`
    );
  }
  return n;
}

/**
 * THE WRONG-TARGET GATE. Validates SUPABASE_URL and proves it names the project
 * the operator explicitly said they meant. Throws on ANY doubt.
 *
 * Two separate hazards, both operator error rather than hostile input:
 *   1. Wrong project. No database-side guard can catch this -- they all run
 *      inside whichever project you reached. This is the only place it can be
 *      caught, and it must ABORT, not warn.
 *   2. Wrong host. An unvalidated URL sends the SERVICE-ROLE KEY (in the apikey
 *      and Authorization headers) plus the whole confidential extract to whatever
 *      host it names. So: https only, no port, no path, no query, no fragment,
 *      and the host must be exactly <project-ref>.supabase.co.
 *
 * Returns { ref, origin }. Callers MUST call this BEFORE constructing any request.
 */
export function resolveSupabaseTarget(rawUrl, expectedRef) {
  // Lowercase before testing. `new URL` lowercases the hostname, so an UPPERCASE
  // host was already accepted, while an UPPERCASE expected ref was rejected with a
  // confusing "not shaped like a Supabase project ref". Fails safe either way, but
  // the asymmetry would send an operator hunting the wrong problem.
  const expected = String(expectedRef ?? "").trim().toLowerCase();
  if (!expected) {
    throw new Error(
      "The target project ref must be stated EXPLICITLY for --apply: pass --expect-ref=<ref> " +
        "or set OPA_EXPECTED_PROJECT_REF. It is compared against the ref in SUPABASE_URL so a " +
        "mistyped environment variable cannot load confidential data into the wrong project. " +
        "No default is provided on purpose."
    );
  }
  if (!PROJECT_REF.test(expected)) {
    throw new Error(
      `The expected project ref ${JSON.stringify(expected)} is not shaped like a Supabase ` +
        "project ref (20 lowercase letters or digits)."
    );
  }

  const raw = String(rawUrl ?? "");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`SUPABASE_URL is not a valid URL (${JSON.stringify(raw)}).`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(
      `SUPABASE_URL must use https (got ${JSON.stringify(parsed.protocol)}). The service-role ` +
        "key travels in the request headers."
    );
  }
  if (parsed.port) {
    throw new Error(`SUPABASE_URL must not specify a port (got ${JSON.stringify(parsed.port)}).`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error("SUPABASE_URL must be a bare origin: no query string and no fragment.");
  }
  if (parsed.pathname !== "" && parsed.pathname !== "/") {
    throw new Error(
      `SUPABASE_URL must be a bare origin, with no path (got ${JSON.stringify(parsed.pathname)}).`
    );
  }

  const host = /^([a-z0-9]{20})\.supabase\.co$/.exec(parsed.hostname);
  if (!host) {
    throw new Error(
      `SUPABASE_URL host ${JSON.stringify(parsed.hostname)} is not a Supabase project host. ` +
        "It must be exactly <project-ref>.supabase.co, or the service-role key and the whole " +
        "confidential extract would be sent to that host."
    );
  }

  const ref = host[1];
  if (ref !== expected) {
    throw new Error(
      `REFUSING TO SEND: SUPABASE_URL points at project ${ref}, but the expected project is ` +
        `${expected}. NOTHING HAS BEEN SENT. No database-side guard can catch a wrong-project ` +
        "load, because every one of them runs inside whichever project you reached. Fix " +
        "SUPABASE_URL or the expected ref -- do not bypass this check."
    );
  }

  return { ref, origin: parsed.origin };
}

/**
 * POST the snapshot to the guarded database importer.
 *
 * `fetchImpl` is injectable ONLY so tests can prove the wrong-target gate aborts
 * BEFORE any network call is attempted. Production callers must not pass it.
 */
export async function applySnapshot(
  snapshot,
  { url, key, expectedRef, maxShrinkFraction, fetchImpl = fetch, log = console.log } = {}
) {
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply. Fetch the key " +
        "from 1Password (vault vibe_coding) into the environment; never hard-code it."
    );
  }

  // Validate EVERYTHING before the request exists. Order is load-bearing.
  const shrink = resolveShrinkFraction(maxShrinkFraction);
  const target = resolveSupabaseTarget(url, expectedRef);

  log(`\nApplying to Supabase project ref: ${target.ref} (matches the expected ref).`);

  const res = await fetchImpl(`${target.origin}/rest/v1/rpc/sync_opa_property_character`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_snapshot: snapshot,
      p_mode: "mirror_only",
      p_max_shrink_fraction: shrink,
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    // DO NOT print the response body. The database's own guards are diagnostic, but a
    // malformed extract can put row content into an error message, and this output
    // lands in terminals and CI logs. Same rule as the summarise() call above:
    // counts and status only, NEVER a row. Read the full error from the database
    // session if you need it.
    throw new Error(
      `import failed (HTTP ${res.status}). The response body is deliberately NOT printed: ` +
        "it can contain extract content, and this repository and its CI logs are public. " +
        `Response length: ${body.length} bytes.`
    );
  }
  return { ref: target.ref, status: res.status, body };
}

export function summarise(snapshot) {
  const properties = new Set(snapshot.rows.map((r) => r.licensedPropertyID));
  const characters = new Set(snapshot.rows.map((r) => r.characterID));
  const namePairs = new Set(snapshot.rows.map((r) => `${r.property}\0${r.character}`));

  return {
    // What was READ vs what will LOAD. Reported separately and always, so a run can
    // never show a clean row count while quietly having dropped rows.
    rows_read: snapshot.rows_read ?? snapshot.rows.length,
    rows_rejected_sentinel: snapshot.rows_rejected_sentinel ?? 0,
    rejected_row_ordinals: snapshot.rejected_row_ordinals ?? [],
    rows: snapshot.rows.length,
    distinct_licensed_property_id: properties.size,
    distinct_character_id: characters.size,
    distinct_name_pairs: namePairs.size,
    // Non-zero here is EXPECTED and is the whole reason the key is the ID pair.
    name_pair_collisions: snapshot.rows.length - namePairs.size,
    captured_at: snapshot.captured_at,
    line_of_business: snapshot.line_of_business,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const refArg = args.find((a) => a.startsWith("--expect-ref="));
  const expectedRef = (refArg ? refArg.slice("--expect-ref=".length) : process.env.OPA_EXPECTED_PROJECT_REF) ?? "";

  // The row floor is MANDATORY for --apply: on a first load into an empty mirror
  // it is the only thing standing between a truncated extract and the database.
  if (apply && !String(process.env.OPA_MIN_ROWS ?? "").trim()) {
    throw new Error(
      "OPA_MIN_ROWS is required for --apply. State how many data rows you expect AT MINIMUM. " +
        "The database's shrink band only fires once rows are already stored, so the FIRST " +
        "load into an empty mirror has no floor without this."
    );
  }

  const csvPath = process.env.OPA_CSV_PATH;
  if (!csvPath) {
    throw new Error(
      "OPA_CSV_PATH is required. Point it at a local checkout of the PRIVATE repo " +
        "u2giants/licensor-source-data (disney-opa/opa-characters.csv). The CSV must " +
        "NEVER be copied into this public repository."
    );
  }

  const minRowsEnv = String(process.env.OPA_MIN_ROWS ?? "").trim();
  const snapshot = buildSnapshot(parseCsv(decodeUtf8Strict(await readFile(csvPath))), {
    capturedAt: process.env.OPA_CAPTURED_AT,
    sourceUrl: process.env.OPA_SOURCE_URL,
    lineOfBusiness: process.env.OPA_LINE_OF_BUSINESS ?? "Home",
    minRows: minRowsEnv === "" ? undefined : minRowsEnv,
  });

  // Counts only. NEVER print a row: this output lands in CI logs and terminals.
  const summary = summarise(snapshot);
  console.log(JSON.stringify(summary, null, 2));

  // Say it in words as well as in JSON. The owner ruling of 2026-08-07 requires the
  // drop to be LOUD; a number buried in a JSON blob is not loud, and a reader
  // skimming for "rows" would see a smaller figure with no explanation.
  if (summary.rows_rejected_sentinel > 0) {
    console.log(
      `\nSENTINEL ROWS DROPPED: ${summary.rows_rejected_sentinel} of ${summary.rows_read} ` +
        `data row(s) had a NEGATIVE licensedPropertyID or characterID and were NOT loaded ` +
        `(owner ruling 2026-08-07). Row ordinal(s): ` +
        `${summary.rejected_row_ordinals.join(", ")}` +
        (summary.rows_rejected_sentinel > summary.rejected_row_ordinals.length
          ? ", ... (list truncated)"
          : "") +
        `. ${summary.rows} row(s) will load.` +
        (summary.rows_rejected_sentinel > 1
          ? "\nMORE THAN ONE SENTINEL: the 2026-08-06 extract had exactly ONE. A larger " +
            "count means Disney's export changed shape -- investigate before loading."
          : "")
    );
  }

  if (!apply) {
    console.log("\nDRY RUN. No database was contacted. Re-run with --apply to load.");
    return;
  }

  const result = await applySnapshot(snapshot, {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY,
    expectedRef,
    maxShrinkFraction: process.env.OPA_MAX_SHRINK_FRACTION,
  });
  console.log(result.body);
}

// Run only when THIS file is the entry point. The old check fired whenever
// argv[1] merely ENDED WITH the filename, so a neighbouring file such as
// `test-sync-opa-property-character.mjs` importing this module would have
// triggered a real run.
function isEntryPoint() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return resolvePath(fileURLToPath(import.meta.url)) === resolvePath(entry);
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  main().catch((err) => {
    console.error(String(err.message ?? err));
    process.exit(1);
  });
}
