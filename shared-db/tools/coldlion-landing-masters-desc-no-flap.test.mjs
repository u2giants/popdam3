// #5758: ColdLion /items intermittently omits merch-group descriptions on the
// same full-snapshot request. A description going blank (or coming back) must
// not change any hash or log a change; a real code or field change still must.
import test from "node:test";
import assert from "node:assert/strict";
import { ITEM_SPECS } from "./coldlion-landing/lib/master-specs.mjs";
import { projectCurrentRows, projectItemSlots } from "./coldlion-landing/lib/project-masters.mjs";
import { buildMasterLoadSql } from "./coldlion-landing/lib/load-masters.mjs";

const RUN = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-11-05T00:00:00.000Z";

function source(spec, overrides = {}) {
  const row = {};
  for (const field of spec.fields) row[field.api] = field.type === "num" ? "1" : field.type === "date" ? "2026-01-02" : field.type === "ts" ? "2026-01-02T03:04:05Z" : `SYN-${field.api}`;
  for (const ignored of spec.ignored ?? []) row[ignored] = null;
  for (let n = 1; n <= 14; n += 1) { const nn = String(n).padStart(2, "0"); row[`merchGroup${nn}`] = n <= 2 ? `MG${n}` : null; row[`merchGroup${nn}Desc`] = n <= 2 ? `Label ${n}` : null; }
  return { ...row, ...overrides };
}

for (const name of ["item_header", "item_detail"]) {
  const spec = ITEM_SPECS[name];
  test(`${name}: description-only flap keeps the same row hash`, () => {
    const a = projectCurrentRows(spec, [source(spec)], { runId: RUN, fetchedAt: NOW }).rows[0];
    const b = projectCurrentRows(spec, [source(spec, { merchGroup01Desc: null, merchGroup02Desc: "" })], { runId: RUN, fetchedAt: NOW }).rows[0];
    assert.equal(a.source_hash, b.source_hash);
    assert.equal(b.source_raw.merchGroup02Desc, "", "the complete payload is still retained");
  });
  test(`${name}: a real code change changes the row hash`, () => {
    const a = projectCurrentRows(spec, [source(spec)], { runId: RUN, fetchedAt: NOW }).rows[0];
    const b = projectCurrentRows(spec, [source(spec, { merchGroup01: "MGX" })], { runId: RUN, fetchedAt: NOW }).rows[0];
    assert.notEqual(a.source_hash, b.source_hash);
  });
}

test("slot rows keep the description column but hash the code only", () => {
  const spec = ITEM_SPECS.item_header;
  const [a] = projectItemSlots([source(spec)], { runId: RUN, fetchedAt: NOW });
  const [b] = projectItemSlots([source(spec, { merchGroup01Desc: null })], { runId: RUN, fetchedAt: NOW });
  const [c] = projectItemSlots([source(spec, { merchGroup01: "MGX" })], { runId: RUN, fetchedAt: NOW });
  assert.equal(a.mg_desc, "Label 1");
  assert.equal(b.mg_desc, null);
  assert.equal(a.source_hash, b.source_hash);
  assert.notEqual(a.source_hash, c.source_hash);
});

test("loader logs slot history on code change only and never blanks a known label", () => {
  const sql = buildMasterLoadSql({ loads: [], itemSlots: [], affectedItemGrains: [] });
  assert.match(sql, /where t\.company_code is null or t\.mg_code is distinct from s\.mg_code;/);
  assert.match(sql, /mg_desc=coalesce\(excluded\.mg_desc, coldlion\.item_merch_group\.mg_desc\)/);
});

test("header change predicate ignores the hash-policy change and description-only differences", () => {
  const spec = ITEM_SPECS.item_header;
  const rows = projectCurrentRows(spec, [source(spec)], { runId: RUN, fetchedAt: NOW }).rows;
  const sql = buildMasterLoadSql({ loads: [{ table: "item_header", spec, rows, run: { id: RUN, endpoint: "/items", companyCode: "SYN", requestParams: {}, requestedBy: "test", startedAt: NOW, finishedAt: NOW } }], itemSlots: [], affectedItemGrains: [] });
  const predicate = "t.source_hash <> s.source_hash and (prior.new_raw is null or (prior.new_raw - array['merchGroup01Desc'";
  assert.ok(sql.includes(predicate), "change_log and counts use the payload comparison");
  assert.equal(sql.split(predicate).length - 1, 3, "updated count, unchanged count, and change_log insert");
});
