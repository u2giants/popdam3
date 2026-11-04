import { describe, expect, it } from "vitest";
import { addNameToVocabulary, checkSpelling, editDistance, nearestWord, type SpellingLookup } from "./search-spelling";

const vocabulary = new Map<string, number>();
for (const name of ["Spider Man", "Captain America", "Darth Vader", "Mandalorian ( Star Wars )", "Canvas", "Hamper"]) {
  addNameToVocabulary(vocabulary, name, 1);
}

const lookup = (docs: Record<string, number>): SpellingLookup => ({
  countDocs: async (word) => docs[word] ?? 0,
  vocabulary: async () => vocabulary,
});

describe("search spelling", () => {
  it("counts a swap of neighbouring letters as one edit", () => {
    expect(editDistance("captian", "captain", 2)).toBe(1);
  });

  it("corrects common typos and plurals to known names", () => {
    expect(nearestWord("captian", vocabulary)).toBe("captain");
    expect(nearestWord("mandalorin", vocabulary)).toBe("mandalorian");
    expect(nearestWord("spidermen", vocabulary)).toBe("spiderman");
    expect(nearestWord("canvases", vocabulary)).toBe("canvas");
  });

  it("does not touch short or far-away words", () => {
    expect(nearestWord("poo", vocabulary)).toBeNull();
    expect(nearestWord("xqzvplm", vocabulary)).toBeNull();
  });

  it("leaves common catalog words alone", async () => {
    const result = await checkSpelling("spider hamper", lookup({ spider: 3, hamper: 3 }));
    expect(result).toEqual({ corrected: null, meaningful: true });
  });

  it("corrects a word that is missing or only a rare typo in the catalog", async () => {
    expect(await checkSpelling("Captian America", lookup({ america: 3, captian: 1 }))).toEqual({
      corrected: "captain America",
      meaningful: true,
    });
  });

  it("calls gibberish meaningless so the picture leg is skipped", async () => {
    expect(await checkSpelling("xqzvplm", lookup({}))).toEqual({ corrected: null, meaningful: false });
  });

  it("keeps a real picture idea whose words exist", async () => {
    expect((await checkSpelling("sunset", lookup({ sunset: 3 }))).meaningful).toBe(true);
  });

  it("fails open when the lookup breaks", async () => {
    const broken: SpellingLookup = {
      countDocs: async () => {
        throw new Error("down");
      },
      vocabulary: async () => vocabulary,
    };
    expect(await checkSpelling("xqzvplm", broken)).toEqual({ corrected: null, meaningful: true });
  });
});
