import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  assertSafeFilename,
  assertSafeRelativePath,
  resolveUnderRoot,
  resolveUnderRootFilename,
  PathContainmentError,
} from "./path-containment.js";

const bad = [
  "", "   ", "../etc/passwd", "a/../../b", "a\\..\\..\\b", "..", "a/..",
  "..\\..\\Startup\\x.bat", "../..", "a/../..",
  "/etc/passwd", "\\\\evil\\share\\x", "\\x", "C:\\Windows\\x", "C:x", "a\0b",
];

test("rejects traversal, absolute, UNC, drive and NUL paths", () => {
  for (const p of bad) {
    assert.throws(() => assertSafeRelativePath(p), PathContainmentError, `expected reject: ${JSON.stringify(p)}`);
    assert.throws(() => resolveUnderRoot("/mnt/nas", p, path.posix), PathContainmentError);
    assert.throws(() => resolveUnderRoot("\\\\nas\\share", p, path.win32), PathContainmentError);
  }
});

test("accepts normal relative paths (posix root)", () => {
  assert.equal(resolveUnderRoot("/mnt/nas", "Licensing/Disney/a b.pdf", path.posix), "/mnt/nas/Licensing/Disney/a b.pdf");
  assert.equal(resolveUnderRoot("/mnt/nas/", "x/..y/file..pdf", path.posix), "/mnt/nas/x/..y/file..pdf");
});

test("accepts normal relative paths (UNC and drive roots)", () => {
  assert.equal(resolveUnderRoot("\\\\nas\\share", "A/B/c.pdf", path.win32), "\\\\nas\\share\\A\\B\\c.pdf");
  assert.equal(resolveUnderRoot("Z:\\", "A\\c.tif", path.win32), "Z:\\A\\c.tif");
});

test("rejects empty root", () => {
  assert.throws(() => resolveUnderRoot("", "a.pdf", path.posix), PathContainmentError);
});

const badNames = [
  "..\\..\\Startup\\x.bat", "../Startup/x.bat", "a/b", "a\\b", "..", ".", "",
  "/etc/passwd", "\\\\evil\\share\\x", "C:\\x", "C:x", "a\0b",
];

test("rejects filenames containing path separators or traversal", () => {
  for (const n of badNames) {
    assert.throws(() => assertSafeFilename(n), PathContainmentError, `expected reject: ${JSON.stringify(n)}`);
    assert.throws(() => resolveUnderRootFilename("/mnt/nas", n, path.posix), PathContainmentError);
    assert.throws(() => resolveUnderRootFilename("Z:\\", n, path.win32), PathContainmentError);
  }
});

test("accepts bare filenames, including dots inside the name", () => {
  assert.equal(assertSafeFilename("x.bat"), undefined);
  assert.equal(assertSafeFilename("file..pdf"), undefined);
  assert.equal(resolveUnderRootFilename("/mnt/nas", "a b.pdf", path.posix), "/mnt/nas/a b.pdf");
  assert.equal(resolveUnderRootFilename("Z:\\", "c.tif", path.win32), "Z:\\c.tif");
});
