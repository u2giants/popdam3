import assert from "node:assert/strict";
import { test } from "node:test";
import { PreflightFailedError, reusableThumbnailId, runCheckChangedPreflight, type PreflightFile } from "./check-changed-preflight.js";

const files = (n: number): PreflightFile[] =>
  Array.from({ length: n }, (_, i) => ({ relative_path: `Decor/f${i}.psd`, modified_at: "2026-11-01T00:00:00Z", file_size: 1 }));
const empty = { changed: [], needs_thumbnail: [], existing_content_identities: [], existing_thumbnails: [] };

test("merges every chunk's answer", async () => {
  const sizes: number[] = [];
  const result = await runCheckChangedPreflight(files(5), {
    chunkSize: 2,
    checkChanged: async (chunk) => {
      sizes.push(chunk.length);
      return { ...empty, changed: [chunk[0].relative_path] };
    },
    sleep: async () => {},
    warn: () => {},
  });
  assert.deepEqual(sizes, [2, 2, 1]);
  assert.deepEqual(result.changed, ["Decor/f0.psd", "Decor/f2.psd", "Decor/f4.psd"]);
});

test("retries a failing chunk and carries on", async () => {
  let calls = 0;
  const slept: number[] = [];
  const result = await runCheckChangedPreflight(files(2), {
    retryDelaysMs: [10, 20],
    checkChanged: async () => {
      if (++calls < 3) throw new Error("504");
      return { ...empty, changed: ["Decor/f1.psd"] };
    },
    sleep: async (ms) => { slept.push(ms); },
    warn: () => {},
  });
  assert.deepEqual(slept, [10, 20]);
  assert.deepEqual(result.changed, ["Decor/f1.psd"]);
});

test("fails the scan instead of treating every file as changed", async () => {
  let calls = 0;
  await assert.rejects(
    runCheckChangedPreflight(files(3), {
      retryDelaysMs: [1, 1],
      checkChanged: async () => {
        calls++;
        throw new Error("504");
      },
      sleep: async () => {},
      warn: () => {},
    }),
    PreflightFailedError,
  );
  assert.equal(calls, 3);
});

test("stops retrying when the scan is aborted", async () => {
  await assert.rejects(
    runCheckChangedPreflight(files(1), {
      checkChanged: async () => empty,
      sleep: async () => {},
      warn: () => {},
      shouldAbort: () => true,
    }),
    /Aborted by user/,
  );
});

test("reuses the stored thumbnail name only for identical content", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const existing = { quick_hash: "abc", thumbnail_url: `https://cdn.example/thumbnails/${id}.jpg` };
  assert.equal(reusableThumbnailId(existing, "abc"), id);
  assert.equal(reusableThumbnailId(existing, "changed"), null);
  assert.equal(reusableThumbnailId(undefined, "abc"), null);
  assert.equal(reusableThumbnailId({ quick_hash: "abc", thumbnail_url: "https://cdn.example/other/x.jpg" }, "abc"), null);
});
