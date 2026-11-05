import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { renderEmbeddedAiPreview, renderEmbeddedPsdPreview } from "./embedded-ai-preview";

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

function photoshop(jpeg: Buffer, width = 32, height = 24, resourceId = 1036): Buffer {
  const header = Buffer.alloc(26); header.write("8BPS"); header.writeUInt16BE(1, 4);
  header.writeUInt16BE(3, 12); header.writeUInt32BE(1024, 14); header.writeUInt32BE(1024, 18);
  header.writeUInt16BE(8, 22); header.writeUInt16BE(3, 24);
  const thumbnail = Buffer.alloc(28); thumbnail.writeUInt32BE(1); thumbnail.writeUInt32BE(width, 4);
  thumbnail.writeUInt32BE(height, 8); thumbnail.writeUInt32BE(width * 3, 12);
  thumbnail.writeUInt32BE(width * height * 3, 16); thumbnail.writeUInt32BE(jpeg.length, 20);
  thumbnail.writeUInt16BE(24, 24); thumbnail.writeUInt16BE(1, 26);
  const resource = Buffer.alloc(12); resource.write("8BIM"); resource.writeUInt16BE(resourceId, 4);
  resource.writeUInt32BE(thumbnail.length + jpeg.length, 8);
  const resources = Buffer.concat([resource, thumbnail, jpeg, Buffer.alloc(jpeg.length % 2)]);
  const size = Buffer.alloc(4); size.writeUInt32BE(resources.length);
  const corruptLayers = Buffer.alloc(4); corruptLayers.writeUInt32BE(1_000_000_000);
  return Buffer.concat([header, Buffer.alloc(4), size, resources, corruptLayers]);
}
async function psdFixture(bytes: Buffer, run: (source: string) => Promise<void>) {
  return fixture(bytes.toString("latin1"), run);
}
test("recovers original RGB resource despite truncated layer section and preserves source/no upscaling", async () => {
  const body = photoshop(await artwork());
  await psdFixture(body, async (source) => {
    const result = await renderEmbeddedPsdPreview(source);
    assert.deepEqual([result.width, result.height], [32, 24]);
    assert.deepEqual(await readFile(source), body);
  });
});
test("never guesses BGR1033 thumbnail colors", async () => {
  await psdFixture(photoshop(await artwork(), 32, 24, 1033), async (source) => {
    await assert.rejects(renderEmbeddedPsdPreview(source), /no_embedded_psd_rgb_preview/);
  });
});
test("keeps the blank original PSD thumbnail rejected", async () => {
  const jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: "white" } }).jpeg().toBuffer();
  await psdFixture(photoshop(jpeg), async (source) => { await assert.rejects(renderEmbeddedPsdPreview(source), /blank_embedded_ai_preview/); });
});
test("refuses empty/truncated/non-Photoshop source headers", async () => {
  for (const body of [Buffer.alloc(0), Buffer.from("8BPS"), Buffer.alloc(30)]) {
    await psdFixture(body, async (source) => { await assert.rejects(renderEmbeddedPsdPreview(source), /invalid_embedded_psd_header/); });
  }
});
test("bounds color/resource extents and resource byte allocation against actual source", async () => {
  for (const mutate of [
    (body: Buffer) => body.writeUInt32BE(0xffffffff, 26),
    (body: Buffer) => body.writeUInt32BE(0xffffffff, 30),
    (body: Buffer) => body.writeUInt32BE(0xffffffff, 42),
  ]) {
    const body = photoshop(await artwork()); mutate(body);
    await psdFixture(body, async (source) => { await assert.rejects(renderEmbeddedPsdPreview(source), /invalid_embedded_psd_resource_extent/); });
  }
});
test("requires exact resource signature and bounded Pascal name", async () => {
  for (const mutate of [
    (body: Buffer) => body.write("NOPE", 34),
    (body: Buffer) => body.writeUInt8(255, 40),
  ]) {
    const body = photoshop(await artwork()); mutate(body);
    await psdFixture(body, async (source) => { await assert.rejects(renderEmbeddedPsdPreview(source), /invalid_embedded_psd_resource/); });
  }
});
test("requires JPEG dimensions and compressed length to match original resource header", async () => {
  const mismatched = photoshop(await artwork(), 33, 24);
  await psdFixture(mismatched, async (source) => { await assert.rejects(renderEmbeddedPsdPreview(source), /invalid_embedded_psd_preview_dimensions/); });
  const lengthMismatch = photoshop(await artwork()); lengthMismatch.writeUInt32BE(1, 66);
  await psdFixture(lengthMismatch, async (source) => { await assert.rejects(renderEmbeddedPsdPreview(source), /no_embedded_psd_rgb_preview/); });
});
test("refuses resource preview dimensions over existing pixel guard", async () => {
  await psdFixture(photoshop(await artwork(), 5000, 5000), async (source) => { await assert.rejects(renderEmbeddedPsdPreview(source), /no_embedded_psd_rgb_preview/); });
});
test("keeps a recorded monochrome warning hash rejected inside a PSD resource", async () => {
  const hash = "000000000000000088000000e4c8cc9c00008000000000000000000000000000";
  const bits = [...hash].flatMap(value => parseInt(value, 16).toString(2).padStart(4, "0").split(""));
  const pixels = Buffer.alloc(17 * 16 * 3);
  for (let row = 0; row < 16; row++) {
    let value = 128;
    for (let column = 0; column < 17; column++) {
      if (column) value += bits[row * 16 + column - 1] === "1" ? -5 : 5;
      pixels.fill(value, (row * 17 + column) * 3, (row * 17 + column + 1) * 3);
    }
  }
  const jpeg = await sharp(pixels, { raw: { width: 17, height: 16, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  await psdFixture(photoshop(jpeg, 17, 16), async (source) => { await assert.rejects(renderEmbeddedPsdPreview(source), /compat_alert_embedded_ai_preview/); });
});
