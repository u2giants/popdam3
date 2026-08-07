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
 * Migrations: 20260807170000 (landing), 20260807170100 (importer).
 *
 * ----------------------------------------------------------------------------
 * USAGE
 * ----------------------------------------------------------------------------
 *   OPA_CSV_PATH=/path/to/licensor-source-data/disney-opa/opa-characters.csv \
 *   OPA_CAPTURED_AT=2026-08-06 \
 *   OPA_SOURCE_URL='https://opa.disney.com/...' \
 *   SUPABASE_URL=https://<project-ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<from 1Password vault vibe_coding> \
 *   node tools/sync-opa-property-character.mjs --apply
 *
 * Without --apply it runs a DRY RUN: it parses, validates and prints counts,
 * and contacts no database at all.
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
 * Minimal RFC4180 CSV parser. Handles quoted fields, embedded commas, embedded
 * newlines and doubled quotes. Deliberately dependency-free: this file must be
 * runnable from a bare checkout without installing anything.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  // Strip a UTF-8 BOM; Disney's export carries one and it corrupts the first header.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

/**
 * Turn parsed CSV rows into the snapshot the database importer expects.
 *
 * Fails LOUDLY on anything unexpected. The database re-checks every one of
 * these independently (defence in depth) -- a guard here is a fast, readable
 * failure, not the security boundary.
 */
export function buildSnapshot(rows, { capturedAt, sourceUrl, lineOfBusiness = "Home" }) {
  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error("CSV has no data rows. A failed extract must not look like a success.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(capturedAt ?? ""))) {
    throw new Error(
      `OPA_CAPTURED_AT must be an explicit ISO date (YYYY-MM-DD), got ${JSON.stringify(capturedAt)}. ` +
        "It is never derived from the clock: the database runs America/New_York and a " +
        "UTC-midnight timestamp reads back one day early."
    );
  }
  if (!String(sourceUrl ?? "").trim()) {
    throw new Error("OPA_SOURCE_URL is required; every row must carry its own provenance.");
  }

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
  const seen = new Set();
  const duplicates = [];

  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    const rec = {};

    for (const col of REQUIRED_COLUMNS) {
      const raw = (r[idx[col]] ?? "").trim();

      if (NUMERIC_COLUMNS.includes(col)) {
        // Disney uses NEGATIVE SENTINELS (the "Special Projects" node). Integers
        // here must accept them; any unsigned parsing silently drops that row.
        if (!/^-?\d+$/.test(raw)) {
          throw new Error(`row ${i + 1}: ${col} is not an integer (${JSON.stringify(raw)})`);
        }
        rec[col] = Number(raw);
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

    // THE NATURAL KEY IS THE ID PAIR, NOT THE NAME PAIR. Measured on the
    // 2026-08-06 extract, the name pair yields 10,240 distinct values across
    // 10,262 rows -- 22 collisions -- so keying on names silently drops 22 rows.
    const key = `${rec.licensedPropertyID}\0${rec.characterID}`;
    if (seen.has(key)) duplicates.push(key.replace("\0", ","));
    seen.add(key);

    out.push(rec);
  }

  if (duplicates.length > 0) {
    throw new Error(
      `${duplicates.length} duplicate (licensedPropertyID, characterID) pair(s) in the CSV, ` +
        `e.g. ${duplicates.slice(0, 3).join(" | ")}. The ID pair is the natural key; a ` +
        "duplicate means the extract is wrong, not that a winner should be picked."
    );
  }

  return {
    captured_at: capturedAt,
    source_url: sourceUrl,
    line_of_business: lineOfBusiness,
    rows: out,
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
 * The database also defends itself against this (it coalesces the parameter), but a
 * typo in an env var must fail HERE, loudly, before anything is sent.
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

export function summarise(snapshot) {
  const properties = new Set(snapshot.rows.map((r) => r.licensedPropertyID));
  const characters = new Set(snapshot.rows.map((r) => r.characterID));
  const namePairs = new Set(snapshot.rows.map((r) => `${r.property}\0${r.character}`));

  return {
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
  const apply = process.argv.slice(2).includes("--apply");

  const csvPath = process.env.OPA_CSV_PATH;
  if (!csvPath) {
    throw new Error(
      "OPA_CSV_PATH is required. Point it at a local checkout of the PRIVATE repo " +
        "u2giants/licensor-source-data (disney-opa/opa-characters.csv). The CSV must " +
        "NEVER be copied into this public repository."
    );
  }

  const snapshot = buildSnapshot(parseCsv(await readFile(csvPath, "utf8")), {
    capturedAt: process.env.OPA_CAPTURED_AT,
    sourceUrl: process.env.OPA_SOURCE_URL,
    lineOfBusiness: process.env.OPA_LINE_OF_BUSINESS ?? "Home",
  });

  // Counts only. NEVER print a row: this output lands in CI logs and terminals.
  console.log(JSON.stringify(summarise(snapshot), null, 2));

  if (!apply) {
    console.log("\nDRY RUN. No database was contacted. Re-run with --apply to load.");
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply. Fetch the key " +
        "from 1Password (vault vibe_coding) into the environment; never hard-code it."
    );
  }

  // The project ref is IN THE URL and therefore cannot drift the way an MCP
  // connection can. Print it so the operator can see which project was written.
  const ref = new URL(url).hostname.split(".")[0];
  console.log(`\nApplying to Supabase project ref: ${ref}`);

  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/sync_opa_property_character`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_snapshot: snapshot,
      p_mode: "mirror_only",
      p_max_shrink_fraction: resolveShrinkFraction(process.env.OPA_MAX_SHRINK_FRACTION),
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
  console.log(body);
}

if (import.meta.url === `file://${process.argv[1]}`.replace(/\\/g, "/")
    || process.argv[1]?.endsWith("sync-opa-property-character.mjs")) {
  main().catch((err) => {
    console.error(String(err.message ?? err));
    process.exit(1);
  });
}
