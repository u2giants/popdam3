/**
 * Query-embedding orchestration for dam-search-ai.
 *
 * The SigLIP2 service (apps/text-embed) runs one CPU forward pass per request
 * and concurrent requests queue behind each other (measured 2026-11-08, #804:
 * a solo call p50 570 ms / p95 1383 ms; two concurrent calls answered ~2.9 s
 * each). Search used to fan the query's product-phrase variants out as one
 * HTTP call each, serialising them on the service and paying 1–3 s of tail.
 * Batched into ONE request they share a single forward pass and a single
 * latency draw. Embeddings are deterministic, so a bounded per-isolate cache
 * also serves repeated searches and the eval harness's warm-up pass for free.
 */
export type BatchEmbedOutcome =
  | { status: "ok"; vectors: number[][] }
  | { status: "absent" }
  | { status: "failed" };

export interface QueryEmbedTransport {
  /** One batched round trip. "absent" = service predates the batch endpoint. */
  embedBatch(texts: string[]): Promise<BatchEmbedOutcome>;
  /** Single-text round trip with its own retry (pre-batch behavior). */
  embedOne(text: string): Promise<number[] | null>;
}

export interface QueryEmbedder {
  embed(text: string): Promise<number[] | null>;
  embedAll(texts: string[]): Promise<Map<string, number[] | null>>;
}

const MAX_CACHE_ENTRIES = 256;

export function createQueryEmbedder(transport: QueryEmbedTransport): QueryEmbedder {
  // Map preserves insertion order: oldest entry is the first key; a read
  // refreshes recency so the eviction is LRU, not FIFO.
  const cache = new Map<string, number[]>();
  const cached = (text: string): number[] | null => {
    const vector = cache.get(text) ?? null;
    if (vector) {
      cache.delete(text);
      cache.set(text, vector);
    }
    return vector;
  };
  const remember = (text: string, vector: number[] | null) => {
    if (!vector) return;
    if (!cache.has(text) && cache.size >= MAX_CACHE_ENTRIES) {
      cache.delete(cache.keys().next().value as string);
    }
    cache.set(text, vector);
  };

  return {
    async embed(text) {
      const hit = cached(text);
      if (hit) return hit;
      const vector = await transport.embedOne(text);
      remember(text, vector);
      return vector;
    },

    async embedAll(texts) {
      const out = new Map<string, number[] | null>();
      const misses: string[] = [];
      for (const text of new Set(texts)) {
        const hit = cached(text);
        if (hit) out.set(text, hit);
        else {
          out.set(text, null);
          misses.push(text);
        }
      }
      if (!misses.length) return out;

      const outcome = await transport.embedBatch(misses);
      if (outcome.status === "ok") {
        misses.forEach((text, index) => {
          const vector = outcome.vectors[index] ?? null;
          out.set(text, vector);
          remember(text, vector);
        });
        return out;
      }
      if (outcome.status === "failed") return out; // caller fails the search, never merges partial

      // Old service without the batch endpoint: per-text calls, same as before.
      await Promise.all(
        misses.map(async (text) => {
          const vector = await transport.embedOne(text);
          out.set(text, vector);
          remember(text, vector);
        }),
      );
      return out;
    },
  };
}
