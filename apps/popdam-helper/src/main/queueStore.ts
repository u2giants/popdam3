/**
 * Crash-safe JSON store for the upload queue.
 *
 * Writes go to a temp file that is validated, the previous good copy is kept
 * as `.bak`, and the temp file is renamed into place, so an interrupted write
 * never leaves a truncated primary file as the only copy. Reads distinguish
 * "no queue yet" from "unreadable queue": an unreadable primary falls back to
 * the backup (the bad copy is kept aside), and a queue that cannot be read at
 * all throws instead of looking empty — an empty-looking queue would be
 * overwritten by the next enqueue, losing every pending check-in.
 */

import { dirname } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, copyFileSync } from "fs";

export class QueueUnreadableError extends Error {}

function parseArray<T>(path: string): T[] {
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  if (!Array.isArray(parsed)) throw new Error(`queue file is not a list: ${path}`);
  return parsed as T[];
}

function isReadable(path: string): boolean {
  try {
    parseArray(path);
    return true;
  } catch {
    return false;
  }
}

export function readQueueFile<T>(path: string, onWarn: (msg: string) => void = () => {}): T[] {
  const backup = `${path}.bak`;
  if (!existsSync(path)) {
    if (existsSync(backup) && isReadable(backup)) {
      onWarn(`Upload queue missing; restoring from backup ${backup}`);
      return parseArray<T>(backup);
    }
    return [];
  }
  try {
    return parseArray<T>(path);
  } catch (primaryErr) {
    if (existsSync(backup) && isReadable(backup)) {
      const jobs = parseArray<T>(backup);
      const aside = `${path}.corrupt-${Date.now()}`;
      try {
        copyFileSync(path, aside);
      } catch {
        /* best effort */
      }
      onWarn(
        `Upload queue unreadable (${String(primaryErr)}); restored ${jobs.length} job(s) from backup, kept bad copy at ${aside}`,
      );
      return jobs;
    }
    throw new QueueUnreadableError(`Upload queue unreadable and no usable backup: ${String(primaryErr)}`);
  }
}

export function writeQueueFile<T>(path: string, jobs: T[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(jobs, null, 2), "utf-8");
  // Validate what landed on disk before it replaces anything.
  parseArray<T>(tmp);
  // Keep the last good copy so a damaged primary can be recovered.
  if (existsSync(path) && isReadable(path)) copyFileSync(path, `${path}.bak`);
  renameSync(tmp, path);
}
