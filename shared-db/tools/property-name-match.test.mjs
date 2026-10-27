import test from "node:test";
import assert from "node:assert/strict";
import { propertyNameKey, matchPropertyNames } from "./property-name-match.mjs";

const same = (a, b) => assert.equal(propertyNameKey(a), propertyNameKey(b), `${a} ~ ${b}`);
const differ = (a, b) => assert.notEqual(propertyNameKey(a), propertyNameKey(b), `${a} !~ ${b}`);

test("dash style and spacing are ignored", () => {
  same("Ghost – Literary", "Ghost  - Literary");
  same("A—B", "A - B");
});

test("quote and apostrophe style are ignored", () => {
  same("Where’s Wally - Literary’", "Where's Wally  - Literary");
});

test("case, accents and ampersand are ignored", () => {
  same("Wallace & Gromit", "WALLACE AND GROMIT");
  same("Pokémon", "POKEMON");
});

test("trailing article is moved and leading article dropped", () => {
  same("Lost Boys, The (1987)", "The Lost Boys (1987)");
  same("Batman, The", "Batman");
});

test("different words or years still differ", () => {
  differ("The Lost Boys", "Lost Boys, The (1987)");
  differ("Supergirl Theatrical 2026", "Supergirl (2026)");
  differ("Frozen", "Frozen II");
  differ("Cars", "Cars 2");
});

test("matchPropertyNames splits exact, loose and unmatched", () => {
  const r = matchPropertyNames(
    [{ name: "Coco" }, { name: "COCO" }, { name: "Up!" }, { name: "" }, { name: "Nope" }],
    ["Coco", "Up"],
  );
  assert.deepEqual(r.exact.map((x) => x.name), ["Coco"]);
  assert.deepEqual(r.loose.map((x) => x.name), ["COCO", "Up!"]);
  assert.deepEqual(r.unmatched.map((x) => x.name), ["", "Nope"]);
});
