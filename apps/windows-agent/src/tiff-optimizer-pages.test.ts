import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { compressTiff, verifyTiffPagesPreserved } from "./tiff-optimizer";

// Two distinct 64x64 pages stacked vertically, saved as an uncompressed 2-page TIFF.
// Hand-built little-endian baseline TIFF: one uncompressed 8-bit RGB IFD per page.
async function makeTwoPageTiff(file: string) {
  const w = 64, h = 64, size = w * h * 3;
  const p1 = Buffer.alloc(size);
  for (let i = 0; i < size; i++) p1[i] = (i * 7) % 256; // page 1 pattern
  const p2 = Buffer.alloc(size, 200); // page 2 solid
  const pages = [p1, p2];
  const entries = 10, ifdSize = 2 + entries * 12 + 4;
  const bpsSize = 6;
  // Layout: header(8) | per page: [ifd][bps][pixels]
  const blockSize = ifdSize + bpsSize + size;
  const out = Buffer.alloc(8 + blockSize * pages.length);
  out.write("II", 0, "ascii");
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(8, 4);
  pages.forEach((px, idx) => {
    const ifd = 8 + idx * blockSize;
    const bps = ifd + ifdSize;
    const data = bps + bpsSize;
    out.writeUInt16LE(entries, ifd);
    const tags: Array<[number, number, number, number]> = [
      [256, 3, 1, w], [257, 3, 1, h], [258, 3, 3, bps], [259, 3, 1, 1],
      [262, 3, 1, 2], [273, 4, 1, data], [277, 3, 1, 3], [278, 3, 1, h],
      [279, 4, 1, size], [284, 3, 1, 1],
    ];
    tags.forEach(([tag, type, count, value], i) => {
      const e = ifd + 2 + i * 12;
      out.writeUInt16LE(tag, e);
      out.writeUInt16LE(type, e + 2);
      out.writeUInt32LE(count, e + 4);
      if (type === 3 && count === 1) out.writeUInt16LE(value, e + 8);
      else out.writeUInt32LE(value, e + 8);
    });
    const next = idx < pages.length - 1 ? 8 + (idx + 1) * blockSize : 0;
    out.writeUInt32LE(next, ifd + 2 + entries * 12);
    for (let k = 0; k < 3; k++) out.writeUInt16LE(8, bps + k * 2);
    px.copy(out, data);
  });
  await writeFile(file, out);
}

test("multipage TIFF keeps every page and pixel after process-mode compression (#1077)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tiff1077-"));
  try {
    const file = path.join(dir, "art.tif");
    const ref = path.join(dir, "ref.tif");
    await makeTwoPageTiff(file);
    await makeTwoPageTiff(ref);
    assert.equal((await sharp(file).metadata()).pages, 2);
    const origSize = (await stat(file)).size;

    const res = await compressTiff(file, "process", new Date("2024-01-02T03:04:05Z"), null, "t1077");
    assert.equal(res.success, true, res.error);
    assert.ok((await stat(file)).size < origSize, "compressed file should be smaller");
    assert.equal((await sharp(file).metadata()).pages, 2);
    const check = await verifyTiffPagesPreserved(ref, file);
    assert.equal(check.ok, true, check.reason);
    assert.deepEqual((await readdir(dir)).sort(), ["art.tif", "ref.tif"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verification rejects a result that dropped a page", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tiff1077-"));
  try {
    const file = path.join(dir, "art.tif");
    const single = path.join(dir, "single.tif");
    await makeTwoPageTiff(file);
    await sharp(file, { page: 0 }).tiff({ compression: "deflate" }).toFile(single);
    const check = await verifyTiffPagesPreserved(file, single);
    assert.equal(check.ok, false);
    assert.match(check.reason ?? "", /page count 1 != original 2/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verification rejects altered pixel content", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tiff1077-"));
  try {
    const file = path.join(dir, "art.tif");
    const altered = path.join(dir, "alt.tif");
    await makeTwoPageTiff(file);
    await sharp(file, { pages: -1 }).negate().tiff({ compression: "deflate" }).toFile(altered);
    const check = await verifyTiffPagesPreserved(file, altered);
    assert.equal(check.ok, false);
    assert.match(check.reason ?? "", /pixel content differs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
