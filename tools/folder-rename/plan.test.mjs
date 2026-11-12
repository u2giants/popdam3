// Run: node --test tools/folder-rename/plan.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { planRenames, mapFile, proposeName, looksLikeSku, tidy } from "./plan.mjs";

const rules = JSON.parse(fs.readFileSync(new URL("./rules.json", import.meta.url), "utf8"));
const R = rules.root;
const CA = `${R}/In Development/Customer Adopted`;

function plan(dirs, opts) {
  return planRenames([R, `${R}/In Development`, CA, ...dirs], rules, opts);
}
const newOf = (res, p) => res.map.get(p);

test("stage abbreviations from D6", () => {
  const res = plan([]);
  assert.equal(newOf(res, CA), `${R}/In Dev/Cust Adopted`);
});

test("customer alias and stripping the customer name from descendants", () => {
  const res = plan([`${CA}/Desperate Signs`, `${CA}/Desperate Signs/Shane Desperate Signs SS24`, `${CA}/Ross`, `${CA}/Ross/2026`, `${CA}/Ross/2026/Ross Wall 2026`]);
  assert.equal(newOf(res, `${CA}/Desperate Signs`), `${R}/In Dev/Cust Adopted/Desperate`);
  assert.equal(newOf(res, `${CA}/Desperate Signs/Shane Desperate Signs SS24`), `${R}/In Dev/Cust Adopted/Desperate/SS24`);
  assert.equal(newOf(res, `${CA}/Ross/2026/Ross Wall 2026`), `${R}/In Dev/Cust Adopted/Ross/2026/Wall`);
});

test("repeated year is stripped only when the rule is on", () => {
  const dirs = [`${CA}/Ross`, `${CA}/Ross/2026`, `${CA}/Ross/2026/Ross Wall 2026`];
  assert.equal(rules.strip_year_under_year_folder.enabled, true);
  assert.equal(newOf(plan(dirs, { stripYear: false }), dirs[2]), `${R}/In Dev/Cust Adopted/Ross/2026/Wall 2026`);
  assert.equal(newOf(plan(dirs, { stripYear: true }), dirs[2]), `${R}/In Dev/Cust Adopted/Ross/2026/Wall`);
});

test("bucket folders and SKU folders keep the customer name", () => {
  assert.ok(looksLikeSku("VSZ24FRFN01"));
  assert.ok(!looksLikeSku("Wall 2026"));
  const res = plan([`${CA}/Ross`, `${CA}/Ross/_Ross bucket`, `${CA}/Ross/MQC24ROSS01`]);
  assert.equal(res.renames.filter((r) => r.old_path.includes("_Ross bucket") || r.old_path.includes("MQC24ROSS01")).length, 0);
});

test("_FINISHED customer folders drop the repeated suffix and strip below", () => {
  const res = plan([`${CA}/_FINISHED`, `${CA}/_FINISHED/Ross_finished`, `${CA}/_FINISHED/Ross_finished/Ross_Wall Refresh_FH22`]);
  assert.equal(newOf(res, `${CA}/_FINISHED/Ross_finished/Ross_Wall Refresh_FH22`), `${R}/In Dev/Cust Adopted/_FINISHED/Ross/Wall Refresh_FH22`);
});

test("name that would become empty is flagged and kept", () => {
  const res = plan([`${CA}/Ross`, `${CA}/Ross/Ross`]);
  assert.equal(newOf(res, `${CA}/Ross/Ross`), `${R}/In Dev/Cust Adopted/Ross/Ross`);
  assert.equal(res.attention[0].kind, "would_be_empty");
});

test("fragment under 3 characters is flagged and kept", () => {
  const res = plan([`${CA}/Ross`, `${CA}/Ross/Ross Q4`]);
  assert.equal(newOf(res, `${CA}/Ross/Ross Q4`), `${CA.replace("In Development/Customer Adopted", "In Dev/Cust Adopted")}/Ross/Ross Q4`);
  assert.equal(res.attention[0].kind, "fragment_under_3");
});

test("collisions are never merged", () => {
  const res = plan([`${CA}/Ross`, `${CA}/Ross/Ross Wall`, `${CA}/Ross/Wall`]);
  assert.equal(newOf(res, `${CA}/Ross/Ross Wall`), `${R}/In Dev/Cust Adopted/Ross/Ross Wall`);
  assert.deepEqual(res.attention.map((a) => a.kind), ["collision"]);
});

test("case-only result is flagged and kept", () => {
  const r2 = { ...rules, phrase_abbreviations: [["wall", "WALL"]] };
  const res = planRenames([R, `${R}/Product Ideas`, `${R}/Product Ideas/wall`], r2);
  assert.equal(res.renames.length, 0);
  assert.equal(res.attention[0].kind, "case_only");
});

test("licensor vault folder keeps number and first three words", () => {
  const p = proposeName("3040881-nightmare-before-christmas-holiday-style-guide", ["Product Ideas", "x"], rules);
  assert.equal(p.name, "3040881-nightmare-before-christmas");
});

test("deep working-folder rules", () => {
  assert.equal(proposeName("_preliminary files", ["Product Ideas"], rules).name, "_prelim");
  assert.equal(proposeName("professional photos", ["Concept Approved Designs"], rules).name, "Pro Photos");
});

test("tidy trims dangling separators", () => {
  assert.equal(tidy("- Shrek"), "Shrek");
  assert.equal(tidy("_Wall Refresh_FH22"), "Wall Refresh_FH22");
});

test("deterministic and idempotent", () => {
  const dirs = [`${CA}/Ross`, `${CA}/Ross/2026`, `${CA}/Ross/2026/Ross Wall 2026`, `${CA}/_FINISHED`, `${CA}/_FINISHED/Ross_finished`, `${CA}/_FINISHED/Ross_finished/Ross_Q1 Q2 Dev_SS24_NEEDS REVISIONS`, `${CA}/_FINISHED/Ross_finished/Ross_Q1 Q2 Dev_SS24_NEEDS REVISIONS/_preliminary files`];
  const a = plan(dirs);
  assert.deepEqual(plan([...dirs].reverse()).renames, a.renames);
  const all = [R, `${R}/In Development`, CA, ...dirs].map((d) => a.map.get(d) ?? d);
  assert.equal(planRenames(all, rules).renames.length, 0);
  assert.equal(planRenames(all, rules, { stripYear: false }).renames.length, 0);
});

test("files follow their folder; file names never change", () => {
  const a = plan([`${CA}/Ross`]);
  assert.equal(mapFile(`${CA}/Ross/My File.psd`, a.map), `${R}/In Dev/Cust Adopted/Ross/My File.psd`);
});

test("customer alias ignores case and punctuation in _FINISHED", () => {
  const r2 = { ...rules, customer_aliases: { HomeGoods: "HGoods" } };
  const res = planRenames([R, `${R}/In Development`, CA, `${CA}/_FINISHED`, `${CA}/_FINISHED/Homegoods_finished`, `${CA}/HomeGoods`], r2);
  assert.equal(res.map.get(`${CA}/_FINISHED/Homegoods_finished`), `${R}/In Dev/Cust Adopted/_FINISHED/HGoods`);
  assert.equal(res.map.get(`${CA}/HomeGoods`), `${R}/In Dev/Cust Adopted/HGoods`);
});
