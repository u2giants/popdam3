import { describe, expect, it } from "vitest";
import { createQueryEmbedder, type BatchEmbedOutcome, type QueryEmbedTransport } from "./query-embed-batch.ts";

const vector = (fill: number) => Array.from({ length: 4 }, () => fill);

function recorder() {
  const calls = { batch: [] as string[][], single: [] as string[] };
  const transport: QueryEmbedTransport = {
    async embedBatch(texts) {
      calls.batch.push(texts);
      return null;
    },
    async embedOne(text) {
      calls.single.push(text);
      return vector(text.length);
    },
  };
  return { calls, transport };
}

const batchTransport = (outcome: BatchEmbedOutcome): QueryEmbedTransport => ({
  async embedBatch() {
    return outcome;
  },
  async embedOne() {
    throw new Error("embedOne must not run when the batch endpoint answers");
  },
});

describe("createQueryEmbedder", () => {
  it("batches every miss into one call and maps vectors back by text", async () => {
    const { calls, transport } = recorder();
    let n = 0;
    transport.embedBatch = async (texts) => {
      calls.batch.push(texts);
      return { status: "ok", vectors: texts.map(() => vector(++n)) };
    };
    const embedder = createQueryEmbedder(transport);
    const out = await embedder.embedAll(["mat", "rug", "mat"]);
    expect(calls.batch).toEqual([["mat", "rug"]]); // deduped
    expect(out.get("mat")).toEqual(vector(1));
    expect(out.get("rug")).toEqual(vector(2));
  });

  it("serves repeats from cache without another service call", async () => {
    const { calls, transport } = recorder();
    transport.embedBatch = async (texts) => {
      calls.batch.push(texts);
      return { status: "ok", vectors: texts.map((t) => vector(t.length)) };
    };
    const embedder = createQueryEmbedder(transport);
    await embedder.embed("harry potter"); // single-text path
    await embedder.embed("harry potter"); // cached
    await embedder.embedAll(["harry potter", "star wars"]); // only the miss batches
    expect(calls.single).toEqual(["harry potter"]);
    expect(calls.batch).toEqual([["star wars"]]);
  });

  it("falls back to single-text calls when the batch endpoint is absent", async () => {
    const { calls, transport } = recorder();
    transport.embedBatch = async (texts) => {
      calls.batch.push(texts);
      return { status: "absent" };
    };
    const embedder = createQueryEmbedder(transport);
    const out = await embedder.embedAll(["mat", "rug"]);
    expect(calls.batch).toEqual([["mat", "rug"]]);
    expect(calls.single.sort()).toEqual(["mat", "rug"]);
    expect(out.get("mat")).toEqual(vector(3));
    expect(out.get("rug")).toEqual(vector(3));
  });

  it("returns nulls on batch failure so the caller fails the search loud", async () => {
    const { calls, transport } = recorder();
    const embedder = createQueryEmbedder({ ...transport, embedBatch: async () => ({ status: "failed" } as const) });
    const out = await embedder.embedAll(["mat", "rug"]);
    expect(out.get("mat")).toBeNull();
    expect(out.get("rug")).toBeNull();
    expect(calls.single).toEqual([]); // no silent per-text retries after a failed batch
  });

  it("evicts the least recently used entry beyond the cache bound", async () => {
    const { calls, transport } = recorder();
    const embedder = createQueryEmbedder(transport);
    for (let i = 0; i < 256; i++) await embedder.embed(`q${i}`);
    expect(calls.single.length).toBe(256);
    await embedder.embed("q0"); // refresh q0 to most-recent
    await embedder.embed("fresh"); // evicts q1, not q0
    expect(calls.single.length).toBe(257);
    await embedder.embed("q0"); // still cached
    await embedder.embed("q1"); // was evicted: one more call
    expect(calls.single.length).toBe(258);
  });
});
