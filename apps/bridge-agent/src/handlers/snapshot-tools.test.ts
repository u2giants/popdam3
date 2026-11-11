import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { readFileSync } from "node:fs";
import {
  MAX_VERSIONS,
  listSnapshotVersions,
  parseSnapshotTime,
  restoreFromSnapshot,
  restoredName,
} from "./snapshot-tools.js";

const S1 = "GMT-04-2026.05.29-18.15.01";
const S2 = "GMT-04-2026.06.30-18.15.01";
const S3 = "GMT-05-2026.11.10-10.15.01";

async function mount() {
  return mkdtemp(path.join(tmpdir(), "snap-"));
}
async function put(root: string, rel: string, body: string, mtime = new Date("2026-05-01T00:00:00Z")) {
  const full = path.join(root, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
  await utimes(full, mtime, mtime);
}
const sha = async (f: string) => createHash("sha256").update(await readFile(f)).digest("hex");

test("rejects snapshot names that are not GMT-stamped", async () => {
  const m = await mount();
  for (const snapshot of ["../../etc", `${S1}/..`, "", "x".repeat(300), "GMT-04-2026.05.29"]) {
    await assert.rejects(
      restoreFromSnapshot(m, { snapshot, source_path: "a/f.psd", destination_dir: "a" }, 0),
      /Invalid snapshot name/,
    );
  }
});

test("rejects unsafe source paths", async () => {
  const m = await mount();
  for (const source_path of ["/etc/passwd", "a/../../x", "a\0b", "C:\\x", "\\\\host\\share\\x", ""]) {
    await assert.rejects(restoreFromSnapshot(m, { snapshot: S1, source_path, destination_dir: "a" }, 0), /Unsafe path/);
  }
  await assert.rejects(restoreFromSnapshot(m, { snapshot: S1, source_path: "a/f", destination_dir: "../x" }, 0), /Unsafe path/);
  // unsafe candidates are dropped from listing, never touched
  await mkdir(path.join(m, "#snapshot", S1), { recursive: true });
  assert.deepEqual(await listSnapshotVersions(m, ["../outside", "/abs"]), []);
});

test("snapshot timestamp parsed with its GMT offset", () => {
  assert.equal(parseSnapshotTime(S1), "2026-05-29T22:15:01.000Z");
  assert.equal(parseSnapshotTime("GMT+02-2026.01.01-01.00.00"), "2025-12-31T23:00:00.000Z");
});

test("versions are collapsed when size+mtime are identical; old folder names found", async () => {
  const m = await mount();
  await put(m, `#snapshot/${S1}/Old Name/f.psd`, "v1");
  await put(m, `#snapshot/${S2}/Old Name/f.psd`, "v1");
  await put(m, `#snapshot/${S3}/New/f.psd`, "v2-longer", new Date("2026-11-01T00:00:00Z"));
  await mkdir(path.join(m, "#snapshot", "not-a-snapshot"), { recursive: true });
  const v = await listSnapshotVersions(m, ["New/f.psd", "Old Name/f.psd"]);
  assert.equal(v.length, 2);
  assert.deepEqual([v[0].source_path, v[0].first_snapshot, v[0].last_snapshot, v[0].snapshot_count], ["Old Name/f.psd", S1, S2, 2]);
  assert.deepEqual([v[1].source_path, v[1].size], ["New/f.psd", 9]);
});

test("cap of 200 respected", async () => {
  const m = await mount();
  for (let i = 0; i < MAX_VERSIONS + 5; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 3600_000);
    const p = (n: number) => String(n).padStart(2, "0");
    const name = `GMT+00-${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}-${p(d.getUTCHours())}.00.00`;
    await put(m, `#snapshot/${name}/a/f.psd`, "x".repeat(i + 1));
  }
  const v = await listSnapshotVersions(m, ["a/f.psd"]);
  assert.equal(v.length, MAX_VERSIONS);
  assert.equal(v[v.length - 1].size, MAX_VERSIONS + 5);
});

test("only regular files are listed or restored", async () => {
  const m = await mount();
  await put(m, "a/real.psd", "secret");
  await mkdir(path.join(m, "#snapshot", S1, "a", "dir.psd"), { recursive: true });
  await symlink(path.join(m, "a/real.psd"), path.join(m, "#snapshot", S1, "a", "link.psd"));
  assert.deepEqual(await listSnapshotVersions(m, ["a/dir.psd", "a/link.psd"]), []);
  for (const source_path of ["a/dir.psd", "a/link.psd"]) {
    await assert.rejects(restoreFromSnapshot(m, { snapshot: S1, source_path, destination_dir: "a" }, 0), /not a regular file/);
  }
});

test("never overwrites an existing file", async () => {
  const m = await mount();
  await put(m, `#snapshot/${S1}/a/f.psd`, "old");
  await put(m, "a/f.psd", "current");
  await put(m, `a/${restoredName("f.psd", S1, 1)}`, "earlier restore");
  const r = await restoreFromSnapshot(m, { snapshot: S1, source_path: "a/f.psd", destination_dir: "a" }, 0);
  assert.equal(r.restored_relative_path, "a/f (restored 2026-05-29 2).psd");
  assert.equal(await readFile(path.join(m, "a/f (restored 2026-05-29).psd"), "utf8"), "earlier restore");
  assert.equal(await readFile(path.join(m, r.restored_relative_path), "utf8"), "old");
});

test("current file is byte-identical after restore", async () => {
  const m = await mount();
  await put(m, `#snapshot/${S1}/a/f.psd`, "old bytes");
  await put(m, "a/f.psd", "current bytes");
  const before = [await sha(path.join(m, "a/f.psd")), (await stat(path.join(m, "a/f.psd"))).mtimeMs];
  const r = await restoreFromSnapshot(m, { snapshot: S1, source_path: "a/f.psd", destination_dir: "a" }, 0);
  assert.deepEqual([await sha(path.join(m, "a/f.psd")), (await stat(path.join(m, "a/f.psd"))).mtimeMs], before);
  const restored = await stat(path.join(m, r.restored_relative_path));
  assert.equal(restored.mtime.toISOString(), "2026-05-01T00:00:00.000Z");
  assert.equal(r.size, 9);
});

test("cleans up a failed copy", async () => {
  const m = await mount();
  await put(m, `#snapshot/${S1}/a/f.psd`, "x");
  await mkdir(path.join(m, "a"), { recursive: true });
  // source vanished
  await assert.rejects(restoreFromSnapshot(m, { snapshot: S1, source_path: "a/missing.psd", destination_dir: "a" }, 0));
  // not enough free space: refused before any write
  await assert.rejects(
    restoreFromSnapshot(m, { snapshot: S1, source_path: "a/f.psd", destination_dir: "a" }, Number.MAX_SAFE_INTEGER),
    /free space/,
  );
  // destination folder gone: no folder tree is created
  await assert.rejects(restoreFromSnapshot(m, { snapshot: S1, source_path: "a/f.psd", destination_dir: "gone" }, 0), /no longer exists/);
  assert.deepEqual(await readdir(path.join(m, "a")), []);
});

test("handles special characters in names", async () => {
  const m = await mount();
  const dir = "Décor/____New_% 'x\"/#1 ";
  const file = `${dir}/50% off_ "Tag" ü .psd`;
  await put(m, `#snapshot/${S1}/${file}`, "old");
  await put(m, file, "new");
  const v = await listSnapshotVersions(m, [file]);
  assert.equal(v.length, 1);
  const r = await restoreFromSnapshot(m, { snapshot: S1, source_path: file, destination_dir: dir }, 0);
  assert.equal(r.restored_relative_path, `${dir}/50% off_ "Tag" ü  (restored 2026-05-29).psd`);
  assert.equal(await readFile(path.join(m, r.restored_relative_path), "utf8"), "old");
});

test("snapshot handler does not widen scan exclusions", () => {
  for (const f of ["../../../../packages/path-filters/index.ts", "../../../../packages/agent-common/src/ingestion-rules.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf-8");
    assert.match(src, /#snapshot/);
  }
});
