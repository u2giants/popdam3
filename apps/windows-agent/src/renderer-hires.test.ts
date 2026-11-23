import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { renderNativeImage } from "./renderer";

// popdam3#1272: wide raster art keeps a hi-res rendition for AI tagging.
test("wide native image yields an 800px thumbnail and a 1500px hi-res rendition", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "win-hires-"));
  try {
    const wide = path.join(dir, "wide.png");
    await sharp({ create: { width: 4000, height: 1000, channels: 3, background: "#3366aa" } }).png().toFile(wide);
    const r = await renderNativeImage(wide);
    assert.deepEqual([r.width, r.height], [800, 200]);
    const m = await sharp(r.hiresBuffer!).metadata();
    assert.deepEqual([m.width, m.height], [1500, 375]);
    const small = path.join(dir, "small.png");
    await sharp({ create: { width: 500, height: 300, channels: 3, background: "#aa6633" } }).png().toFile(small);
    assert.equal((await renderNativeImage(small)).hiresBuffer, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
