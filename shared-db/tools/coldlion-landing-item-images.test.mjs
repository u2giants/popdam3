// Offline contract tests for the ColdLion /itemImages metadata loader contract
// (issue #2179). Synthetic fixtures only; no network, no database, no real values.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  ITEM_IMAGES_EXCLUDED_CONTENT,
  ITEM_IMAGES_SPEC,
  projectItemImageRows,
  stripImageContent,
} from "./coldlion-landing/lib/item-images-spec.mjs";

const RUN = "33333333-3333-4333-8333-333333333333";
const NOW = "2026-09-28T00:00:00.000Z";
const REQUEST = { companyCode: "SYNCO", itemNo: "SYN-ITEM" };

function sourceRow(overrides = {}) {
  const row = {};
  for (const field of ITEM_IMAGES_SPEC.fields) {
    row[field.api] = field.type === "int" ? 7 : field.type === "ts" ? "2026-01-02T03:04:05Z" : `SYN-${field.api}`;
  }
  row.companyCode = "SYNCO";
  row.itemNo = "SYN-ITEM";
  row.resourceContent = "QUJDRA==";
  row.thumbnail128 = "RUZHSA==";
  return { ...row, ...overrides };
}

test("the contract covers exactly the fourteen owner-ingested fields", () => {
  assert.deepEqual(
    ITEM_IMAGES_SPEC.fields.map((field) => field.api).sort(),
    ["colorCode", "companyCode", "createdTime", "createdUser", "divisionCode", "fileName", "fileType",
      "itemImageDesc", "itemNo", "labelCode", "modTime", "modUser", "pkey", "resourceId"],
  );
  assert.deepEqual(ITEM_IMAGES_SPEC.key, ["company_code", "pkey"]);
});

test("the field-decision register records all fourteen as ingest and the image bytes as decided ignore", () => {
  const lines = readFileSync(new URL("../docs/coldlion-field-decisions-20260819.csv", import.meta.url), "utf8")
    .split(/\r?\n/).filter((line) => line.startsWith("itemImages,"));
  const decided = new Map(lines.map((line) => { const [, field, decision] = line.split(","); return [field, decision]; }));
  assert.equal(decided.size, 14 + ITEM_IMAGES_EXCLUDED_CONTENT.length);
  for (const field of ITEM_IMAGES_SPEC.fields) assert.equal(decided.get(field.api), "ingest", field.api);
  for (const excluded of ITEM_IMAGES_EXCLUDED_CONTENT) assert.equal(decided.get(excluded), "ignore", excluded);
});

test("the migration has one column per contract field and no image-content column", () => {
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const name = readdirSync(dir).find((file) => file.endsWith("_coldlion_item_image_metadata_landing.sql"));
  assert.ok(name, "migration present");
  const sql = readFileSync(new URL(name, dir), "utf8");
  const body = sql.slice(sql.indexOf("create table coldlion.item_image_metadata"), sql.indexOf("primary key (company_code, pkey)"));
  for (const field of ITEM_IMAGES_SPEC.fields) assert.match(body, new RegExp(`\\n\\s+${field.column}\\s`), field.column);
  assert.doesNotMatch(body, /resource_content|thumbnail|bytea/);
});

test("image bytes never survive projection, hashing or the retained payload", () => {
  const { rows } = projectItemImageRows([sourceRow()], { runId: RUN, fetchedAt: NOW, request: REQUEST });
  assert.equal(rows.length, 1);
  const serialized = JSON.stringify(rows[0]);
  assert.doesNotMatch(serialized, /QUJDRA==|RUZHSA==|resourceContent|thumbnail128/);
  const withOtherBytes = projectItemImageRows([sourceRow({ resourceContent: "WFla" })], { runId: RUN, fetchedAt: NOW });
  assert.equal(withOtherBytes.rows[0].source_hash, rows[0].source_hash, "hash is over metadata only");
  assert.deepEqual(Object.keys(stripImageContent(sourceRow())).sort(), ITEM_IMAGES_SPEC.fields.map((f) => f.api).sort());
});

test("rows sharing resourceId and item/colour are distinct records keyed by pkey", () => {
  const { rows } = projectItemImageRows(
    [sourceRow({ pkey: 1, resourceId: 9 }), sourceRow({ pkey: 2, resourceId: 9 })],
    { runId: RUN, fetchedAt: NOW, request: REQUEST },
  );
  assert.equal(rows.length, 2);
});

test("an identical repeat collapses; a conflicting repeat refuses", () => {
  assert.equal(projectItemImageRows([sourceRow(), sourceRow()], { runId: RUN, fetchedAt: NOW }).rows.length, 1);
  assert.throws(() => projectItemImageRows([sourceRow(), sourceRow({ fileName: "other" })], { runId: RUN, fetchedAt: NOW }), /conflicting rows/);
});

test("zero rows is evidence, not an error; malformed shapes refuse", () => {
  assert.deepEqual(projectItemImageRows([], { runId: RUN, fetchedAt: NOW }).rows, []);
  assert.throws(() => projectItemImageRows({ content: [] }), /bare JSON array/);
  assert.throws(() => projectItemImageRows([sourceRow({ surprise: 1 })]), /unreviewed field/);
  const missing = sourceRow(); delete missing.fileType;
  assert.throws(() => projectItemImageRows([missing]), /omitted approved field/);
  assert.throws(() => projectItemImageRows([sourceRow({ pkey: "" })]), /blank key/);
  assert.throws(() => projectItemImageRows([sourceRow({ itemNo: "OTHER" })], { request: REQUEST }), /another item/);
  assert.throws(() => projectItemImageRows([sourceRow({ companyCode: "X" })], { request: REQUEST }), /another company/);
});

test("blank text lands as null and the 1900 empty-date marker lands as null", () => {
  const { rows } = projectItemImageRows([sourceRow({ labelCode: "", modTime: "1900-01-01T00:00:00Z" })], { runId: RUN, fetchedAt: NOW });
  assert.equal(rows[0].label_code, null);
  assert.equal(rows[0].mod_time, null);
});
