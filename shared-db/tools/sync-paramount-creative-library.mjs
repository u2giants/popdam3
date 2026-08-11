#!/usr/bin/env node
/**
 * Paramount Creative Library capture loader.
 *
 * ============================================================================
 * THIS FILE CONTAINS NO PARAMOUNT DATA, AND MUST NEVER CONTAIN ANY.
 * ============================================================================
 * `u2giants/shared-db` is a PUBLIC repository. The Paramount Creative Library
 * capture is business-confidential source data held under a commercial
 * licensing relationship, and it lives in the PRIVATE repository:
 *
 *     u2giants/licensor-source-data  ->  paramount/
 *
 *     SCHEMA IN GIT. DATA OUT OF GIT.
 *
 * This runner reads the capture from a local checkout of the PRIVATE repo at
 * runtime, streams it to the guarded database functions in bounded chunks, and
 * writes nothing back into this repo. It never prints a source row.
 *
 * Database side (every guard is re-evaluated there; this runner is deliberately
 * NOT the only line of defence):
 *     plm.begin_pmt_capture(...)
 *     plm.load_pmt_capture_chunk(uuid, text, jsonb)
 *     plm.validate_pmt_capture(uuid)
 *     plm.finalize_pmt_capture(uuid, text)
 *     plm.fail_pmt_capture(uuid, text)
 * Migration: 20260810020000_pmt_creative_library_landing.sql
 *
 * ----------------------------------------------------------------------------
 * USAGE
 * ----------------------------------------------------------------------------
 *   PMT_SOURCE_DIR=/path/to/licensor-source-data/paramount \
 *   PMT_PRIVATE_SOURCE_COMMIT=<git rev-parse HEAD of the private checkout> \
 *   PMT_SOURCE_URL=https://<portal-origin>            # ORIGIN ONLY \
 *   PMT_LIBRARY_NAME='<library name>' \
 *   PMT_CAPTURED_BY='<operator>' \
 *   PMT_PORTAL_GLOBAL_ASSET_COUNT=<observed portal-wide count> \
 *   PMT_EXPECTED_PROJECT_REF=<the project ref you MEANT to write> \
 *   DATABASE_URL=postgres://... \
 *   node tools/sync-paramount-creative-library.mjs --apply
 *
 * Without --apply it is a DRY RUN: it hashes, parses, validates and prints
 * counts, and contacts no database at all.
 *
 * ----------------------------------------------------------------------------
 * WHY portal_global_asset_count IS A REQUIRED INPUT AND NOT DERIVED
 * ----------------------------------------------------------------------------
 * The portal-wide current-library count is an observation the operator made in
 * the portal. It is NOT in the capture manifest and cannot be computed from the
 * captured files, because the capture only ever saw this account's authorized
 * slice. Deriving it from anything available here would mean inventing it. So
 * it is a required, explicit input and the loader refuses to start without it.
 * Record where the figure came from in the run notes.
 *
 * ----------------------------------------------------------------------------
 * WRONG-TARGET SAFETY -- READ THIS BEFORE CHANGING THE APPLY PATH
 * ----------------------------------------------------------------------------
 * Every database guard runs INSIDE whichever project you reached, so no database
 * guard can tell you that you reached the WRONG project. One mistyped variable
 * would load the whole confidential capture into the wrong Supabase project.
 * Printing the ref is not a gate -- nobody may be watching. So the ref is a
 * REQUIRED, EXPLICIT input, it is compared against the ref parsed out of
 * DATABASE_URL, and a mismatch ABORTS BEFORE THE FIRST BYTE IS SENT.
 * Do not "simplify" this into a warning.
 *
 * NEVER hard-code a project ref, a URL, a password or a key in this file.
 */

import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve as resolvePath, join } from "node:path";
import { fileURLToPath } from "node:url";

/** A Supabase project ref: 20 lowercase letters/digits. No ref is hard-coded here. */
const PROJECT_REF = /^[a-z0-9]{20}$/;
/** Paramount asset IDs are lowercase 40-character hex. */
const ASSET_ID = /^[0-9a-f]{40}$/;
/** The portal rejected batches of 200 with an HTML error page, so 100 is the proven ceiling. */
export const MAX_BATCH_SIZE = 100;
/** Matches the database-side bound in plm.load_pmt_capture_chunk. */
export const MAX_CHUNK_ROWS = 5000;

/**
 * Decode as STRICT UTF-8.
 *
 * Node's default "utf8" decoding is lenient: an invalid byte becomes U+FFFD
 * silently. A property or character name would land corrupted, pass every later
 * check, and be indistinguishable from correct data. Silent repair of licensor
 * data is how a wrong name reaches a licensing decision.
 */
export function decodeUtf8Strict(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(
      "Source file is not valid UTF-8. Node's default decoding would have silently " +
        "replaced the bad bytes with U+FFFD and corrupted a name without any error. " +
        "Re-export the file as UTF-8; do not load it."
    );
  }
}

/** RFC4180-ish CSV parser: quotes, doubled quotes, embedded commas and newlines. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // strip BOM

  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ",") { row.push(field); field = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Header row + data rows -> array of objects keyed by header name. */
export function csvToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const o = {};
    header.forEach((h, idx) => { o[h] = r[idx] ?? ""; });
    return o;
  });
}

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/** Sorted, comma-joined ID list -> sha256. Sorting is what makes it a SET hash. */
export function hashIdSet(ids) {
  return sha256([...ids].sort().join(","));
}

/**
 * Resolve and VERIFY the database target.
 * Returns the ref on success; throws before any connection on mismatch.
 */
export function resolveTarget({ databaseUrl, expectedRef }) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  if (!expectedRef) {
    throw new Error(
      "PMT_EXPECTED_PROJECT_REF is required. The database cannot tell you that you " +
        "reached the wrong project, so the intended ref must be stated explicitly and " +
        "matched before the first byte is sent."
    );
  }
  if (!PROJECT_REF.test(expectedRef)) {
    throw new Error(`PMT_EXPECTED_PROJECT_REF ${JSON.stringify(expectedRef)} is not a 20-character project ref.`);
  }
  // Supabase connection strings carry the ref either as the user (postgres.<ref>)
  // or as the host label (db.<ref>.supabase.co / <ref>.pooler...).
  const found = new Set();
  for (const m of databaseUrl.matchAll(/[.@/]([a-z0-9]{20})[.:@/]/g)) found.add(m[1]);
  for (const m of databaseUrl.matchAll(/postgres\.([a-z0-9]{20})/g)) found.add(m[1]);
  if (!found.size) {
    throw new Error(
      "Could not find a project ref in DATABASE_URL. Refusing to connect: an unverifiable " +
        "target is exactly the case this check exists for."
    );
  }
  if (!found.has(expectedRef)) {
    throw new Error(
      `REFUSING TO CONNECT. DATABASE_URL points at project ref(s) [${[...found].join(", ")}] ` +
        `but PMT_EXPECTED_PROJECT_REF is ${expectedRef}. Nothing has been sent.`
    );
  }
  return expectedRef;
}

/** Split an array into bounded chunks the database will accept. */
export function chunk(rows, size = MAX_CHUNK_ROWS) {
  if (size < 1 || size > MAX_CHUNK_ROWS) {
    throw new Error(`Chunk size must be between 1 and ${MAX_CHUNK_ROWS}; got ${size}.`);
  }
  const out = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Reconstruct each batch's REQUESTED asset-ID set and compare it to what came back.
 *
 * READ THIS BEFORE TRUSTING requested_ids_sha256.
 * The capture files record only the RETURNED records; the requested list was never
 * written down at capture time. This function RECONSTRUCTS it from the deduplicated
 * authorized-asset list in capture order, in slices of batch_size. That is a
 * derivation, NOT a primary source fact, and it is labelled as such in the database
 * column comment too.
 *
 * It is nonetheless a real check rather than an assumed one, because it is
 * FALSIFIABLE: if the reconstruction is wrong for any batch, the two hashes differ,
 * id_sets_matched is false, the batch cannot be marked complete, and finalization
 * refuses. A wrong assumption fails loudly instead of certifying itself.
 */
export function buildBatchRows(batches, authorizedAssetIds) {
  return batches.map((b) => {
    const start = (b.batch_number - 1) * MAX_BATCH_SIZE;
    const requested = authorizedAssetIds.slice(start, start + b.batch_size);
    const returned = (b.records ?? []).map((r) => r.asset_id);

    const requestedHash = hashIdSet(requested);
    const returnedHash = hashIdSet(returned);
    const matched = requestedHash === returnedHash;

    const failures = Array.isArray(b.failures) ? b.failures : [];
    const complete =
      matched &&
      b.status === 200 &&
      b.batch_size > 0 &&
      b.batch_size <= MAX_BATCH_SIZE &&
      returned.length === b.batch_size &&
      failures.length === 0;

    const reasons = [];
    if (!matched) reasons.push("requested and returned ID sets differ");
    if (b.status !== 200) reasons.push(`http status ${b.status}`);
    if (b.batch_size > MAX_BATCH_SIZE) reasons.push(`batch size ${b.batch_size} exceeds ${MAX_BATCH_SIZE}`);
    if (returned.length !== b.batch_size) reasons.push("returned count differs from batch size");
    if (failures.length) reasons.push(`${failures.length} recorded failure(s)`);

    return {
      batch_number: b.batch_number,
      expected_asset_count: b.batch_size,
      returned_asset_count: returned.length,
      first_asset_id: b.first_asset_id,
      last_asset_id: b.last_asset_id,
      http_status: b.status,
      content_was_json: true, // the file parsed as JSON; an HTML error page never reaches here
      requested_ids_sha256: requestedHash,
      returned_ids_sha256: returnedHash,
      id_sets_matched: matched,
      complete,
      failure_message: complete ? null : reasons.join("; "),
      captured_at: b.captured_at,
    };
  });
}

/** Assert every asset ID is the lowercase-40-hex shape the database enforces. */
export function assertAssetIds(ids) {
  const bad = ids.filter((id) => !ASSET_ID.test(id));
  if (bad.length) {
    // Deliberately reports a COUNT, never the offending value: an asset ID is source data.
    throw new Error(
      `${bad.length} asset ID(s) are not lowercase 40-character hexadecimal. The offending ` +
        "values are NOT printed because asset IDs are confidential source data."
    );
  }
}

/** Required-input validation. Runs BEFORE any file read or connection. */
export function resolveRunConfig(env) {
  const need = (k, why) => {
    const v = (env[k] ?? "").trim();
    if (!v) throw new Error(`${k} is required. ${why}`);
    return v;
  };

  const portalCount = Number(
    need(
      "PMT_PORTAL_GLOBAL_ASSET_COUNT",
      "It is an operator observation of the portal-wide library size, is absent from the " +
        "capture manifest, and cannot be derived from the captured files. It must be stated " +
        "deliberately, never inferred."
    )
  );
  if (!Number.isInteger(portalCount) || portalCount < 0) {
    throw new Error("PMT_PORTAL_GLOBAL_ASSET_COUNT must be a non-negative integer.");
  }

  const sourceUrl = need("PMT_SOURCE_URL", "Every capture must carry its own provenance.");
  if (/[?#]/.test(sourceUrl)) {
    throw new Error(
      "PMT_SOURCE_URL must be an ORIGIN only. It carries a query string or fragment, which is " +
        "how a session token or signed URL ends up stored in the database."
    );
  }

  return {
    sourceDir: resolvePath(need("PMT_SOURCE_DIR", "Point it at the private checkout's paramount/ directory.")),
    privateSourceCommit: need("PMT_PRIVATE_SOURCE_COMMIT", "Run `git rev-parse HEAD` in the private checkout."),
    sourceUrl,
    libraryName: need("PMT_LIBRARY_NAME", "The portal library this capture came from."),
    capturedBy: need("PMT_CAPTURED_BY", "Who ran the capture."),
    portalGlobalAssetCount: portalCount,
    captureKind: (env.PMT_CAPTURE_KIND ?? "full").trim(),
    expectedRef: (env.PMT_EXPECTED_PROJECT_REF ?? "").trim(),
    databaseUrl: env.DATABASE_URL ?? "",
    notes: env.PMT_NOTES ?? null,
  };
}

/**
 * Read the whole capture and hash every file BEFORE connecting.
 * Returns the parsed capture plus the manifest hash the database will be given.
 */
export async function readCapture(sourceDir) {
  const readText = async (rel) => decodeUtf8Strict(await readFile(join(sourceDir, rel)));
  const readJson = async (rel) => JSON.parse(await readText(rel));
  const readCsv = async (rel) => csvToObjects(await readText(rel));
  /**
   * Line-oriented JSON, one metadata value per line. NOT one giant JSON array: the metadata
   * population is roughly six times the asset count, and an array forces the whole capture
   * through a single JSON.parse and a single peak allocation. A blank line is skipped; a
   * malformed line THROWS with its line number and never with its contents (public repo).
   */
  const readJsonl = async (rel) => {
    const out = [];
    const text = await readText(rel);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "") continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        throw new Error(`${rel} line ${i + 1}: not valid JSON. (Line contents withheld: this repository is public.)`);
      }
    }
    return out;
  };

  const manifestRaw = await readFile(join(sourceDir, "capture-summary.json"));
  const manifestSha256 = sha256(manifestRaw);
  const manifest = JSON.parse(decodeUtf8Strict(manifestRaw));

  const authorized = await readJson("authorized-assets.json");
  const authorizedAssetIds = authorized.assets.map((a) => a.asset_id);
  assertAssetIds(authorizedAssetIds);

  const batchDir = join(sourceDir, "metadata-batches");
  const batchFiles = (await readdir(batchDir)).filter((f) => f.endsWith(".json")).sort();
  const batches = [];
  for (const f of batchFiles) {
    batches.push(JSON.parse(decodeUtf8Strict(await readFile(join(batchDir, f)))));
  }

  return {
    manifest,
    manifestSha256,
    authorizedAssetIds,
    batches,
    assets: await readCsv("assets.csv"),
    properties: await readCsv("properties.csv"),
    franchises: await readCsv("franchises.csv"),
    characters: await readCsv("characters.csv"),
    collections: await readCsv("style-guides.csv"),
    brands: await readCsv("brands.csv"),
    titleSummary: await readCsv("licensed-title-summary.csv"),
    titleScope: await readCsv("licensed-title-scope.csv"),
    captureLog: await readCsv("capture-log.csv"),
    anomalies: await readCsv("relationship-anomalies.csv"),
    linkAssetProperty: await readCsv("links-asset-property.csv"),
    linkAssetFranchise: await readCsv("links-asset-franchise.csv"),
    linkAssetCharacter: await readCsv("links-asset-character.csv"),
    linkAssetCollection: await readCsv("links-asset-style-guide.csv"),
    linkAssetBrand: await readCsv("links-asset-brand.csv"),
    linkPropertyCharacter: await readCsv("links-property-character.csv"),
    linkPropertyCollection: await readCsv("links-property-collection.csv"),
    linkPropertyFranchise: await readCsv("links-property-franchise.csv"),
    linkAuthorizedContext: await readCsv("links-authorized-property-context.csv"),
    // The lossless repeated-metadata population, written by the PRIVATE builder
    // (paramount/scripts/build-normalized.mjs). Required, not optional: a capture that
    // cannot produce it is not a lossless capture, and letting it default to [] would load
    // a hollow capture that reconciles against a missing expectation and looks complete.
    assetMetadataValues: await readJsonl("asset-metadata-values.jsonl"),
  };
}

/**
 * EXACT source-ID handling. Read this before touching any `*_source_id` field.
 *
 * Paramount's Property/Franchise/Character/Collection/Brand IDs look numeric and are NOT
 * numbers -- they are opaque identities. Passing one through `Number()` breaks it in two
 * ways that BOTH succeed silently:
 *
 *   1. Leading zeroes vanish.   Number('007')  ->  7      -- '007' and '7' become one row.
 *   2. Precision is lost above 2^53.
 *      Number('9007199254740993') -> 9007199254740992     -- off by one, no error, no warning.
 *
 * Neither throws. Both produce a wrong row that looks right, and the database can no longer
 * tell it happened. So this validator NEVER converts: it checks the characters of the string
 * and returns the ORIGINAL string untouched.
 *
 * It is deliberately strict rather than forgiving. `^[0-9]+$` is the format proven against
 * the capture; if Paramount ever emits an alphanumeric ID this THROWS instead of guessing,
 * and widening the format becomes a reviewed change. Refusing loudly is the whole point --
 * a loader that quietly coerces an unexpected identity is how the original bug shipped.
 *
 * @param {unknown} value      the raw CSV cell
 * @param {string}  fieldName  e.g. 'pmt_asset_property.property_source_id' -- named in the
 *                             error so a failure says WHICH field, without printing a row
 * @returns {string} the exact original string
 */
export function exactSourceId(value, fieldName) {
  // No row content in any message below: the field name and a character-class description
  // are enough to debug, and this repository is PUBLIC.
  if (typeof value !== "string") {
    throw new Error(
      `${fieldName}: source ID must be a string, got ${value === null ? "null" : typeof value}. ` +
        `Source IDs are identities and must never arrive as JavaScript numbers -- by the time ` +
        `a number reaches here its leading zeroes and its precision above 2^53 are already gone.`
    );
  }
  if (value === "") {
    throw new Error(`${fieldName}: source ID is empty. An absent identity is never loadable.`);
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(
      `${fieldName}: source ID does not match the proven source format ^[0-9]+$ ` +
        `(length ${value.length}). Refusing rather than guessing. If Paramount has genuinely ` +
        `started emitting a new ID format, widen BOTH this check and the matching CHECK ` +
        `constraint in a reviewed migration -- never only one of the two.`
    );
  }
  return value; // exact, unconverted, leading zeroes and full length intact
}

/** Map the manifest's nested shape onto the flat population names the database expects. */
export function manifestExpectations(m) {
  return {
    licensed_business_titles: m.licensed_business_titles,
    captured_properties: m.captured_properties,
    property_result_rows: m.property_result_rows,
    unique_authorized_assets: m.unique_authorized_assets,
    metadata_batches: m.metadata_batches,
    properties: m.entities.properties,
    franchises: m.entities.franchises,
    characters: m.entities.characters,
    style_guides: m.entities.style_guides,
    brands: m.entities.brands,
    asset_property: m.relationships.asset_property,
    asset_franchise: m.relationships.asset_franchise,
    asset_character: m.relationships.asset_character,
    asset_style_guide: m.relationships.asset_style_guide,
    asset_brand: m.relationships.asset_brand,
    property_character_explicit: m.relationships.property_character_explicit,
    property_style_guide_explicit: m.relationships.property_style_guide_explicit,
    property_franchise_asset_cooccurrence: m.relationships.property_franchise_asset_cooccurrence,
    authorized_property_context: m.relationships.authorized_property_context,
    malformed_explicit_pairs: m.malformed_explicit_pairs,
    // NEW: the lossless repeated-metadata population. The private builder writes this count
    // into capture-summary.json alongside the others. If it is absent the value is undefined,
    // the expectation row is refused by the database's not-null column, and the capture fails
    // loudly -- which is correct: a capture that cannot state how many metadata values it
    // holds cannot be shown to be lossless.
    asset_metadata_values: m.asset_metadata_values,
  };
}

/**
 * The LOAD ORDER. Parents strictly before links, exactly as the spec requires and as
 * the capture-scoped composite foreign keys enforce: a link whose endpoint has not
 * been loaded yet is rejected by the database, not merely by this ordering.
 */
export const LOAD_ORDER = [
  "pmt_capture_batch",
  "pmt_authorized_title",
  "pmt_property",
  "pmt_franchise",
  "pmt_character",
  "pmt_collection",
  "pmt_brand",
  "pmt_asset",
  "pmt_authorized_title_property",
  "pmt_asset_property",
  "pmt_asset_franchise",
  "pmt_asset_character",
  "pmt_asset_collection",
  "pmt_asset_brand",
  "pmt_property_character",
  "pmt_property_collection",
  "pmt_property_franchise_evidence",
  "pmt_authorized_property_asset",
  "pmt_property_capture_log",
  "pmt_relationship_anomaly",
  // LAST, and it must be last: every metadata row is bound to an asset in the same capture
  // by a composite foreign key, so pmt_asset has to be loaded before any of these can land.
  "pmt_asset_metadata_value",
];

/** Build every target's row array from the parsed capture. No database contact. */
export function buildPayloads(cap) {
  const num = (v) => (v === "" || v == null ? null : Number(v));
  const licensedPropertyIds = new Set(
    cap.titleScope.filter((r) => r.property_id).map((r) => String(r.property_id))
  );

  return {
    pmt_capture_batch: buildBatchRows(cap.batches, cap.authorizedAssetIds),

    pmt_authorized_title: cap.titleSummary.map((r) => ({
      authorized_title_key: r.licensed_business_title,
      authorized_title_name: r.licensed_business_title,
      capture_status: r.capture_status,
      resolved_property_count: num(r.resolved_property_count) ?? 0,
      unique_asset_count: num(r.unique_asset_count) ?? 0,
      full_metadata_count: num(r.full_metadata_count) ?? 0,
      notes: r.notes || null,
    })),

    pmt_property: cap.properties.map((r) => ({
      property_source_id: exactSourceId(r.source_id, 'pmt_property.property_source_id'),
      property_name: r.name,
      is_licensed_selection: licensedPropertyIds.has(String(r.source_id)),
    })),

    pmt_franchise: cap.franchises.map((r) => ({
      franchise_source_id: exactSourceId(r.source_id, 'pmt_franchise.franchise_source_id'),
      franchise_name: r.name,
    })),
    pmt_character: cap.characters.map((r) => ({
      character_source_id: exactSourceId(r.source_id, 'pmt_character.character_source_id'),
      character_name: r.name,
    })),
    pmt_collection: cap.collections.map((r) => ({
      collection_source_id: exactSourceId(r.source_id, 'pmt_collection.collection_source_id'),
      collection_name: r.name,
      paramount_term: r.paramount_term || "Collection",
    })),
    pmt_brand: cap.brands.map((r) => ({
      brand_source_id: exactSourceId(r.source_id, 'pmt_brand.brand_source_id'),
      brand_name: r.name,
    })),

    pmt_asset: cap.assets.map((r) => ({
      asset_id: r.asset_id,
      asset_name: r.name,
      date_imported: r.date_imported || null,
      date_last_updated: r.date_last_updated || null,
      content_size_bytes: num(r.content_size) ?? 0,
      content_type: r.content_type,
      mime_type: r.mime_type,
      asset_version: num(r.version) ?? 0,
    })),

    pmt_authorized_title_property: cap.titleScope
      .filter((r) => r.property_id)
      .map((r) => ({
        authorized_title_key: r.licensed_business_title,
        property_source_id: exactSourceId(r.property_id, 'pmt_authorized_title_property.property_source_id'),
        paramount_property_name: r.paramount_property_name,
        reported_asset_count: num(r.reported_asset_count) ?? 0,
        mapping_status: r.capture_status,
        notes: r.notes || null,
      })),

    pmt_asset_property: cap.linkAssetProperty.map((r) => ({
      asset_id: r.asset_id,
      property_source_id: exactSourceId(r.property_id, 'pmt_asset_property.property_source_id'),
    })),
    pmt_asset_franchise: cap.linkAssetFranchise.map((r) => ({
      asset_id: r.asset_id,
      franchise_source_id: exactSourceId(r.franchise_id, 'pmt_asset_franchise.franchise_source_id'),
    })),
    pmt_asset_character: cap.linkAssetCharacter.map((r) => ({
      asset_id: r.asset_id,
      character_source_id: exactSourceId(r.character_id, 'pmt_asset_character.character_source_id'),
    })),
    pmt_asset_collection: cap.linkAssetCollection.map((r) => ({
      asset_id: r.asset_id,
      collection_source_id: exactSourceId(r.style_guide_id, 'pmt_asset_collection.collection_source_id'),
    })),
    pmt_asset_brand: cap.linkAssetBrand.map((r) => ({
      asset_id: r.asset_id,
      brand_source_id: exactSourceId(r.brand_id, 'pmt_asset_brand.brand_source_id'),
    })),

    pmt_property_character: cap.linkPropertyCharacter.map((r) => ({
      property_source_id: exactSourceId(r.property_id, 'pmt_property_character.property_source_id'),
      character_source_id: exactSourceId(r.character_id, 'pmt_property_character.character_source_id'),
      evidence_asset_count: num(r.evidence_asset_count) ?? 0,
    })),
    pmt_property_collection: cap.linkPropertyCollection.map((r) => ({
      property_source_id: exactSourceId(r.property_id, 'pmt_property_collection.property_source_id'),
      collection_source_id: exactSourceId(r.collection_id, 'pmt_property_collection.collection_source_id'),
      evidence_asset_count: num(r.evidence_asset_count) ?? 0,
    })),
    // is_direct_source_relationship and evidence_kind are deliberately NOT sent.
    // The database pins both; sending them would imply they are ours to choose.
    pmt_property_franchise_evidence: cap.linkPropertyFranchise.map((r) => ({
      property_source_id: exactSourceId(r.property_id, 'pmt_property_franchise_evidence.property_source_id'),
      franchise_source_id: exactSourceId(r.franchise_id, 'pmt_property_franchise_evidence.franchise_source_id'),
      evidence_asset_count: num(r.evidence_asset_count) ?? 0,
    })),

    pmt_authorized_property_asset: cap.linkAuthorizedContext.map((r) => ({
      licensed_property_source_id: exactSourceId(r.licensed_property_id, 'pmt_authorized_property_asset.licensed_property_source_id'),
      asset_id: r.asset_id,
    })),

    pmt_property_capture_log: cap.captureLog.map((r) => ({
      property_source_id: exactSourceId(r.property_id, 'pmt_property_capture_log.property_source_id'),
      property_name: r.property_name,
      reported_asset_count: num(r.reported_asset_count) ?? 0,
      captured_asset_count: num(r.captured_asset_count) ?? 0,
      page_count: num(r.page_count) ?? 0,
      complete: String(r.complete).toLowerCase() === "true",
      failure_message: r.failures && r.failures !== "0" && r.failures !== "" ? r.failures : null,
    })),

    pmt_relationship_anomaly: cap.anomalies.map((r) => ({
      asset_id: r.asset_id,
      relationship_field: r.relationship_field,
      raw_value: r.raw_value,
      action: r.action,
      details: null,
    })),

    /**
     * The lossless repeated-metadata rows, passed through with as little handling as
     * possible. Three rules are load-bearing here:
     *
     *  1. `value_ordinal` is taken FROM THE ROW, never from the array index. Array position
     *     is an artefact of how this file happened to be read; the builder recorded the
     *     source's own order and that is the fact being preserved.
     *  2. A missing optional field becomes `null`, never the STRING "undefined". `undefined`
     *     is what JavaScript prints for an absent property, and letting it through would
     *     turn "the source did not say" into "the source said the word undefined". The
     *     database refuses it too (pmt_amv_not_undefined_chk) -- both, deliberately.
     *  3. No numeric conversion anywhere. `source_value` is kept as TEXT even when the
     *     source emitted a JSON number, because which of the two it was is itself recorded
     *     in `data_type`. Re-parsing it here is exactly the bug this migration removes.
     */
    pmt_asset_metadata_value: cap.assetMetadataValues.map((r, i) => {
      const opt = (v) => (v === undefined || v === null || v === "undefined" ? null : v);
      if (typeof r.value_ordinal !== "number" || !Number.isInteger(r.value_ordinal) || r.value_ordinal < 0) {
        throw new Error(
          `asset-metadata-values.jsonl row ${i + 1}: value_ordinal must be a non-negative ` +
            `integer supplied by the builder. It records the SOURCE's order and must never ` +
            `be inferred from this file's line order.`
        );
      }
      if (typeof r.metadata_element_id !== "string" || r.metadata_element_id.trim() === "") {
        throw new Error(`asset-metadata-values.jsonl row ${i + 1}: metadata_element_id is required.`);
      }
      if (typeof r.asset_id !== "string" || !ASSET_ID.test(r.asset_id)) {
        throw new Error(
          `asset-metadata-values.jsonl row ${i + 1}: asset_id must be 40 lowercase hex characters.`
        );
      }
      return {
        asset_id: r.asset_id,
        metadata_element_id: r.metadata_element_id,
        metadata_element_name: opt(r.metadata_element_name),
        metadata_category_id: opt(r.metadata_category_id),
        metadata_category_name: opt(r.metadata_category_name),
        domain_id: opt(r.domain_id),
        source_table_name: opt(r.source_table_name),
        source_column_name: opt(r.source_column_name),
        data_type: opt(r.data_type),
        value_ordinal: r.value_ordinal,
        source_value: opt(r.source_value),
        display_value: opt(r.display_value),
        language: opt(r.language),
        source_path: opt(r.source_path),
        raw_value: opt(r.raw_value),
      };
    }),
  };
}

/** Counts only. NEVER a row. Safe to print and safe to paste into a report. */
export function summarise(payloads) {
  return Object.fromEntries(
    LOAD_ORDER.map((t) => [t, (payloads[t] ?? []).length])
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const cfg = resolveRunConfig(process.env);

  // Hash and validate everything BEFORE any connection is opened.
  const cap = await readCapture(cfg.sourceDir);
  const payloads = buildPayloads(cap);
  const counts = summarise(payloads);
  const expectations = manifestExpectations(cap.manifest);

  console.log("Paramount Creative Library capture");
  console.log("  manifest sha256      :", cap.manifestSha256);
  console.log("  private source commit:", cfg.privateSourceCommit);
  console.log("  rows per target      :", JSON.stringify(counts, null, 2));

  const badBatches = payloads.pmt_capture_batch.filter((b) => !b.complete);
  console.log("  incomplete batches   :", badBatches.length);

  if (!apply) {
    console.log("\nDRY RUN. No database was contacted. Re-run with --apply to load.");
    return;
  }

  const ref = resolveTarget({ databaseUrl: cfg.databaseUrl, expectedRef: cfg.expectedRef });
  console.log("  target project ref   :", ref, "(verified against DATABASE_URL)");

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: cfg.databaseUrl });
  await client.connect();

  let captureId = null;
  try {
    const begun = await client.query(
      `select plm.begin_pmt_capture($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) as id`,
      [
        cfg.captureKind, cfg.sourceUrl, cfg.libraryName, new Date().toISOString(), cfg.capturedBy,
        cfg.privateSourceCommit, cap.manifestSha256,
        cfg.portalGlobalAssetCount,
        expectations.licensed_business_titles,
        expectations.captured_properties,
        expectations.property_result_rows,
        expectations.unique_authorized_assets,
        expectations.metadata_batches,
        JSON.stringify({
          ...expectations,
          licensed_property_selections: payloads.pmt_property.filter((p) => p.is_licensed_selection).length,
        }),
        cfg.notes,
      ]
    );
    captureId = begun.rows[0].id;
    console.log("  capture id           :", captureId);

    for (const target of LOAD_ORDER) {
      const rows = payloads[target] ?? [];
      let loaded = 0;
      for (const part of chunk(rows)) {
        const r = await client.query(
          `select plm.load_pmt_capture_chunk($1,$2,$3::jsonb) as n`,
          [captureId, target, JSON.stringify(part)]
        );
        const n = Number(r.rows[0].n);
        // Validate the response, do not assume it. A chunk that reports fewer rows than
        // it was given has silently dropped something.
        if (n !== part.length) {
          throw new Error(`${target}: sent ${part.length} rows, database reported ${n}.`);
        }
        loaded += n;
      }
      console.log(`  loaded ${target}: ${loaded}`);
    }

    const report = await client.query(
      `select check_name, expected, actual, ok, detail from plm.finalize_pmt_capture($1,$2)`,
      [captureId, cap.manifestSha256]
    );
    const failed = report.rows.filter((r) => !r.ok);
    console.log(`  validation checks    : ${report.rows.length} run, ${failed.length} failed`);
    if (failed.length) throw new Error("finalization reported failing checks");
    console.log("  CAPTURE COMPLETE.");
  } catch (err) {
    // Leave failed work VISIBLE. Never delete a partial capture: it is the diagnosis.
    if (captureId) {
      try {
        await client.query(`select plm.fail_pmt_capture($1,$2)`, [captureId, String(err.message).slice(0, 500)]);
        console.error(`  capture ${captureId} marked FAILED and left in place for diagnosis.`);
      } catch { /* the original error matters more than this one */ }
    }
    throw err;
  } finally {
    await client.end();
  }
}

if (process.argv[1] && resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error("FAILED:", e.message); process.exitCode = 1; });
}
