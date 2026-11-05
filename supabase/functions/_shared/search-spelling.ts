/**
 * Spelling help for typed searches, from what the catalog actually contains.
 *
 * Keyword search needs exact words, so "captian america" found nothing by words and
 * only picture lookalikes. Gibberish had the same problem in reverse: its picture leg
 * has no floor to fall below, so "xqzvplm" returned 2,000 lookalikes. A word is judged
 * against the corpus and the licensor, property and character names; no format rules.
 *
 * Browser and Deno shared code: keep this dependency-free.
 */

/** Words so rare in the corpus they are probably typos themselves. */
export const RARE_WORD_DOCS = 3;
const MIN_CORRECTABLE_LENGTH = 5;

export interface SpellingLookup {
  /** Documents holding this exact word, up to RARE_WORD_DOCS. */
  countDocs(word: string): Promise<number>;
  /** Known names as word -> weight; a heavier word wins a tie. */
  vocabulary(): Promise<Map<string, number>>;
}

export interface SpellingResult {
  /** The query with typos replaced, when any were found. */
  corrected: string | null;
  /** False when no word is in the catalog or near a known name: skip the picture leg. */
  meaningful: boolean;
}

/** Edit distance counting a swap of neighbouring letters as one edit. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, prev2[j - 2] + 1);
      }
      row.push(value);
    }
    prev2 = prev;
    prev = row;
  }
  return prev[b.length];
}

const allowedEdits = (word: string) => (word.length >= 8 ? 2 : 1);

/** Closest known word within the allowed edits, or null. */
export function nearestWord(word: string, vocabulary: Map<string, number>): string | null {
  if (word.length < MIN_CORRECTABLE_LENGTH || !/^[a-z]+$/.test(word)) return null;
  const max = allowedEdits(word);
  let best: string | null = null;
  let bestDistance = max + 1;
  let bestWeight = -1;
  for (const [candidate, weight] of vocabulary) {
    if (candidate === word) continue;
    const distance = editDistance(word, candidate, max);
    if (distance < bestDistance || (distance === bestDistance && distance <= max && weight > bestWeight)) {
      best = candidate;
      bestDistance = distance;
      bestWeight = weight;
    }
  }
  return bestDistance <= max ? best : null;
}

/** Add one name's words, and its two-word forms joined, to the vocabulary. */
export function addNameToVocabulary(vocabulary: Map<string, number>, name: string, weight: number): void {
  const words = name
    .replace(/\(.*?\)/g, " ")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 2);
  const add = (word: string) => {
    if (word.length >= 4) vocabulary.set(word, Math.max(vocabulary.get(word) ?? 0, weight));
  };
  words.forEach(add);
  words.slice(1).forEach((word, index) => add(words[index] + word));
}

/** Fails open: a lookup error must never change results, only skip this help. */
export async function checkSpelling(query: string, lookup: SpellingLookup): Promise<SpellingResult> {
  const original = query.trim().replace(/\s+/g, " ");
  const words = original.split(" ");
  try {
    const [vocabulary, countPairs] = await Promise.all([lookup.vocabulary(), Promise.all([...new Set(words.map((word) => word.toLowerCase()))].map(async (word) => [
      word, /^[\p{L}\p{N}]+$/u.test(word) ? await lookup.countDocs(word) : RARE_WORD_DOCS,
    ] as const)),
    ]);
    const counts = new Map(countPairs);
    let meaningful = false;
    let changed = false;
    const out: string[] = [];
    for (const raw of words) {
      const word = raw.toLowerCase();
      const docs = counts.get(word) ?? 0;
      if (docs >= RARE_WORD_DOCS || vocabulary.has(word)) {
        meaningful = true;
        out.push(raw);
        continue;
      }
      const near = nearestWord(word, vocabulary);
      if (near) {
        meaningful = true;
        changed = true;
        out.push(near);
        continue;
      }
      if (docs > 0) meaningful = true;
      out.push(raw);
    }
    return { corrected: changed ? out.join(" ") : null, meaningful };
  } catch (error) {
    console.error("spelling check failed; searching as typed", error instanceof Error ? error.message : error);
    return { corrected: null, meaningful: true };
  }
}
