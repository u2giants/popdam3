import { describe, expect, it, vi } from "vitest";
import {
  addNameToVocabulary,
  checkSpelling,
  editDistance,
  nearestWord,
  SPELLING_BUDGET_MS,
  SPELLING_LOOKUP_CONCURRENCY,
  SPELLING_MAX_WORDS,
  type SpellingLookup,
} from "./search-spelling";

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
  it("skips corpus counts for words the vocabulary already knows", async () => {
    const started: string[] = [];
    const releases = new Map<string, (value: number) => void>();
    let resolveVocabulary!: (value: Map<string, number>) => void;
    const result = checkSpelling("Captian America Captian", {
      vocabulary: () =>
        new Promise((resolve) => {
          started.push("vocabulary");
          resolveVocabulary = resolve;
        }),
      countDocs: (word) =>
        new Promise((resolve) => {
          started.push(word);
          releases.set(word, resolve);
        }),
    });
    // Vocabulary decides first: "america" is a known name word and needs no count.
    expect(started).toEqual(["vocabulary"]);
    resolveVocabulary(vocabulary);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(["vocabulary", "captian"]);
    releases.get("captian")!(0);
    expect(await result).toEqual({ corrected: "captain America captain", meaningful: true });
  });

  it("bounds concurrent word reads and preserves the complete query", async () => {
    let active = 0;
    let peak = 0;
    let total = 0;
    const query = Array.from({ length: 12 }, (_, i) => `word${i}`).join(" ");
    const result = await checkSpelling(query, {
      vocabulary: async () => new Map(),
      countDocs: async () => {
        total++;
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 1));
        active--;
        return 3;
      },
    });
    expect(total).toBe(12);
    expect(peak).toBe(SPELLING_LOOKUP_CONCURRENCY);
    expect(result).toEqual({ corrected: null, meaningful: true });
  });

  it("skips all optional spelling work for oversized input rather than sampling words", async () => {
    const countDocs = vi.fn();
    const vocabulary = vi.fn();
    const query = Array.from({ length: SPELLING_MAX_WORDS + 1000 }, (_, i) => `word${i}`).join(" ");
    expect(await checkSpelling(query, { countDocs, vocabulary })).toEqual({ corrected: null, meaningful: true });
    expect(countDocs).not.toHaveBeenCalled();
    expect(vocabulary).not.toHaveBeenCalled();
  });

  it("ends at the total deadline, cancels outstanding reads and never starts queued reads", async () => {
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const countDocs = vi.fn((_word: string, signal?: AbortSignal) => {
        signals.push(signal!);
        return new Promise<number>(() => {}); // Even a transport that ignores cancellation cannot block the request.
      });
      const result = checkSpelling("one two three four five six seven eight", {
        vocabulary: async () => new Map(),
        countDocs,
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(countDocs).toHaveBeenCalledTimes(SPELLING_LOOKUP_CONCURRENCY);
      await vi.advanceTimersByTimeAsync(SPELLING_BUDGET_MS);
      expect(await result).toEqual({ corrected: null, meaningful: true });
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(countDocs).toHaveBeenCalledTimes(SPELLING_LOOKUP_CONCURRENCY);
    } finally {
      vi.useRealTimers();
    }
  });

  it("breaks equal-authority spelling ties deterministically", () => {
    expect(nearestWord("starn", new Map([["start", 1], ["stark", 1]]))).toBe("stark");
    expect(nearestWord("starn", new Map([["stark", 1], ["start", 1]]))).toBe("stark");
  });
});
