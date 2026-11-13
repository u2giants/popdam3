/**
 * Restore-from-snapshot helpers (u2giants/popdam3#963, Phase 2).
 *
 * Reads Synology btrfs snapshots under `{mount}/#snapshot/<GMT-stamped name>/`
 * through this narrow code path only — the scanner's `#snapshot` exclusion is
 * untouched. Every server-supplied path is re-validated here. Restores copy
 * BESIDE the current file with exclusive create: nothing is ever overwritten.
 */
import { constants, createReadStream } from "node:fs";
import { copyFile, lstat, readdir, stat, statfs, unlink, utimes } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { assertSafeRelativePath, resolveUnderRoot, resolveUnderRootFilename } from "../common/path-containment.js";

export const SNAPSHOT_NAME_RE = /^GMT[+-]\d{2}-\d{4}\.\d{2}\.\d{2}-\d{2}\.\d{2}\.\d{2}$/;
export const SNAPSHOT_DIR = "#snapshot";
export const MAX_VERSIONS = 200;
/** Refuse a restore that would leave less than this free on the volume. */
export const MIN_FREE_BYTES = 5 * 1024 ** 3;

export interface SnapshotVersion {
  source_path: string;
  size: number;
  mtime: string;
  first_snapshot: string;
  last_snapshot: string;
  first_taken_at: string;
  last_taken_at: string;
  snapshot_count: number;
}

export function assertSnapshotName(name: unknown): asserts name is string {
  if (typeof name !== "string" || !SNAPSHOT_NAME_RE.test(name)) {
    throw new Error("Invalid snapshot name");
  }
}

/** `GMT-04-2026.05.29-18.15.01` → ISO instant. The local time is at GMT-04. */
export function parseSnapshotTime(name: string): string {
  assertSnapshotName(name);
  const m = /^GMT([+-])(\d{2})-(\d{4})\.(\d{2})\.(\d{2})-(\d{2})\.(\d{2})\.(\d{2})$/.exec(name)!;
  const [, sign, off, y, mo, d, h, mi, s] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${sign}${off}:00`).toISOString();
}

async function listSnapshotNames(mountRoot: string): Promise<string[]> {
  const entries = await readdir(path.join(mountRoot, SNAPSHOT_DIR), { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && SNAPSHOT_NAME_RE.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => parseSnapshotTime(a).localeCompare(parseSnapshotTime(b)));
}

/** Regular-file lstat (no symlinks, no directories), or null. */
async function regularFile(full: string) {
  try {
    const s = await lstat(full);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

/**
 * Distinct versions of the file across all snapshots and candidate paths,
 * oldest first. Consecutive snapshots with identical size+mtime at the same
 * path collapse into one version.
 */
export async function listSnapshotVersions(mountRoot: string, candidates: string[]): Promise<SnapshotVersion[]> {
  const safe = candidates.filter((c) => {
    try {
      assertSafeRelativePath(c);
      return true;
    } catch {
      return false;
    }
  });
  const snapshots = await listSnapshotNames(mountRoot);
  const versions: SnapshotVersion[] = [];
  const open = new Map<string, SnapshotVersion>();
  for (const snap of snapshots) {
    const snapRoot = path.join(mountRoot, SNAPSHOT_DIR, snap);
    const taken = parseSnapshotTime(snap);
    for (const rel of safe) {
      const s = await regularFile(resolveUnderRoot(snapRoot, rel));
      const prev = open.get(rel);
      if (!s) {
        open.delete(rel);
        continue;
      }
      const mtime = s.mtime.toISOString();
      if (prev && prev.size === s.size && prev.mtime === mtime) {
        prev.last_snapshot = snap;
        prev.last_taken_at = taken;
        prev.snapshot_count++;
        continue;
      }
      const v: SnapshotVersion = {
        source_path: rel, size: s.size, mtime,
        first_snapshot: snap, last_snapshot: snap,
        first_taken_at: taken, last_taken_at: taken, snapshot_count: 1,
      };
      versions.push(v);
      open.set(rel, v);
    }
  }
  versions.sort((a, b) => a.first_taken_at.localeCompare(b.first_taken_at) || a.source_path.localeCompare(b.source_path));
  return versions.slice(-MAX_VERSIONS);
}

async function sha256(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

export interface RestoreRequest {
  snapshot: string;
  source_path: string;
  destination_dir: string;
}

export interface RestoreResult {
  restored_relative_path: string;
  size: number;
}

/** `name (restored 2026-05-29).ext`, then ` 2`, ` 3`, … */
export function restoredName(filename: string, snapshot: string, n: number): string {
  const day = parseSnapshotTime(snapshot).slice(0, 10);
  const ext = path.posix.extname(filename);
  const base = ext ? filename.slice(0, -ext.length) : filename;
  return `${base} (restored ${day}${n > 1 ? ` ${n}` : ""})${ext}`;
}

export async function restoreFromSnapshot(
  mountRoot: string,
  req: RestoreRequest,
  minFreeBytes = MIN_FREE_BYTES,
): Promise<RestoreResult> {
  assertSnapshotName(req.snapshot);
  assertSafeRelativePath(req.source_path);
  assertSafeRelativePath(req.destination_dir);

  const snapRoot = path.join(mountRoot, SNAPSHOT_DIR, req.snapshot);
  const src = resolveUnderRoot(snapRoot, req.source_path);
  const srcStat = await regularFile(src);
  if (!srcStat) throw new Error("Snapshot copy not found or not a regular file");

  const destDir = resolveUnderRoot(mountRoot, req.destination_dir);
  const destDirStat = await lstat(destDir).catch(() => null);
  if (!destDirStat?.isDirectory()) throw new Error("The file's current folder no longer exists");

  const fs = await statfs(destDir);
  if (fs.bavail * fs.bsize - srcStat.size < minFreeBytes) throw new Error("Not enough free space on the NAS");

  const filename = path.posix.basename(req.source_path);
  for (let n = 1; n < 1000; n++) {
    const name = restoredName(filename, req.snapshot, n);
    const dest = resolveUnderRootFilename(destDir, name);
    try {
      await copyFile(src, dest, constants.COPYFILE_EXCL);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") continue;
      await unlink(dest).catch(() => {});
      throw e;
    }
    try {
      await utimes(dest, srcStat.atime, srcStat.mtime);
      const d = await stat(dest);
      if (d.size !== srcStat.size || (await sha256(src)) !== (await sha256(dest))) {
        throw new Error("Restored copy does not match the snapshot copy");
      }
    } catch (e) {
      await unlink(dest).catch(() => {});
      throw e;
    }
    return { restored_relative_path: path.posix.join(req.destination_dir, name), size: srcStat.size };
  }
  throw new Error("Too many restored copies already exist");
}
