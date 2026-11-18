import { describe, expect, it } from "vitest";
import { buildNameIndex, namedCharacterScope, namedSearchPhrases, type NameIndexInput, pickScopeKeys, withNamedScope } from "./named-characters.ts";

const base: NameIndexInput = {
  characters: [
    { id: "c-marie-1", name: "Marie" },
    { id: "c-marie-2", name: "Marie" },
    { id: "c-mickey", name: "Mickey" },
    { id: "c-mickey-mouse", name: "Mickey Mouse" },
    { id: "c-frame", name: "Frame" },
    { id: "c-al", name: "Al" },
    { id: "c-star", name: "Star (C++) [a-z]*" },
    { id: "c-studio", name: "Acme Studios" },
    { id: "c-toons", name: "Looney Toons" },
  ],
  aliases: [
    { characterId: "c-marie-1", alias: "Duchess Kitten" },
    { characterId: "c-mickey", alias: "Mat" },
    { characterId: "c-mickey", alias: "Mo" },
  ],
  legacyCharacters: [{ id: "l-marie", name: "Marie" }],
  properties: [
    { id: "p-cats", name: "Aristocats" },
    { id: "p-toons", name: "Looney Toons" },
    { id: "p-empty", name: "Lonely Show" },
  ],
  propertyCharacters: [
    { propertyId: "p-cats", characterId: "c-marie-1" },
    { propertyId: "p-toons", characterId: "c-mickey" },
  ],
  licensorNames: ["Acme Studios"],
  productWords: ["frame", "mat", "rug"],
};
const index = buildNameIndex(base);

describe("namedSearchPhrases", () => {
  it("keeps the same ASCII word boundaries as the name matcher", () => {
    expect(namedSearchPhrases(["AİB K-café", "ai b", null])).toEqual([
      "ai",
      "ai b",
      "ai b k",
      "ai b k caf",
      "b",
      "b k",
      "b k caf",
      "k",
      "k caf",
      "caf",
    ]);
    expect(namedSearchPhrases([" ? ", null])).toEqual([]);
  });

  it("limits each input to the same initial 500 characters and eight-word phrases", () => {
    const source = Array.from({ length: 250 }, (_, index) => String.fromCharCode(97 + index % 26)).join(" ");
    const keys = namedSearchPhrases([`${source} outsideboundary`, "q a b c d e f g h"]);
    expect(keys).not.toContain("outsideboundary");
    expect(keys).toContain("q a b c d e f g");
    expect(keys).not.toContain("q a b c d e f g h");
    expect(keys.length).toBeLessThanOrEqual(3944);
  });
});

describe("namedCharacterScope (#1037)", () => {
  it("matches a whole name and returns every row with that name", () => {
    expect(namedCharacterScope(["marie frame"], index)).toEqual({
      requiredCharacterNames: ["marie"],
      requiredCharacterIds: ["c-marie-1", "c-marie-2"],
      requiredLegacyCharacterIds: ["l-marie"],
    });
  });

  it("matches a recorded alias", () => {
    expect(namedCharacterScope(["Duchess kitten wall art"], index)).toEqual({
      requiredCharacterNames: ["duchess kitten"],
      requiredCharacterIds: ["c-marie-1"],
    });
  });

  it("does not match a name inside a longer word", () => {
    expect(namedCharacterScope(["mariella frame", "maries"], index)).toEqual({});
  });

  it("returns nothing when no character is named", () => {
    expect(namedCharacterScope(["toy chest", null, undefined, ""], index)).toEqual({});
  });

  it("lets the longest name win when names overlap", () => {
    expect(namedCharacterScope(["mickey mouse rug"], index)).toEqual({
      requiredCharacterNames: ["mickey mouse"],
      requiredCharacterIds: ["c-mickey-mouse"],
    });
  });

  it("resolves a licensor/character collision to the licensor", () => {
    expect(namedCharacterScope(["acme studios rug"], index)).toEqual({});
  });

  it("resolves a property/character collision to the property", () => {
    expect(namedCharacterScope(["looney toons rug"], index)).toEqual({
      semanticPropertyIds: ["p-toons"],
      semanticPropertyCharacterIds: ["c-mickey"],
    });
  });

  it("tells same-named characters apart by a named property", () => {
    expect(namedCharacterScope(["aristocats marie frame"], index)).toEqual({
      requiredCharacterNames: ["marie"],
      requiredCharacterIds: ["c-marie-1"],
      requiredLegacyCharacterIds: ["l-marie"],
    });
  });

  it("skips the property rule when the property has no linked character", () => {
    expect(namedCharacterScope(["lonely show frame"], index)).toEqual({});
  });

  it("ignores names shorter than 3 characters and names equal to a product word", () => {
    expect(namedCharacterScope(["al frame", "mo mat", "frame"], index)).toEqual({});
  });

  it("matches names literally: regex and SQL metacharacters are only separators", () => {
    expect(namedCharacterScope(["star c a z"], index).requiredCharacterIds).toEqual(["c-star"]);
    expect(namedCharacterScope([".* marie' or 1=1 --"], index).requiredCharacterIds).toEqual(["c-marie-1", "c-marie-2"]);
    expect(namedCharacterScope(["s.*r"], index)).toEqual({});
  });

  it("handles an 8,000-character query without scanning all of it", () => {
    const long = "word ".repeat(1600) + "marie";
    const started = performance.now();
    expect(namedCharacterScope([long], index)).toEqual({});
    expect(namedCharacterScope(["marie " + long], index).requiredCharacterNames).toEqual(["marie"]);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("unions the typed words and the spelling correction", () => {
    expect(namedCharacterScope(["mari frame", "marie frame"], index).requiredCharacterNames).toEqual(["marie"]);
  });
});

describe("withNamedScope", () => {
  const scope = namedCharacterScope(["marie frame"], index);
  it("applies character keys to every leg, keyword-only included", () => {
    expect(withNamedScope({ customer: "x" }, scope, false)).toEqual({ customer: "x", ...scope });
  });
  it("applies property keys only when pictures are searched or no explicit property filter", () => {
    const property = namedCharacterScope(["looney toons rug"], index);
    expect(withNamedScope({}, property, false)).toEqual({});
    expect(withNamedScope({ propertyId: "p" }, property, true)).toEqual({ propertyId: "p" });
    expect(withNamedScope({}, property, true)).toEqual(property);
  });
  it("adds nothing for an empty scope", () => {
    expect(withNamedScope({ licensorId: "l" }, {}, true)).toEqual({ licensorId: "l" });
  });
  it("picks only scope keys for the anchor", () => {
    expect(pickScopeKeys({ customer: "x", semanticLicensorIds: ["l"], ...scope })).toEqual({ semanticLicensorIds: ["l"], ...scope });
  });
});
