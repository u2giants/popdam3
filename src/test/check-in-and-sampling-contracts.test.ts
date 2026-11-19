import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { quickHashFile, sha256File } from "../../apps/popdam-helper/src/main/hash";
import { makeUploadQueueItem } from "../../apps/popdam-helper/src/shared/upload-job";
import { quickHashV1 } from "../../packages/agent-common/src/quick-hash-v1";
import { runPdfSampleBatch, type FileProgressEntry } from "../../packages/agent-common/src/pdf-sample-batch";

it.each([
  [0, "af5570f5a1810b7af78caf4bc70a660f0df51e42baf91d4de5b2328de0e83dfc"],
  [65_535, "1f947f198a5bd76da5bfc117e39f931c70a316507d48909a396c31ef667bc7cb"],
  [65_536, "1c9ea836e8dd57c1a8e1afe3b589b4f1e6e032f45795196193eb2b98bab68a2a"],
  [65_537, "f47f133ad5ff40ecb67416317a900cc59fe43d815d96e33cd2f77601e4352b8c"],
  [131_072, "4229e247bd2fabc15d86101391e1ad62de67b81ba6ec8234e024bd76da3392b3"],
  [131_073, "4ba3481e3d94147c3aef5b67e34364b5a02335fa56ef08b6a668f72b01b35dd4"],
] as const)("keeps the stored V1 check-in fingerprint at %d bytes", async (size, digest) => {
  const folder = await mkdtemp(join(tmpdir(), "popdam-fingerprint-"));
  const file = join(folder, "snapshot");
  try {
    const bytes = Buffer.from(Uint8Array.from({ length: size }, (_, i) => (i * 31 + Math.floor(i / 257)) % 256));
    await writeFile(file, bytes);
    await expect(quickHashFile(file)).resolves.toBe(digest);
    await expect(sha256File(file)).resolves.toBe(createHash("sha256").update(bytes).digest("hex"));
    await expect(quickHashV1(file)).resolves.toBe(digest);
  } finally {
    await rm(folder, { recursive: true });
  }
});

it.each([
  ["synology", "smb_local"],
  ["seafile", "synology_file_station"],
  [undefined, "synology_file_station"],
] as const)("keeps the initial and redriven upload destination for %s", (provider, uploadMethod) => {
  const timestamp = vi.spyOn(Date, "now").mockReturnValue(1234);
  try {
    const record = { id: "checkout", sourceProvider: "seafile" as const, seafileObjId: "stored-object" };
    const instructions = {
      method: "fixture",
      synology_url: null,
      synology_port: "5001",
      relative_path: "artwork/example.psd",
      filename: "example.psd",
      temp_suffix: ".uploading",
    };
    const first = makeUploadQueueItem(record, "retained-snapshot", instructions, provider);
    const redrive = makeUploadQueueItem(record, "retained-snapshot", instructions, provider, true);
    expect(first).toEqual({
      checkoutId: "checkout",
      snapshotPath: "retained-snapshot",
      uploadMethod,
      synologyUrl: null,
      synologyPort: "5001",
      relativePath: "artwork/example.psd",
      filename: "example.psd",
      tempSuffix: ".uploading",
      retryCount: 0,
      addedAt: 1234,
      sourceProvider: "seafile",
      seafileObjId: "stored-object",
    });
    expect(redrive).toEqual({ ...first, isRedrive: true });
  } finally {
    timestamp.mockRestore();
  }
});

it.each([["bridge", "too large"], ["windows", undefined]] as const)(
  "keeps %s PDF progress, ordered results and the final-submit error",
  async (_platform, skipError) => {
    const assets = Array.from({ length: 27 }, (_, i) => ({
      id: String(i),
      filename: `sample-${i}.pdf`,
      relative_path: `sample-${i}.pdf`,
    }));
    const events: string[] = [];
    const reports: { count: number; latest: FileProgressEntry[]; error?: string }[] = [];
    await runPdfSampleBatch(assets, {
      resolvePath: (path) => path,
      process: async (asset, _, index) => {
        events.push(`process:${index}`);
        if (index === 26) throw new Error("file read failed");
        return {
          asset_id: asset.id,
          filename: asset.filename,
          relative_path: asset.relative_path,
          extraction_method: index === 25 ? "skipped" : "pdf_text",
          extracted_text: null,
          page_count: null,
          char_count: 0,
          extraction_error: null,
          ...(index === 25 ? { skip_reason: "too large" } : {}),
        };
      },
      describeResult: (asset, result) => ({
        filename: asset.filename,
        status: "success",
        method: result.extraction_method,
        chars: result.char_count,
        error: result.extraction_method === "skipped" ? skipError : undefined,
      }),
      progress: async (count, _total, _currentFile, _step, entries, error) => {
        events.push(`progress:${count}`);
        reports.push({ count, latest: entries.slice(-25), error });
      },
      complete: async (results) => {
        expect(results.map((result) => result.asset_id)).toEqual(assets.map((asset) => asset.id));
        expect(results[25].skip_reason).toBe("too large");
        expect(results[26].extraction_error).toBe("file read failed");
        throw new Error("submit failed");
      },
    });
    expect(events.slice(0, 5)).toEqual(["progress:0", "process:0", "progress:1", "process:1", "progress:2"]);
    expect(reports.at(-1)).toMatchObject({ count: 27, error: "submit failed" });
    const finalEntries = reports.at(-1)?.latest ?? [];
    expect(finalEntries).toHaveLength(25);
    expect(finalEntries[0].filename).toBe("sample-2.pdf");
    expect(finalEntries.at(-2)).toMatchObject({ method: "skipped", error: skipError });
    expect(finalEntries.at(-1)).toMatchObject({ status: "failed", error: "file read failed" });
  },
);
