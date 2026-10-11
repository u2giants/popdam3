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

import { applyErpKeysetPage, erpKeysetAfter } from "./erp.js";

class FakeQuery {
  constructor(public rows: Array<{ id: string }>, public calls: string[] = [], private after: string | null = null, private max = Infinity) {}
  order(column: string, options: { ascending: boolean }) { this.calls.push(`order:${column}:${options.ascending}`); return this; }
  gt(column: string, value: string) { this.calls.push(`gt:${column}:${value}`); this.after = value; return this; }
  limit(count: number) { this.calls.push(`limit:${count}`); this.max = count; return this; }
  result() { return [...this.rows].sort((a, b) => a.id.localeCompare(b.id)).filter((r) => this.after === null || r.id > this.after).slice(0, this.max); }
}

test("ERP keyset cursor ignores legacy numeric offsets", () => {
  assert.equal(erpKeysetAfter(undefined), null);
  assert.equal(erpKeysetAfter(300), null);
  assert.equal(erpKeysetAfter(""), null);
  assert.equal(erpKeysetAfter("abc"), "abc");
});

test("ERP keyset paging orders by unique id and resumes strictly after the cursor", () => {
  assert.deepEqual(applyErpKeysetPage(new FakeQuery([]), null, 100).calls, ["order:id:true", "limit:100"]);
  assert.deepEqual(applyErpKeysetPage(new FakeQuery([]), "id-5", 100).calls, ["order:id:true", "gt:id:id-5", "limit:100"]);
});

test("ERP keyset paging neither skips nor repeats rows when rows are inserted mid-run", () => {
  const rows = ["b", "d", "f", "h", "j"].map((id) => ({ id }));
  const seen: string[] = [];
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const batch = applyErpKeysetPage(new FakeQuery(rows), after, 2).result();
    if (batch.length === 0) break;
    seen.push(...batch.map((r) => r.id));
    after = batch[batch.length - 1].id;
    if (page === 0) rows.push({ id: "a" }, { id: "e" });
  }
  assert.deepEqual(seen, ["b", "d", "e", "f", "h", "j"]);
});
