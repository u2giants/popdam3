import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, readdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { swapInCompressed } from "./tiff-optimizer";

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "tiff-swap-"));
  const filePath = path.join(dir, "art.tif");
  const tempPath = path.join(dir, "art.tmp.tif");
  const backupPath = filePath + ".popdam_backup";
  await writeFile(filePath, "ORIGINAL");
  await writeFile(tempPath, "COMPRESSED");
  return { dir, filePath, tempPath, backupPath };
}

test("failed second rename restores the original at its expected path (#1086)", async () => {
  const { dir, filePath, tempPath, backupPath } = await setup();
  try {
    let calls = 0;
    const flaky = async (a: string, b: string) => {
      calls++;
      if (calls === 2) throw new Error("EBUSY simulated");
      await rename(a, b);
    };
    await assert.rejects(swapInCompressed(filePath, backupPath, tempPath, flaky), /original restored/);
    assert.equal(await readFile(filePath, "utf8"), "ORIGINAL");
    assert.deepEqual(await readdir(dir), ["art.tif"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("successful swap installs compressed file and keeps backup", async () => {
  const { dir, filePath, tempPath, backupPath } = await setup();
  try {
    await swapInCompressed(filePath, backupPath, tempPath);
    assert.equal(await readFile(filePath, "utf8"), "COMPRESSED");
    assert.equal(await readFile(backupPath, "utf8"), "ORIGINAL");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("if restoring the original also fails, error names the backup path", async () => {
  const { dir, filePath, tempPath, backupPath } = await setup();
  try {
    let calls = 0;
    const flaky = async (a: string, b: string) => {
      calls++;
      if (calls >= 2) throw new Error("EPERM simulated");
      await rename(a, b);
    };
    await assert.rejects(
      swapInCompressed(filePath, backupPath, tempPath, flaky),
      (e: Error) => e.message.includes(backupPath),
    );
    assert.equal(await readFile(backupPath, "utf8"), "ORIGINAL");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
