import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchSmbName, normalizeSmbName, splitSmbRoot } from "./smb-resolve";

describe("normalizeSmbName", () => {
  it("maps catia private-use quotes to ASCII", () => {
    assert.equal(normalizeSmbName("10\uF022Wall.psd"), '10"Wall.psd');
  });
});

describe("matchSmbName", () => {
  it("matches a catia-listed name to the database name with a quote", () => {
    assert.equal(matchSmbName('10"Wall.psd', ["other.psd", "10\uF022Wall.psd"]), "10\uF022Wall.psd");
  });

  it("does not match a different file whose name only lacks the quote", () => {
    assert.equal(matchSmbName('10"Wall.psd', ["10Wall.psd"]), null);
  });

  it("returns null when nothing matches", () => {
    assert.equal(matchSmbName('10"Wall.psd', ["9Wall.psd"]), null);
  });

  it("returns null when two listed names are ambiguous", () => {
    assert.equal(matchSmbName('10"Wall.psd', ["10\uF022Wall.psd", '10"Wall.psd']), null);
  });
});

describe("splitSmbRoot", () => {
  it("handles a drive-letter mount", () => {
    assert.deepEqual(splitSmbRoot("Z:\\Decor\\a.psd"), { root: "Z:\\", segments: ["Decor", "a.psd"] });
  });

  it("handles a UNC share path", () => {
    assert.deepEqual(splitSmbRoot("\\\\192.168.3.101\\mac\\Decor\\a.psd"), {
      root: "\\\\192.168.3.101\\mac\\",
      segments: ["Decor", "a.psd"],
    });
  });

  it("returns null for a relative path", () => {
    assert.equal(splitSmbRoot("Decor\\a.psd"), null);
  });
});
