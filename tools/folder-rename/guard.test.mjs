// Run: node --test tools/folder-rename/guard.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { folderGuard } from "../../supabase/functions/_shared/folder-rules/guard.mjs";

const rules = JSON.parse(fs.readFileSync(new URL("./rules.json", import.meta.url), "utf8"));
const R = rules.root;

test("edge-function rules copy matches the frozen rules", () => {
  const copy = JSON.parse(fs.readFileSync(new URL("../../supabase/functions/_shared/folder-rules/rules.json", import.meta.url), "utf8"));
  assert.deepEqual(copy, rules);
});

test("flags un-aliased customer folder and over-length files with suggestion", () => {
  const long = "x".repeat(220);
  const r = folderGuard([`${R}/In Development/Customer Adopted/Dollar General/Prog/${long}.ai`, `${R}/In Dev/a.ai`], rules);
  assert.ok(r.rule_breaking.some((x) => x.old_path.endsWith("/Dollar General") && x.new_path.endsWith("/Dollar_General")));
  assert.equal(r.over_length_total, 1);
  assert.match(r.over_length[0].suggested_path, /Cust Adopted\/Dollar_General/);
  assert.ok(r.over_length[0].longest_after_rules < r.over_length[0].longest);
});

test("clean tree reports nothing", () => {
  const r = folderGuard([`${R}/In Dev/Cust Adopted/Aldi/Spring/a.ai`, "Other/x.ai"], rules);
  assert.equal(r.files_checked, 1);
  assert.equal(r.rule_breaking_total, 0);
  assert.equal(r.over_length_total, 0);
});
