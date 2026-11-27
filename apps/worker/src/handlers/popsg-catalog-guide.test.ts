import test from "node:test";
import assert from "node:assert/strict";
import { folderScore, normName, resolvePopSGGuide, type PopSGCatalog } from "./popsg-catalog-guide.js";

const ch = (id: string, name: string) => ({ id, name });
const many = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ch(`${prefix}${i}`, `${prefix} Person ${i}`));
const catalog = (): PopSGCatalog => ({
  licensorMap: { "studio a": ["L1"], "studio b": ["L2"], "big studio": ["L3"], "empty": [] },
  licensors: new Map([["L1", "Studio A Inc"], ["L2", "Studio B"], ["L3", "Big Studio"]]),
  properties: [
    { id: "P1", licensor_id: "L1", name: "Sky Rangers", names: ["Sky Rangers"] },
    { id: "P2", licensor_id: "L1", name: "Sky Rangers & Friends (Classic)", names: ["Sky Rangers & Friends (Classic)"] },
    { id: "P3", licensor_id: "L1", name: "Moon Pals: Animated Series", names: ["Moon Pals: Animated Series", "MP"] },
    { id: "P4", licensor_id: "L2", name: "Sky Rangers", names: ["Sky Rangers"] },
    { id: "P5", licensor_id: "L3", name: "Huge Show", names: ["Huge Show"] },
  ],
  propertyCharacters: new Map([["P1", [ch("c1", "Captain Sky")]], ["P2", [ch("c2", "Pal Bot")]], ["P3", [ch("c3", "Moony"), ch("c4", "Moony Logo")]],
    ["P4", [ch("c9", "Wrong Licensor Guy")]], ["P5", many(401, "h")]]),
  licensorCharacters: new Map([["L1", [ch("c1", "Captain Sky"), ch("c2", "Pal Bot"), ch("c3", "Moony")]], ["L3", many(500, "x")]]),
});
const f = (licensor_name: string, property_folder: string | null, style_guide_folder: string | null = null) => ({ licensor_name, property_folder, style_guide_folder });

test("normalizes ampersands, brackets and a leading article", () => {
  assert.equal(normName("The Sky Rangers & Friends (Classic)"), "sky rangers and friends");
  assert.equal(folderScore("Sky Rangers", "Sky Rangers"), 2);
  assert.equal(folderScore("Moon Pals", "Moon Pals: Animated Series"), 1);
  assert.equal(folderScore("2018", "Anything (2018)"), 0);
});

test("exact property match wins over a containing name", () => {
  const g = resolvePopSGGuide(f("Studio A", "Sky Rangers"), catalog());
  assert.deepEqual(g.propertyIds, ["P1"]);
  assert.deepEqual(g.characters.map(c => c.id), ["c1"]);
  assert.ok(g.allowedNames.has("sky rangers") && g.allowedNames.has("captain sky"));
});

test("matches only properties of the mapped licensor", () => {
  const g = resolvePopSGGuide(f("STUDIO B", "Sky Rangers"), catalog());
  assert.deepEqual(g.propertyIds, ["P4"]);
  assert.ok(!g.characters.some(c => c.id === "c1"));
});

test("containment match and logo labels are never characters", () => {
  const g = resolvePopSGGuide(f("Studio A", "Moon Pals"), catalog());
  assert.deepEqual(g.propertyIds, ["P3"]);
  assert.deepEqual(g.characters.map(c => c.name), ["Moony"]);
});

test("style-guide folder is tried before the property folder", () => {
  const g = resolvePopSGGuide(f("Studio A", "_HOLIDAY", "Moon Pals"), catalog());
  assert.deepEqual(g.propertyIds, ["P3"]);
});

test("generic folder falls back to a small licensor list", () => {
  const g = resolvePopSGGuide(f("Studio A", "_HOLIDAY"), catalog());
  assert.deepEqual(g.propertyIds, []);
  assert.equal(g.characters.length, 3);
});

test("too many characters gives none", () => {
  assert.equal(resolvePopSGGuide(f("Big Studio", "Misc"), catalog()).characters.length, 0);
  assert.equal(resolvePopSGGuide(f("Big Studio", "Huge Show"), catalog()).characters.length, 0);
});

test("a folder named after the licensor matches no property", () => {
  const g = resolvePopSGGuide(f("Studio A", "Studio A Packaging"), catalog());
  assert.deepEqual(g.propertyIds, []);
});

test("unmapped licensor folder gets no candidates", () => {
  for (const name of ["Unknown", "empty"]) {
    const g = resolvePopSGGuide(f(name, "Sky Rangers"), catalog());
    assert.equal(g.characters.length, 0); assert.equal(g.allowedNames.size, 0);
  }
});
