import test from "node:test";
import assert from "node:assert/strict";
import { GROUP_SHOT_CHARACTER_ID, displayCharacterName, finishTagResult, isJunkTag, isKnownDesigner, isManagerNotTechnicalDesigner, labelsFromFilename } from "./tag-finish.js";

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
  const r2 = finishTagResult({ tagData: { ai_description: "x", asset_tags: [tag("claudia"), tag("әmarvel")] }, characterIds: [], characterNames: new Map(), filename: null, licensed: false, customerNames: ["ross"], designerFirstNames: new Set(["claudia"]), sheet: { packaging_type: "Claudia", retailer: "All Aboard For Sale" } });
  assert.deepEqual(tags(r2), []);
  const r3 = finishTagResult({ tagData: { ai_description: "x", asset_tags: [] }, characterIds: [], characterNames: new Map(), filename: null, licensed: false, customerNames: ["ross"], sheet: { retailer: "Ross FW26" } });
  assert.deepEqual(tags(r3), ["ross"]);
});

test("known designers only", () => {
  const known = new Set(["derrick"]);
  assert.ok(isKnownDesigner("DERRICK Smith", known));
  assert.ok(!isKnownDesigner("BUYER", known));
  assert.ok(!isKnownDesigner(null, known));
});

test("junk tags go, aka names shorten, and a named licensing sheet is not a tech pack", () => {
  const r = finish({ asset_tags: [tag("character id 8ca8"), tag("psd"), tag("tech pack"), tag("blue")] }, [], "X_LICENSING SHEET.pdf");
  assert.deepEqual(tags(r), ["blue", "licensing sheet", "costing sheet"]);
  assert.equal(displayCharacterName("Rick Sanchez aka Rick"), "Rick Sanchez");
  assert.deepEqual(labelsFromFilename("VSZ66DYMM08_ARTWORK.ai"), ["art"]);
});

test("the model cannot call three characters a group shot", () => {
  assert.ok(!tags(finish({ asset_tags: [tag("group shot")] }, ["a", "b", "c"])).includes("group shot"));
});

test("a first name already in the description counts as naming the character", () => {
  const r = finishTagResult({ tagData: { ai_description: "Jack and Sally print.", asset_tags: [] }, characterIds: ["x"], characterNames: new Map([["x", "Sally Doll"]]), filename: null, licensed: false });
  assert.equal(r.tagData.ai_description, "Jack and Sally print.");
  assert.ok(tags(r).includes("sally doll"));
});

test("group shot links as its own character once it exists", () => {
  const base = { tagData: { ai_description: "x", asset_tags: [] }, characterIds: ["a", "b", "c", "d"], characterNames: new Map([["a", "Belle"]]), filename: null, licensed: true };
  assert.deepEqual(finishTagResult({ ...base, groupShotCharacterExists: true }).characterIds, ["a", GROUP_SHOT_CHARACTER_ID]);
  assert.deepEqual(finishTagResult(base).characterIds, ["a"]);
  assert.deepEqual(finishTagResult({ ...base, characterIds: ["a"], groupShotCharacterExists: true }).characterIds, ["a"]);
});

test("sheet boilerplate, slugs and seasons do not become tags; licensing names always do", () => {
  const r = finishTagResult({ tagData: { ai_description: "x", asset_tags: [tag("page 2 of 2"), tag("made in c"), tag("comic-book-cover"), tag("close-up"), tag("burlington ss26")] }, characterIds: [], characterNames: new Map(), filename: null, licensed: true, customerNames: ["burlington"], licensorName: "MARVEL", propertyName: "AVENGERS GROUP" });
  const tags = (r.tagData.asset_tags as Array<{ tag: string }>).map(item => item.tag);
  assert.deepEqual(tags, ["comic book cover", "close-up", "burlington", "marvel", "avengers group"]);
});

test("a named tech pack is not a sheet, and a sheet is not product photography", () => {
  const tp = finishTagResult({ tagData: { ai_description: "x", asset_tags: [tag("licensing sheet"), tag("costing sheet"), tag("product photography")] }, characterIds: [], characterNames: new Map(), filename: "A tech pack.pdf", licensed: true });
  assert.deepEqual((tp.tagData.asset_tags as Array<{ tag: string }>).map(item => item.tag), ["tech pack"]);
});

test("a named character outside the records is still a search tag", () => {
  const r = finish({ character_names: ["Chase", "Group Shot"] });
  const tags = (r.tagData.asset_tags as Array<{ tag: string }>).map(item => item.tag);
  assert.ok(tags.includes("chase") && !tags.includes("group shot"));
});

test("scan debris and form text never become tags", () => {
  for (const junk of ["mdsh7sesc02", "c0010dynx01", "art_piece", "____new structure", "classic_glu_13_cmyk", "pantone 186 c", "pms 267 c", "legal line", "upc sticker", "prop 65 label", "dimensions 24 x 36", "page 2 of 3", "wip version 3", "dollar general fw26", "burlington ss 2026", "dollar general summer 2027", "ey friends and al related character", "character licensed", "pop creations", "albert hazan", "sarbani ghosh"]) {
    assert.ok(isJunkTag(junk), junk);
  }
});

test("real search words survive the junk rule", () => {
  for (const good of ["blue", "spider-man 2099", "r2-d2", "c-3po", "bb-8", "pals4ever", "friday the 13th", "route 66", "95", "16x20", "80s style", "disney 100", "toy story 4", "dimensional", "dimensional art", "peter parker", "marvel's spidey and his amazing friends", "summer", "winter holiday", "class of 2026", "space jam 2", "tech pack", "licensing sheet", "packaging design"]) {
    assert.ok(!isJunkTag(good), good);
  }
});

test("a character sharing a designer's first name keeps its tag", () => {
  const r = finishTagResult({ tagData: { ai_description: "x", asset_tags: [tag("peter pan"), tag("amy rose"), tag("luis"), tag("legal line")] }, characterIds: [], characterNames: new Map(), filename: null, licensed: false, designerFirstNames: new Set(["peter", "amy", "luis"]) });
  assert.deepEqual(tags(r), ["peter pan", "amy rose"]);
});

test("sheet packaging survives even though the same words are blocked from the model", () => {
  const r = finishTagResult({ tagData: { ai_description: "x", asset_tags: [tag("upc sticker")] }, characterIds: [], characterNames: new Map(), filename: null, licensed: false, sheet: { packaging_type: "UPC Sticker" } });
  assert.deepEqual(tags(r), ["upc sticker"]);
});

test("a known name with stray model text is rejected", () => {
  const known = new Set(["luis"]);
  assert.ok(isKnownDesigner("Luis Herrera", known));
  for (const bad of ["LUIS', \"art_source\": null}", "LUIS (UPDATED BY DANILO MAR12)", "LUIS_x", "LUIS provides more color to your hair while adding body and volume"]) assert.ok(!isKnownDesigner(bad, known), bad);
});

test("the manager is not saved as technical designer", () => {
  for (const manager of ["Albert Hazan", "ALBERT", "albert hazan "]) assert.ok(isManagerNotTechnicalDesigner(manager), manager);
  for (const designer of ["Zarit Calderon", "Alberta Smith", "Danilo"]) assert.ok(!isManagerNotTechnicalDesigner(designer), designer);
});
