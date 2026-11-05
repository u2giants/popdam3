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
