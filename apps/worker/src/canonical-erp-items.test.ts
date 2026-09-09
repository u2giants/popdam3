import test from "node:test";
import assert from "node:assert/strict";
import { canonicalItemKey, canonicalItemMatchKey, rawMgFieldsFromCanonical } from "./canonical-erp-items.js";

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
