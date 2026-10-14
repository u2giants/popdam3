import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPsdDecodeFailure, PSD_TOOLS_SCRIPT } from "./psd-tools-fallback";

describe("isPsdDecodeFailure", () => {
  it("matches the ImageMagick PSD channel decode error", () => {
    assert.equal(
      isPsdDecodeFailure("imagemagick: unable to decompress image `Z:\\x.psd' @ error/psd.c/ReadPSDChannel/1519."),
      true,
    );
  });

  it("does not match a missing-file error", () => {
    assert.equal(isPsdDecodeFailure("unable to open image 'Z:\\x.psd': No such file or directory"), false);
  });
});

describe("PSD_TOOLS_SCRIPT", () => {
  it("reads the path from argv, never from interpolated text", () => {
    assert.match(PSD_TOOLS_SCRIPT, /sys\.argv\[1\]/);
    assert.match(PSD_TOOLS_SCRIPT, /composite\(\)/);
  });
});
