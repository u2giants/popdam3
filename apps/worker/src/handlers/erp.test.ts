import test from "node:test";
import assert from "node:assert/strict";
import { validateErpClassification } from "./erp.js";

test("ERP classification accepts a complete valid result", () => {
  assert.deepEqual(validateErpClassification({ category: "Wall", confidence: 0.9, rationale: "Wall-mounted canvas" }), { category: "Wall", confidence: 0.9, rationale: "Wall-mounted canvas" });
});

test("ERP classification rejects unknown categories and invalid fields", () => {
  assert.throws(() => validateErpClassification({ category: "Furniture", confidence: 0.9, rationale: "x" }), /category/);
  assert.throws(() => validateErpClassification({ category: "Wall", confidence: 2, rationale: "x" }), /confidence/);
  assert.throws(() => validateErpClassification({ category: "Wall", confidence: 0.9, rationale: " " }), /rationale/);
});
