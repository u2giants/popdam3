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
export const SPELLING_LOOKUP_CONCURRENCY = 4;
export const SPELLING_MAX_WORDS = 16;
export const SPELLING_BUDGET_MS = 1500;
const MIN_CORRECTABLE_LENGTH = 5;

export interface SpellingLookup {
  /** Documents holding this exact word, up to RARE_WORD_DOCS. */
  countDocs(word: string, signal?: AbortSignal): Promise<number>;
  /** Known names as word -> weight; a heavier word wins a tie. */
  vocabulary(signal?: AbortSignal): Promise<Map<string, number>>;
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
    if (
      distance < bestDistance ||
      (distance === bestDistance && distance <= max && (weight > bestWeight || (weight === bestWeight && (best === null || candidate < best))))
    ) {
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
  const unique = [...new Set(words.map((word) => word.toLowerCase()))];
  // Help is optional: oversized queries are searched IN FULL as typed. Do not
  // truncate the query or infer meaningfulness from a partial word sample.
  if (unique.length > SPELLING_MAX_WORDS) return { corrected: null, meaningful: true };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("Spelling budget exceeded"));
    }, SPELLING_BUDGET_MS);
  });
  try {
    // The vocabulary decides meaning and correction for known words, so their
    // corpus counts are never consulted. Counting them anyway cost 0.5-2.3 s
    // per broad name search ("disney", "marvel": frequent lexemes in
    // dam_search_keys), on the critical path before the query embedding.
    const vocabulary = await Promise.race([lookup.vocabulary(controller.signal), deadline]);
    const counts = new Map<string, number>();
    const needsCount = unique.filter((word) => !vocabulary.has(word));
    for (const word of unique) {
      if (!/^[\p{L}\p{N}]+$/u.test(word)) counts.set(word, RARE_WORD_DOCS);
    }
    let next = 0;
    const countWorker = async () => {
      while (next < needsCount.length) {
        if (controller.signal.aborted) throw new Error("Spelling budget exceeded");
        const word = needsCount[next++];
        counts.set(word, await lookup.countDocs(word, controller.signal));
      }
    };
    await Promise.race([
      Promise.all(Array.from({ length: Math.min(needsCount.length, SPELLING_LOOKUP_CONCURRENCY) }, countWorker)),
      deadline,
    ]);
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
  } finally {
    clearTimeout(timer!);
    controller.abort();
  }
}
