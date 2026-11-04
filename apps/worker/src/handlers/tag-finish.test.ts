import test from "node:test";
import assert from "node:assert/strict";
import { displayCharacterName, finishTagResult, isKnownDesigner, labelsFromFilename } from "./tag-finish.js";

const tag = (name: string) => ({ tag: name, category: "other", confidence: 0.9, evidence: ["x"] });
const finish = (over: Record<string, unknown> = {}, ids: string[] = [], filename = "a.psd", licensed = true) =>
  finishTagResult({
    tagData: { ai_description: "A wall print.", asset_tags: [tag("blue")], ...over },
    characterIds: ids,
    characterNames: new Map([["a", "Mickey Mouse"], ["b", "Goofy"], ["c", "Pluto"], ["d", "Donald Duck"], ["s", "Spider-Man (Spidey and His Amazing Friends)"]]),
    filename,
    licensed,
  });
const tags = (r: { tagData: Record<string, unknown> }) => (r.tagData.asset_tags as Array<{ tag: string }>).map(t => t.tag);

test("more than three characters keeps the first and says group shot", () => {
  const r = finish({}, ["a", "b", "c", "d"]);
  assert.deepEqual(r.characterIds, ["a"]);
  assert.ok(tags(r).includes("group shot") && tags(r).includes("mickey mouse") && !tags(r).includes("goofy"));
  assert.match(String(r.tagData.ai_description), /Mickey Mouse.*group shot/);
});

test("exactly three characters stay and all are named", () => {
  const r = finish({}, ["a", "b", "c"]);
  assert.equal(r.characterIds.length, 3);
  assert.ok(!tags(r).includes("group shot"));
  assert.match(String(r.tagData.ai_description), /Mickey Mouse, Goofy and Pluto/);
});

test("a name already in the description is not repeated, and qualifiers are stripped", () => {
  const r = finish({ ai_description: "Spider-Man wall print." }, ["s"]);
  assert.equal(r.tagData.ai_description, "Spider-Man wall print.");
  assert.ok(tags(r).includes("spider-man"));
  assert.equal(displayCharacterName("Marvel (Avengers)"), "Marvel");
});

test("sheet labels pair on licensed styles only, in both directions", () => {
  assert.ok(tags(finish({ asset_tags: [tag("costing sheet")] })).includes("licensing sheet"));
  assert.ok(tags(finish({ asset_tags: [tag("licensing sheet")] })).includes("costing sheet"));
  assert.ok(tags(finish({}, [], "X_LICENSING SHEET.pdf")).includes("costing sheet"));
  assert.ok(!tags(finish({ asset_tags: [tag("costing sheet")] }, [], "a.psd", false)).includes("licensing sheet"));
});

test("older wording becomes the owner's words", () => {
  const r = tags(finish({ asset_tags: [tag("professional photography"), tag("straight view"), tag("design asset"), tag("artwork")] }));
  assert.deepEqual(r, ["product photography", "front view", "art"]);
});

test("file names give asset types only for whole words", () => {
  assert.deepEqual(labelsFromFilename("MDD58DYMM01_Close Up.psd"), ["close-up"]);
  assert.deepEqual(labelsFromFilename("VSY62DYNX01_3-4 side.psd"), ["3/4 view"]);
  assert.deepEqual(labelsFromFilename("VSQ14SESO01_FRoom.psd"), []);
  assert.deepEqual(labelsFromFilename("MBZ57DYMM03 mockup.ai"), ["product mockup"]);
  assert.deepEqual(labelsFromFilename("VSB14DYMM02_Art.ai"), ["art"]);
  assert.deepEqual(labelsFromFilename("MFH14SESC02_Holding on.psd"), ["size scale image"]);
  assert.deepEqual(labelsFromFilename("RFF66DYNX01 tech pack.pdf"), ["tech pack"]);
});

test("only clean sheet values become tags", () => {
  const r = finishTagResult({ tagData: { ai_description: "x", asset_tags: [] }, characterIds: [], characterNames: new Map(), filename: null, licensed: false, sheet: { packaging_type: "Polybag", retailer: "©© 4 @#" } });
  assert.deepEqual(tags(r), ["polybag"]);
});

test("known designers only", () => {
  const known = new Set(["derrick"]);
  assert.ok(isKnownDesigner("DERRICK Smith", known));
  assert.ok(!isKnownDesigner("BUYER", known));
  assert.ok(!isKnownDesigner(null, known));
});
