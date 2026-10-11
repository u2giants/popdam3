import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { assertSafeRelativePath, resolveUnderRoot, PathContainmentError } from "./path-containment";

const bad = [
  "", "   ", "../etc/passwd", "a/../../b", "a\\..\\..\\b", "..", "a/..",
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
