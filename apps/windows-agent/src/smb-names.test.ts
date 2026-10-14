import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toSmbClientRelativePath, toSmbClientSegment } from "./smb-names.ts";

describe("toSmbClientSegment", () => {
  it("maps a double quote to the Samba catia private-use code point", () => {
    assert.equal(toSmbClientSegment('10"Wallclock_spidey.psd'), "10Wallclock_spidey.psd");
  });

  it("leaves ordinary names unchanged", () => {
    assert.equal(toSmbClientSegment("MJP153009.psd"), "MJP153009.psd");
  });

  it("maps every forbidden Windows character", () => {
    assert.equal(
      toSmbClientSegment('a"b*c:d<e>f?g\\h|i'),
      "abcdefghi",
    );
  });
});

describe("toSmbClientRelativePath", () => {
  it("translates each segment and keeps the separators", () => {
    assert.equal(
      toSmbClientRelativePath('Decor/Ross/Chosen_Canvas/26_VENOM_CANVAS_16X24".ai'),
      "Decor/Ross/Chosen_Canvas/26_VENOM_CANVAS_16X24.ai",
    );
  });
});
