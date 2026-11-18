import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { compressTiff, verifyTiffPagesPreserved } from "./tiff-optimizer";

type Page = { w: number; h: number; px: Buffer };

// Hand-built little-endian baseline TIFF: one uncompressed 8-bit RGB IFD per page.
async function makeTiff(file: string, pages: Page[]) {
  const entries = 10, ifdSize = 2 + entries * 12 + 4;
  const bpsSize = 6;
  const blocks = pages.map((p) => ifdSize + bpsSize + p.px.length);
  const out = Buffer.alloc(8 + blocks.reduce((a, b) => a + b, 0));
  out.write("II", 0, "ascii");
  out.writeUInt16LE(42, 2);
  out.writeUInt32LE(8, 4);
  let ifd = 8;
  pages.forEach(({ w, h, px }, idx) => {
    const bps = ifd + ifdSize;
    const data = bps + bpsSize;
    out.writeUInt16LE(entries, ifd);
    const tags: Array<[number, number, number, number]> = [
      [256, 3, 1, w], [257, 3, 1, h], [258, 3, 3, bps], [259, 3, 1, 1],
      [262, 3, 1, 2], [273, 4, 1, data], [277, 3, 1, 3], [278, 3, 1, h],
      [279, 4, 1, px.length], [284, 3, 1, 1],
    ];
    tags.forEach(([tag, type, count, value], i) => {
      const e = ifd + 2 + i * 12;
      out.writeUInt16LE(tag, e);
      out.writeUInt16LE(type, e + 2);
      out.writeUInt32LE(count, e + 4);
      if (type === 3 && count === 1) out.writeUInt16LE(value, e + 8);
      else out.writeUInt32LE(value, e + 8);
    });
    const nextIfd = ifd + blocks[idx];
    out.writeUInt32LE(idx < pages.length - 1 ? nextIfd : 0, ifd + 2 + entries * 12);
    for (let k = 0; k < 3; k++) out.writeUInt16LE(8, bps + k * 2);
    px.copy(out, data);
    ifd = nextIfd;
  });
  await writeFile(file, out);
}

// Two distinct 64x64 pages, saved as an uncompressed 2-page TIFF.
async function makeTwoPageTiff(file: string) {
  const size = 64 * 64 * 3;
  const p1 = Buffer.alloc(size);
  for (let i = 0; i < size; i++) p1[i] = (i * 7) % 256; // page 1 pattern
  await makeTiff(file, [{ w: 64, h: 64, px: p1 }, { w: 64, h: 64, px: Buffer.alloc(size, 200) }]);
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

test("mixed-size multipage TIFF is never reduced to fewer pages (#1115)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tiff1115-"));
  try {
    const file = path.join(dir, "art.tif");
    const ref = path.join(dir, "ref.tif");
    const p1 = Buffer.alloc(64 * 64 * 3);
    for (let i = 0; i < p1.length; i++) p1[i] = (i * 5) % 256;
    const pages = [{ w: 64, h: 64, px: p1 }, { w: 32, h: 48, px: Buffer.alloc(32 * 48 * 3, 90) }];
    await makeTiff(file, pages);
    await makeTiff(ref, pages);
    const origBytes = await readFile(file);

    const res = await compressTiff(file, "process", new Date("2024-01-02T03:04:05Z"), null, "t1115");
    if (res.success) {
      // Compressed through a fallback that keeps mixed pages: every page must survive.
      const check = await verifyTiffPagesPreserved(ref, file);
      assert.equal(check.ok, true, check.reason);
      assert.equal(check.originalPages, 2);
    } else {
      // No mixed-page-capable encoder: the original must be byte-identical.
      assert.ok((await readFile(file)).equals(origBytes), "original must be untouched on failure");
      assert.match(res.error ?? "", /page/i);
    }
    assert.deepEqual((await readdir(dir)).sort(), ["art.tif", "ref.tif"], "no temp files left behind");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("verification compares mixed-size pages individually (#1115)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tiff1115-"));
  try {
    const a = path.join(dir, "a.tif");
    const b = path.join(dir, "b.tif");
    const pages = [
      { w: 64, h: 64, px: Buffer.alloc(64 * 64 * 3, 10) },
      { w: 32, h: 48, px: Buffer.alloc(32 * 48 * 3, 90) },
    ];
    await makeTiff(a, pages);
    await makeTiff(b, pages);
    assert.equal((await verifyTiffPagesPreserved(a, b)).ok, true);
    await makeTiff(b, [pages[0], { w: 32, h: 48, px: Buffer.alloc(32 * 48 * 3, 91) }]);
    const bad = await verifyTiffPagesPreserved(a, b);
    assert.equal(bad.ok, false);
    assert.match(bad.reason ?? "", /page 2 pixel content differs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
