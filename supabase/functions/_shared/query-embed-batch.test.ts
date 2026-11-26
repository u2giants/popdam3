import { describe, expect, it } from "vitest";
import { type BatchEmbedOutcome, createQueryEmbedder, type QueryEmbedTransport } from "./query-embed-batch.ts";

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

  it("embedAllWithText returns picture and text vectors from one call and caches both", async () => {
    const { calls, transport } = recorder();
    transport.embedBatch = async (texts) => {
      calls.batch.push(texts);
      return { status: "ok", vectors: texts.map(() => vector(1)), textVectors: texts.map(() => vector(2)), textModel: "m@1" };
    };
    const embedder = createQueryEmbedder(transport);
    const out = await embedder.embedAllWithText(["mat", "rug"]);
    expect(out.textVectors.get("mat")).toEqual({ vector: vector(2), model: "m@1" });
    await embedder.embedAllWithText(["mat", "rug"]);
    expect(calls.batch).toEqual([["mat", "rug"]]);
  });

  it("embedAllWithText leaves text vectors null when the service sends none", async () => {
    const embedder = createQueryEmbedder(batchTransport({ status: "ok", vectors: [vector(1)] }));
    const out = await embedder.embedAllWithText(["mat"]);
    expect(out.vectors.get("mat")).toEqual(vector(1));
    expect(out.textVectors.get("mat")).toBeNull();
  });

  it("coalesces two concurrent cold misses for the same texts into one batch call", async () => {
    const batches: string[][] = [];
    let release!: (outcome: BatchEmbedOutcome) => void;
    const gate = new Promise<BatchEmbedOutcome>((resolve) => {
      release = resolve;
    });
    const embedder = createQueryEmbedder({
      async embedBatch(texts) {
        batches.push(texts);
        return gate;
      },
      async embedOne() {
        throw new Error("embedOne must not run when the batch endpoint answers");
      },
    });
    const first = embedder.embedAll(["rug", "mat"]);
    const second = embedder.embedAll(["mat", "rug"]);
    release({ status: "ok", vectors: [vector(1), vector(2)] }); // sorted order: mat, rug
    const [a, b] = await Promise.all([first, second]);
    expect(batches).toEqual([["mat", "rug"]]);
    expect(a.get("mat")).toEqual(vector(1));
    expect(a.get("rug")).toEqual(vector(2));
    expect(b.get("mat")).toEqual(vector(1));
    expect(b.get("rug")).toEqual(vector(2));
  });

  it("does not cache a failed batch outcome, so the next call asks the service again", async () => {
    const batches: string[][] = [];
    const outcomes: BatchEmbedOutcome[] = [{ status: "failed" }, { status: "ok", vectors: [vector(7)] }];
    const embedder = createQueryEmbedder({
      async embedBatch(texts) {
        batches.push(texts);
        return outcomes.shift()!;
      },
      async embedOne() {
        throw new Error("embedOne must not run when the batch endpoint answers");
      },
    });
    expect((await embedder.embedAll(["mat"])).get("mat")).toBeNull();
    expect((await embedder.embedAll(["mat"])).get("mat")).toEqual(vector(7));
    expect(batches).toEqual([["mat"], ["mat"]]);
  });

  it("does not cache a rejected batch, so the next call asks the service again", async () => {
    const batches: string[][] = [];
    let fail = true;
    const embedder = createQueryEmbedder({
      async embedBatch(texts) {
        batches.push(texts);
        if (fail) throw new Error("socket reset");
        return { status: "ok", vectors: [vector(8)] };
      },
      async embedOne() {
        throw new Error("embedOne must not run when the batch endpoint answers");
      },
    });
    await expect(embedder.embedAll(["mat"])).rejects.toThrow("socket reset");
    fail = false;
    expect((await embedder.embedAll(["mat"])).get("mat")).toEqual(vector(8));
    expect(batches).toEqual([["mat"], ["mat"]]);
  });

  it("one caller giving up on a shared batch does not fail the other caller", async () => {
    let calls = 0;
    let release!: (outcome: BatchEmbedOutcome) => void;
    const gate = new Promise<BatchEmbedOutcome>((resolve) => {
      release = resolve;
    });
    const embedder = createQueryEmbedder({
      async embedBatch() {
        calls += 1;
        return gate;
      },
      async embedOne() {
        throw new Error("embedOne must not run when the batch endpoint answers");
      },
    });
    const callerA = Promise.race([
      embedder.embedAll(["mat"]),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("caller A deadline")), 5)),
    ]);
    const callerB = embedder.embedAll(["mat"]);
    await expect(callerA).rejects.toThrow("caller A deadline");
    release({ status: "ok", vectors: [vector(9)] });
    expect((await callerB).get("mat")).toEqual(vector(9));
    expect(calls).toBe(1);
  });
});
