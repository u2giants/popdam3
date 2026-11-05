import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { renderEmbeddedAiPreview } from "./embedded-ai-preview";

async function fixture(body: string, run: (source: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "popdam-xmp-preview-test-"));
  const source = path.join(dir, "original.ai");
  try { await writeFile(source, body, "latin1"); await run(source); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
async function artwork(): Promise<Buffer> {
  // Asymmetric, nonblank pixel pattern: real JPEG decode and real notice hash.
  const data = Buffer.alloc(32 * 24 * 3);
  for (let i = 0; i < data.length; i++) data[i] = (i * 37 + Math.floor(i / 97)) % 256;
  return sharp(data, { raw: { width: 32, height: 24, channels: 3 } }).jpeg().toBuffer();
}
const xmp = (jpeg: Buffer) => `<xmpGImg:image>${jpeg.toString("base64").match(/.{1,76}/g)!.join("&#xA;")}</xmpGImg:image>`;

test("recovers exact original JPEG metadata without upscaling or changing its source", async () => {
  const body = "%PDF-1.4\n" + xmp(await artwork());
  await fixture(body, async (source) => {
    const result = await renderEmbeddedAiPreview(source);
    assert.equal(result.width, 32); assert.equal(result.height, 24);
    assert.equal((await sharp(result.buffer).metadata()).format, "jpeg");
    assert.equal(await readFile(source, "latin1"), body);
  });
});

test("finds saved preview in the bounded tail of a large source", async () => {
  const body = "%PDF-1.4\n" + " ".repeat(1100000) + xmp(await artwork());
  await fixture(body, async (source) => { assert.equal((await renderEmbeddedAiPreview(source)).width, 32); });
});

test("rejects a blank original metadata preview", async () => {
  const image = await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).jpeg().toBuffer();
  await fixture("%PDF-1.4\n" + xmp(image), async (source) => {
    await assert.rejects(renderEmbeddedAiPreview(source), /blank_embedded_ai_preview/);
  });
});

test("rejects malformed base64 and unrelated source formats", async () => {
  for (const body of ["%PDF-1.4\n<xmpGImg:image>not-an-image</xmpGImg:image>", "8BPS" + xmp(await artwork()), ""]) {
    await fixture(body, async (source) => { await assert.rejects(renderEmbeddedAiPreview(source), /no_embedded_ai_preview/); });
  }
});

test("rejects an oversized declared JPEG before pixel decode", async () => {
  const image = await artwork();
  const sof = image.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(sof >= 0);
  image.writeUInt16BE(10000, sof + 5); image.writeUInt16BE(10000, sof + 7);
  await fixture("%PDF-1.4\n" + xmp(image), async (source) => {
    await assert.rejects(renderEmbeddedAiPreview(source), /pixel limit|invalid_embedded_ai_preview/i);
  });
});


test("does not let a blank first preview hide a valid later original preview", async () => {
  const blank = await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).jpeg().toBuffer();
  await fixture("%PDF-1.4\n" + xmp(blank) + xmp(await artwork()), async (source) => {
    assert.equal((await renderEmbeddedAiPreview(source)).width, 32);
  });
});

test("reads an embedded preview spanning contiguous metadata windows", async () => {
  const body = "%PDF-1.4\n" + " ".repeat(512 * 1024 - 100) + xmp(await artwork());
  await fixture(body, async (source) => { assert.equal((await renderEmbeddedAiPreview(source)).width, 32); });
});


async function binaryEps(tiff: Buffer, changeHeader?: (header: Buffer) => void): Promise<string> {
  const postscript = Buffer.from("%!PS-Adobe-3.0\nshowpage\n");
  const header = Buffer.alloc(30);
  Buffer.from([0xc5, 0xd0, 0xd3, 0xc6]).copy(header);
  header.writeUInt32LE(30, 4); header.writeUInt32LE(postscript.length, 8);
  header.writeUInt32LE(30 + postscript.length, 20); header.writeUInt32LE(tiff.length, 24);
  header.writeUInt16LE(0xffff, 28); changeHeader?.(header);
  return Buffer.concat([header, postscript, tiff]).toString("latin1");
}

test("recovers the binary EPS source's original TIFF preview, without changing source", async () => {
  const tiff = await sharp(await artwork()).tiff().toBuffer();
  const body = await binaryEps(tiff);
  await fixture(body, async (source) => {
    const result = await renderEmbeddedAiPreview(source);
    assert.equal(result.width, 32); assert.equal(result.height, 24);
    assert.equal(await readFile(source, "latin1"), body);
  });
});

test("rejects binary EPS preview offsets or lengths outside the source/budget", async () => {
  const tiff = await sharp(await artwork()).tiff().toBuffer();
  for (const change of [(header: Buffer) => header.writeUInt32LE(0xffffffff, 20), (header: Buffer) => header.writeUInt32LE(5 * 1024 * 1024, 24)]) {
    await fixture(await binaryEps(tiff, change), async (source) => {
      await assert.rejects(renderEmbeddedAiPreview(source), /no_embedded_ai_preview/);
    });
  }
});

test("keeps blank rejection for binary EPS previews", async () => {
  const tiff = await sharp({ create: { width: 32, height: 32, channels: 3, background: "white" } }).tiff().toBuffer();
  await fixture(await binaryEps(tiff), async (source) => {
    await assert.rejects(renderEmbeddedAiPreview(source), /blank_embedded_ai_preview/);
  });
});
