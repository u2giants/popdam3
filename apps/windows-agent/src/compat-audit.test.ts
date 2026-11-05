import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { isCompatAlertBuffer } from "./compat-audit";

// Recorded monochrome reference variants already used by the production audit.
// Build deterministic grayscale pixel fixtures with exactly those dHash bits;
// color verification must not disable any of the existing warning variants.
const references = [
  "000000000000000088000000e4c8cc9c00008000000000000000000000000000",
  "0000000081000000c600c600d690c600c610d600c600d690c600c610d6100000",
  "4400980098009800980098009800980098009800980098009800d80098000000",
  "0000000000000000000000000400000088008800888088008880880088808800",
  "0000a000a000a0004000a000a000a0002000a000a0004000a000a000a0000000",
  "0000800090008000800010008000800000009000800080001000800080000000",
  "0000b000b000b000a000b000b200a000a000b000b200a000b000b000b0002000",
  "1000c600c600d600c600c600d680c640c600c680d600c600c600d680c6000000",
];
async function referenceFixture(hash: string, tint = 0): Promise<Buffer> {
  const bits = [...hash].flatMap(value => parseInt(value, 16).toString(2).padStart(4, "0").split(""));
  const pixels = Buffer.alloc(17 * 16 * 3);
  for (let row = 0; row < 16; row++) {
    let value = 128;
    for (let column = 0; column < 17; column++) {
      if (column) value += bits[row * 16 + column - 1] === "1" ? -5 : 5;
      const index = (row * 17 + column) * 3;
      pixels[index] = value + tint; pixels[index + 1] = value; pixels[index + 2] = value - tint;
    }
  }
  return sharp(pixels, { raw: { width: 17, height: 16, channels: 3 } }).png().toBuffer();
}

for (const [index, hash] of references.entries()) {
  test(`keeps monochrome warning-hash variant ${index + 1}`, async () => {
    assert.equal(await isCompatAlertBuffer(await referenceFixture(hash)), true);
  });
}

test("keeps mildly tinted monochrome warning hashes", async () => {
  assert.equal(await isCompatAlertBuffer(await referenceFixture(references[0], 4)), true);
});

test("does not mistake genuine horizontal red-white stripes for a compatibility notice", async () => {
  // Every row is constant, so its horizontal dHash is all zero: the production
  // incident collided with the sparse warning references despite being real art.
  const pixels = Buffer.alloc(64 * 64 * 3);
  for (let row = 0; row < 64; row++) for (let column = 0; column < 64; column++) {
    const index = (row * 64 + column) * 3;
    const white = Math.floor(row / 8) % 2 === 0;
    pixels[index] = 255; pixels[index + 1] = white ? 255 : 0; pixels[index + 2] = white ? 255 : 0;
  }
  const image = await sharp(pixels, { raw: { width: 64, height: 64, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
  assert.equal(await isCompatAlertBuffer(image), false);
});
