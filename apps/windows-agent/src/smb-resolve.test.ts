import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type SmbFs, resolveExistingSmbPath, longPath, matchMangledFile, matchSmbName, normalizeSmbName, splitSmbRoot } from "./smb-resolve";

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
    assert.deepEqual(splitSmbRoot("\\\\192.0.2.101\\mac\\Decor\\a.psd"), {
      root: "\\\\192.0.2.101\\mac\\",
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

  it("skips a disappearing file candidate and checks the next one", () => {
    const stat = (name: string) => {
      if (name === "59PKMD~9.AI") throw new Error("ENOENT");
      return statOf(name);
    };
    assert.equal(matchMangledFile("a.ai", ["59PKMD~9.AI", "4TQCYS~A.AI"], stat, exp), "4TQCYS~A.AI");
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

describe("resolveExistingSmbPath with mangled folders", () => {
  // Models edgesynology1: folders `10"`, `12"`, `14"` listed only as 8.3 names.
  const exp = { size: 2916917, mtimeMs: 1_699_000_000_000 };
  const tree: Record<string, { dir: boolean; size?: number; mtimeMs?: number }> = {
    "Z:\\E": { dir: true },
    "Z:\\E\\1736GU~Y": { dir: true },
    "Z:\\E\\17N5OA~K": { dir: true },
    "Z:\\E\\18R430~O": { dir: true },
    "Z:\\E\\17N5OA~K\\PQK": { dir: true },
    "Z:\\E\\17N5OA~K\\PQK\\PQK mockup.jpg": { dir: false, ...exp },
    "Z:\\E\\18R430~O\\OTHER": { dir: true },
  };
  const fs: SmbFs = {
    exists: (p) => p in tree,
    list: (p) => {
      if (!(p in tree)) throw new Error("ENOENT");
      return Object.keys(tree)
        .filter((k) => k.startsWith(p + "\\") && !k.slice(p.length + 1).includes("\\"))
        .map((k) => k.slice(p.length + 1));
    },
    stat: (p) => {
      const n = tree[p];
      if (!n) throw new Error("ENOENT");
      return { size: n.size ?? 0, mtimeMs: n.mtimeMs ?? 0, isDirectory: n.dir };
    },
  };
  const wanted = "Z:\\E\\12\uF022\\PQK\\PQK mockup.jpg";

  it("finds the file through the one mangled folder that contains the rest of the path", () => {
    assert.equal(resolveExistingSmbPath(wanted, exp, fs), "Z:\\E\\17N5OA~K\\PQK\\PQK mockup.jpg");
  });

  it("refuses when two mangled folders both contain the rest of the path", () => {
    const dup = { ...tree, "Z:\\E\\1736GU~Y\\PQK": { dir: true }, "Z:\\E\\1736GU~Y\\PQK\\PQK mockup.jpg": { dir: false, ...exp } };
    const fs2: SmbFs = { ...fs, exists: (p) => p in dup, list: (p) => Object.keys(dup).filter((k) => k.startsWith(p + "\\") && !k.slice(p.length + 1).includes("\\")).map((k) => k.slice(p.length + 1)), stat: (p) => ({ size: dup[p]?.size ?? 0, mtimeMs: dup[p]?.mtimeMs ?? 0, isDirectory: !!dup[p]?.dir }) };
    assert.equal(resolveExistingSmbPath(wanted, exp, fs2), wanted);
  });

  it("returns the input unchanged when no mangled folder holds the file", () => {
    const missing = "Z:\\E\\12\uF022\\NOPE\\x.jpg";
    assert.equal(resolveExistingSmbPath(missing, exp, fs), missing);
  });

  it("ignores ordinary tilde folders even when they contain the requested suffix", () => {
    for (const name of ["my~notes", "~tmp"]) {
      const candidate = `Z:\\E\\${name}\\PQK`;
      const fixture: SmbFs = {
        ...fs,
        list: () => [name],
        stat: () => ({ size: 0, mtimeMs: 0, isDirectory: true }),
        exists: (p) => p === "Z:\\E" || p === candidate || p === candidate + "\\PQK mockup.jpg",
      };
      assert.equal(resolveExistingSmbPath(wanted, exp, fixture), wanted);
    }
  });

  it("continues to a sibling when probing a guessed folder throws", () => {
    const fixture: SmbFs = {
      ...fs,
      exists: (p) => {
        if (p.startsWith("Z:\\E\\1736GU~Y\\")) throw new Error("EACCES");
        return fs.exists(p);
      },
    };
    assert.equal(resolveExistingSmbPath(wanted, exp, fixture), "Z:\\E\\17N5OA~K\\PQK\\PQK mockup.jpg");
  });

  it("returns the original path when nested guesses exhaust the shared budget after a match", () => {
    const aliases = Array.from({ length: 8 }, (_, i) => `FOLDER~${i}`);
    const file = "Z:\\E\\FOLDER~0\\FOLDER~0\\x.jpg";
    const requested = 'Z:\\E\\12"\\14"\\x.jpg';
    let probes = 0;
    const fixture: SmbFs = {
      exists: (p) => p === "Z:\\E" || p === file,
      list: (p) => p.split("\\").length <= 3 ? aliases : [],
      stat: () => {
        probes++;
        return { size: 0, mtimeMs: 0, isDirectory: true };
      },
    };
    assert.equal(resolveExistingSmbPath(requested, exp, fixture), requested);
    assert.equal(probes, 64);
  });
});
