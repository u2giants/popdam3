import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { generateThumbnail, HIRES_MAX_DIM } from "./thumbnailer.js";

// popdam3#1272: wide raster art keeps a hi-res rendition for AI tagging.
test("wide raster gets an 800px thumbnail and a larger hi-res rendition", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "hires-"));
  try {
    const wide = path.join(dir, "wide.png");
    await sharp({ create: { width: 4000, height: 1000, channels: 3, background: "#3366aa" } }).png().toFile(wide);
    const r = await generateThumbnail(wide, "png");
    assert.deepEqual([r.width, r.height], [800, 200]);
    assert.ok(r.hiresBuffer);
    const m = await sharp(r.hiresBuffer).metadata();
    assert.deepEqual([m.width, m.height], [HIRES_MAX_DIM, 375]);

    const small = path.join(dir, "small.png");
    await sharp({ create: { width: 600, height: 400, channels: 3, background: "#aa6633" } }).png().toFile(small);
    const s = await generateThumbnail(small, "png");
    assert.deepEqual([s.width, s.height], [600, 400]);
    assert.equal(s.hiresBuffer, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
