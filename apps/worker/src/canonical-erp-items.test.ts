import test from "node:test";
import assert from "node:assert/strict";
import { canonicalItemKey, canonicalItemMatchKey, rawMgFieldsFromCanonical, resolvedErpItems, selectClassificationCandidates, uniqueCanonicalItemIds } from "./canonical-erp-items.js";

test("unresolved or ambiguous identities never reach AI classification", () => {
  const rows = [
    { source_system: "coldlion", division_code: "CW001", source_id: "AMBIG", style_number: "AMBIG" },
    { source_system: "coldlion", division_code: "CW001", source_id: "DONE", style_number: "DONE" },
    { source_system: "coldlion", division_code: "CW001", source_id: "OK1", style_number: "OK1" },
    { source_system: "coldlion", division_code: "CW001", source_id: "OK2", style_number: "OK2" },
  ];
  const selected = selectClassificationCandidates(rows, {
    matchedSkuSet: new Set(rows.map((r) => canonicalItemMatchKey(r.style_number, r.division_code))),
    canonicalIds: uniqueCanonicalItemIds([
      { id: "x", source_system: "coldlion", item_number: "AMBIG", raw: { divisionCode: "CW001" } },
      { id: "y", source_system: "coldlion", item_number: "AMBIG", raw: { divisionCode: "CW001" } },
      { id: "done", source_system: "coldlion", item_number: "DONE", raw: { divisionCode: "CW001" } },
      { id: "ok1", source_system: "coldlion", item_number: "OK1", raw: { divisionCode: "CW001" } },
      { id: "ok2", source_system: "coldlion", item_number: "OK2", raw: { divisionCode: "CW001" } },
    ]),
    terminalPredictionIds: new Set(["done"]),
    limit: 1,
  });
  assert.deepEqual(selected.map((r) => r.source_id), ["OK1"]);
});

test("ambiguous same-division identities stay unresolved instead of borrowing another company's item", () => {
  const ids = uniqueCanonicalItemIds([
    { id: "a", source_system: "coldlion", item_number: "ABC123", raw: { divisionCode: "CW001" } },
    { id: "b", source_system: "coldlion", item_number: "ABC123", raw: { divisionCode: "CW001" } },
    { id: "c", source_system: "coldlion", item_number: "ABC123", raw: { divisionCode: "CW001" } },
    { id: "d", source_system: "coldlion", item_number: "ABC123", raw: { divisionCode: "SP001" } },
  ]);
  assert.equal(ids.has("coldlion|CW001|ABC123"), false);
  assert.equal(ids.get("coldlion|SP001|ABC123"), "d");
});

test("ERP apply skips ambiguous same-division duplicates so neither overwrites the SKU", () => {
  const rows = [
    { source_system: "coldlion", division_code: "CW001", source_id: "DUP", item_description: "Company A wall art" },
    { source_system: "coldlion", division_code: "CW001", source_id: "DUP", item_description: "Company B mug" },
    { source_system: "coldlion", division_code: "CW001", source_id: "ONE", item_description: "Unique item" },
  ];
  const canonicalIds = uniqueCanonicalItemIds([
    { id: "a", source_system: "coldlion", item_number: "DUP", raw: { divisionCode: "CW001" } },
    { id: "b", source_system: "coldlion", item_number: "DUP", raw: { divisionCode: "CW001" } },
    { id: "one", source_system: "coldlion", item_number: "ONE", raw: { divisionCode: "CW001" } },
  ]);
  assert.deepEqual(resolvedErpItems(rows, canonicalIds).map((r) => r.source_id), ["ONE"]);
});

test("canonical item identity includes the division", () => {
  assert.equal(canonicalItemKey({ source_system: "coldlion", division_code: "CW001", source_id: "ABC123" }), "coldlion|CW001|ABC123");
  assert.notEqual(canonicalItemMatchKey("ABC123", "CW001"), canonicalItemMatchKey("ABC123", "SP001"));
});

test("canonical MG columns retain classification context", () => {
  assert.deepEqual(
    rawMgFieldsFromCanonical({ mg_category: "Wall", mg01_code: "A", mg02_code: "B", mg03_code: "1", mg05_code: "DY" }),
    { mg_category: "Wall", mg01: "A", mg01_code: "A", mg02: "B", mg02_code: "B", mg03: "1", mg03_code: "1", mg05: "DY" },
  );
});
