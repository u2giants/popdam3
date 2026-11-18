import { describe, expect, it } from "vitest";
import { MANIFEST_HEADER, type ManifestRow, streamThumbnailManifest } from "./thumbnail-manifest.js";

const row = (n: number): ManifestRow => ({
  id: `id-${String(n).padStart(6, "0")}`,
  relative_path: `a/b,${n}`,
  filename: `f"${n}".psd`,
  quick_hash: null,
  thumbnail_url: `https://x/${n}.jpg`,
});

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const dec = new TextDecoder();
  let out = "";
  const reader = stream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return out;
    out += dec.decode(value);
  }
}

describe("streamThumbnailManifest", () => {
  it("returns every row across pages using keyset pagination", async () => {
    const all = Array.from({ length: 2503 }, (_, i) => row(i));
    const calls: Array<string | null> = [];
    const csv = await readAll(streamThumbnailManifest(async (after, limit) => {
      calls.push(after);
      const start = after === null ? 0 : all.findIndex((r) => r.id === after) + 1;
      return all.slice(start, start + limit);
    }, 1000));
    const lines = csv.trimEnd().split("\n");
    expect(lines[0] + "\n").toBe(MANIFEST_HEADER);
    expect(lines).toHaveLength(2504);
    expect(lines[1]).toBe('id-000000,"a/b,0","f""0"".psd",,https://x/0.jpg');
    expect(calls).toEqual([null, "id-000999", "id-001999"]);
  });

  it("fetches lazily, one page per consumer read (bounded memory)", async () => {
    let fetched = 0;
    const stream = streamThumbnailManifest(async (_after, limit) => {
      fetched++;
      return Array.from({ length: limit }, (_, i) => row(fetched * limit + i));
    }, 10);
    const reader = stream.getReader();
    await reader.read(); // header
    await reader.read(); // page 1
    expect(fetched).toBeLessThanOrEqual(2);
    await reader.cancel();
  });

  it("errors the stream when a page fetch fails", async () => {
    const stream = streamThumbnailManifest(async () => {
      throw new Error("boom");
    });
    await expect(readAll(stream)).rejects.toThrow("boom");
  });
});
