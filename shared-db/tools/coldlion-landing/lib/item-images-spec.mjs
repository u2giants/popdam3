// ColdLion /itemImages METADATA landing contract (issue #2179).
//
// The table is coldlion.item_image_metadata (migration authored under #2179). This
// module is the contract a loader must honour; the loader itself is a separate
// maintenance change and must import this spec rather than restate it.
//
//   * Owner decision 2026-09-28 (Albert, "keep"): all fourteen metadata fields are
//     INGESTED — docs/coldlion-field-decisions-20260819.csv, feed itemImages.
//   * resourceContent and thumbnail128 are image BYTES and are EXCLUDED. They are
//     stripped from the record before hashing, projection or any retained audit
//     payload, so no image-derived byte ever reaches the database or a log.
//   * Grain: (company_code, pkey). resourceId and the (company, division, item,
//     colour) selector both collided in the 2026-09-08 census; neither is a key.
//   * Enumeration: itemNo is a required request parameter. Harvest item numbers
//     from coldlion.item_header, which the master loader lands FIRST. hasImage=Y
//     is not proof of a row (12 of 75 flagged items answered []): a zero-row
//     response is recorded evidence, never an error.

import { bigint, sourceHash, text } from "./values.mjs";
import { assertKnownShape } from "./project-masters.mjs";

const f = (api, column, type = "text") => ({ api, column, type });

export const ITEM_IMAGES_TABLE = "coldlion.item_image_metadata";
export const ITEM_IMAGES_HARVEST_TABLE = "coldlion.item_header";
export const ITEM_IMAGES_EXCLUDED_CONTENT = Object.freeze(["resourceContent", "thumbnail128"]);

export const ITEM_IMAGES_SPEC = Object.freeze({
  endpoint: "/itemImages",
  key: ["company_code", "pkey"],
  paged: false,
  requestKey: "itemNo",
  ignored: ITEM_IMAGES_EXCLUDED_CONTENT,
  fields: Object.freeze([
    f("companyCode", "company_code"),
    f("pkey", "pkey", "int"),
    f("resourceId", "resource_id", "int"),
    f("divisionCode", "division_code"),
    f("itemNo", "item_no"),
    f("colorCode", "color_code"),
    f("labelCode", "label_code"),
    f("fileName", "file_name"),
    f("fileType", "file_type"),
    f("itemImageDesc", "item_image_desc"),
    f("createdTime", "created_time", "ts"),
    f("createdUser", "created_user"),
    f("modTime", "mod_time", "ts"),
    f("modUser", "mod_user"),
  ]),
});

function timestamp(value) {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.valueOf())) throw new Error("a timestamp field was not an ISO timestamp");
  if (parsed.toISOString() <= "1900-01-01T23:59:59.999Z") return null;
  return parsed.toISOString();
}

const converters = { text, int: bigint, ts: timestamp };

/** Return a copy of the vendor record with every image-content field removed. */
export function stripImageContent(source) {
  const copy = { ...source };
  for (const field of ITEM_IMAGES_EXCLUDED_CONTENT) delete copy[field];
  return copy;
}

function refuse(message) {
  return Object.assign(new Error(`${ITEM_IMAGES_SPEC.endpoint} ${message}`), { endpoint: ITEM_IMAGES_SPEC.endpoint });
}

/**
 * Project raw /itemImages rows for one requested item into landing rows.
 * Refuses before anything is staged: unknown fields, omitted approved fields,
 * a blank key, a row answering another company or item, and a repeated pkey
 * carrying different bytes. Image content never survives into the result.
 */
export function projectItemImageRows(sourceRows, { runId, fetchedAt, request } = {}) {
  if (!Array.isArray(sourceRows)) throw refuse("response is not a bare JSON array");
  try { assertKnownShape(ITEM_IMAGES_SPEC, sourceRows); }
  catch (error) { error.endpoint ??= ITEM_IMAGES_SPEC.endpoint; throw error; }
  const byKey = new Map();
  for (const raw of sourceRows) {
    const source = stripImageContent(raw);
    if (request) {
      if (String(source.companyCode ?? "").trim() !== String(request.companyCode).trim()) throw refuse("returned a row for another company");
      if (String(source.itemNo ?? "").trim().toUpperCase() !== String(request.itemNo).trim().toUpperCase()) throw refuse("returned a row for another item");
    }
    const row = {};
    for (const field of ITEM_IMAGES_SPEC.fields) row[field.column] = converters[field.type](source[field.api]);
    if (ITEM_IMAGES_SPEC.key.some((column) => row[column] === null)) throw refuse("returned a blank key");
    row.source_hash = sourceHash(source);
    // Loader inserts only projected columns + provenance. Never attach source_raw
    // or any non-column field here: the table has no such column (migration rule).
    row.run_id = runId;
    row.fetched_at = fetchedAt;
    const key = ITEM_IMAGES_SPEC.key.map((column) => row[column]).join("\u001f");
    const prior = byKey.get(key);
    if (prior) {
      if (prior.source_hash !== row.source_hash) throw refuse("returned conflicting rows for one pkey");
      continue;
    }
    byKey.set(key, row);
  }
  return { rows: [...byKey.values()], byKey };
}
