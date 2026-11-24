import test from "node:test";
import assert from "node:assert/strict";
import { planSteps, forwardMap, rewriteSql } from "./execute.mjs";

const R = "Decor/X/In Development/Customer Adopted";
const rows = [
  { old_path: `${R}/Desperate Signs`, new_path: "Decor/X/In Dev/Cust Adopted/Desperate", rule: "customer_alias" },
  { old_path: `${R}/Desperate Signs/Shane Desperate Signs SS24`, new_path: "Decor/X/In Dev/Cust Adopted/Desperate/SS24", rule: "strip_customer" },
];

test("renames in place, deepest first, keeping the current parent", () => {
  const s = planSteps(rows);
  assert.deepEqual(s.map((x) => [x.from, x.to]), [
    [`${R}/Desperate Signs/Shane Desperate Signs SS24`, `${R}/Desperate Signs/SS24`],
    [`${R}/Desperate Signs`, `${R}/Desperate`],
  ]);
});

test("forwardMap follows renames in the order they happened", () => {
  const s = planSteps(rows).map((x) => ({ old_path: x.from, new_path: x.to }));
  assert.equal(forwardMap(`${R}/Desperate Signs/Shane Desperate Signs SS24/a.ai`, s), `${R}/Desperate/SS24/a.ai`);
  assert.equal(forwardMap(`${R}/Desperate Signs Other`, s), `${R}/Desperate Signs Other`);
});

test("a later batch uses where the parent is now", () => {
  const log = [{ old_path: `${R}/Desperate Signs`, new_path: `${R}/Desperate` }];
  const s = planSteps([rows[1]], (p) => forwardMap(p, log));
  assert.equal(s[0].from, `${R}/Desperate/Shane Desperate Signs SS24`);
});

test("path rewrite uses literal prefixes, never LIKE, and quotes names", () => {
  const sql = rewriteSql("a/____New/O'Brien", "a/____New/OB");
  assert.ok(!/ like /i.test(sql));
  assert.ok(sql.includes("'a/____New/O''Brien/'"));
});
