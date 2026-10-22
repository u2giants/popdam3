import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { longPath, matchMangledFile, matchSmbName, normalizeSmbName, splitSmbRoot } from "./smb-resolve";

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

describe("matchMangledFile", () => {
  const exp = { size: 1000, mtimeMs: 1_700_000_000_000 };
  const stats: Record<string, { size: number; mtimeMs: number }> = {
    "4TQCYS~A.AI": { size: 1000, mtimeMs: 1_700_000_000_000 },
    "59PKMD~9.AI": { size: 999, mtimeMs: 1_700_000_000_000 },
    "5LYMWU~4.PSD": { size: 1000, mtimeMs: 1_700_000_000_000 },
  };
  const statOf = (n: string) => stats[n];

  it("picks the single mangled same-extension entry with matching size and mtime", () => {
    assert.equal(
      matchMangledFile('4_POWERPUFF "x".ai', ["4TQCYS~A.AI", "59PKMD~9.AI"], statOf, exp),
      "4TQCYS~A.AI",
    );
  });

  it("refuses when no entry matches", () => {
    assert.equal(matchMangledFile("a.ai", ["59PKMD~9.AI"], statOf, exp), null);
  });

  it("refuses a match with a different extension", () => {
    assert.equal(matchMangledFile("a.ai", ["5LYMWU~4.PSD"], statOf, exp), null);
  });

  it("refuses when two entries match", () => {
    const two = { "AAA~1.AI": exp, "BBB~2.AI": exp };
    assert.equal(matchMangledFile("a.ai", ["AAA~1.AI", "BBB~2.AI"], (n) => two[n as keyof typeof two], exp), null);
  });

  it("ignores long names that are not mangled", () => {
    assert.equal(matchMangledFile("a.ai", ["normal.ai"], () => exp, exp), null);
  });
});

describe("longPath", () => {
  it("adds the extended-length prefix to a drive path on Windows", () => {
    assert.equal(longPath("Z:\\Decor\\a.ai", "win32"), "\\\\?\\Z:\\Decor\\a.ai");
  });

  it("uses the UNC extended form for a share path on Windows", () => {
    assert.equal(longPath("\\\\host\\mac\\a.ai", "win32"), "\\\\?\\UNC\\host\\mac\\a.ai");
  });

  it("leaves paths alone off Windows and when already prefixed", () => {
    assert.equal(longPath("Z:\\a.ai", "linux"), "Z:\\a.ai");
    assert.equal(longPath("\\\\?\\Z:\\a.ai", "win32"), "\\\\?\\Z:\\a.ai");
  });
});
