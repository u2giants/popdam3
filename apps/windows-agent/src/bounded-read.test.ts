import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileWithinLimit } from "./bounded-read.js";

test("readFileWithinLimit returns contents at or under the cap", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bounded-read-"));
  try {
    const f = path.join(dir, "a.bin");
    await writeFile(f, Buffer.from("hello"));
    assert.equal((await readFileWithinLimit(f, 5))?.toString(), "hello");
    assert.equal((await readFileWithinLimit(f))?.toString(), "hello");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readFileWithinLimit returns null over the cap", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bounded-read-"));
  try {
    const f = path.join(dir, "big.bin");
    await writeFile(f, Buffer.alloc(10));
    assert.equal(await readFileWithinLimit(f, 9), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readFileWithinLimit rejects for a missing file", async () => {
  await assert.rejects(readFileWithinLimit(path.join(tmpdir(), "does-not-exist-232.bin")));
});
