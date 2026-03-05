/**
 * Temp Janitor — automatic cleanup of stale temp files.
 *
 * The Windows Render Agent creates temp directories/files during rendering
 * (Sharp, Ghostscript, Inkscape, ImageMagick). On failures, restarts, or
 * file locks, these artifacts may not be cleaned up. Over time this can
 * consume tens of GB and crash the agent.
 *
 * This module:
 *   - Runs once at startup, then every JANITOR_INTERVAL_MS
 *   - Deletes only stale items (older than STALE_THRESHOLD_MS)
 *   - Targets known prefixes only (no unrelated temp files)
 *   - Logs a concise summary per run
 *   - Continues past locked/permission-denied files
 */

import { readdir, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "./logger";

// ── Configuration ───────────────────────────────────────────────

/** How often to run cleanup (default: 1 hour) */
const JANITOR_INTERVAL_MS = 60 * 60 * 1000;

/** Only delete items older than this (default: 24 hours) */
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/** Directory prefixes to clean (these are temp dirs created by renderer.ts) */
const DIR_PREFIXES = ["popdam-gs-", "popdam-ink-", "popdam-im-"];

/** File prefixes to clean (ImageMagick temp files) */
const FILE_PREFIXES = ["magick-"];

// ── Core logic ──────────────────────────────────────────────────

export interface JanitorResult {
  dirsRemoved: number;
  filesRemoved: number;
  failures: number;
  bytesFreed: number;
  durationMs: number;
}

function isTargetEntry(name: string, isDirectory: boolean): boolean {
  const lower = name.toLowerCase();
  if (isDirectory) {
    return DIR_PREFIXES.some((p) => lower.startsWith(p));
  }
  return FILE_PREFIXES.some((p) => lower.startsWith(p));
}

/**
 * Estimate size of a directory (non-recursive, top-level files only).
 * Best-effort — returns 0 on error.
 */
async function estimateDirSize(dirPath: string): Promise<number> {
  try {
    const entries = await readdir(dirPath);
    let total = 0;
    for (const entry of entries) {
      try {
        const s = await stat(path.join(dirPath, entry));
        total += s.size;
      } catch {
        /* skip unreadable entries */
      }
    }
    return total;
  } catch {
    return 0;
  }
}

export async function runJanitor(): Promise<JanitorResult> {
  const tempDir = tmpdir();
  const start = Date.now();
  const cutoff = start - STALE_THRESHOLD_MS;

  let dirsRemoved = 0;
  let filesRemoved = 0;
  let failures = 0;
  let bytesFreed = 0;

  logger.info("Janitor: starting temp cleanup", { tempDir });

  let entries: string[];
  try {
    entries = await readdir(tempDir);
  } catch (e) {
    logger.error("Janitor: cannot read temp directory", {
      tempDir,
      error: (e as Error).message,
    });
    return { dirsRemoved, filesRemoved, failures: 1, bytesFreed, durationMs: Date.now() - start };
  }

  for (const entry of entries) {
    const fullPath = path.join(tempDir, entry);

    let entryStat;
    try {
      entryStat = await stat(fullPath);
    } catch {
      // Entry disappeared between readdir and stat — skip
      continue;
    }

    const isDir = entryStat.isDirectory();
    if (!isTargetEntry(entry, isDir)) continue;

    // Check staleness using mtime
    const mtime = entryStat.mtimeMs;
    if (mtime > cutoff) continue; // Too recent — skip

    try {
      const size = isDir ? await estimateDirSize(fullPath) : entryStat.size;
      await rm(fullPath, { recursive: true, force: true });
      bytesFreed += size;
      if (isDir) {
        dirsRemoved++;
      } else {
        filesRemoved++;
      }
    } catch (e) {
      // Locked or permission denied — log and continue
      failures++;
      logger.debug("Janitor: could not remove entry", {
        path: fullPath,
        error: (e as Error).message,
      });
    }
  }

  const durationMs = Date.now() - start;
  const result: JanitorResult = { dirsRemoved, filesRemoved, failures, bytesFreed, durationMs };

  if (dirsRemoved + filesRemoved > 0 || failures > 0) {
    logger.info("Janitor: cleanup complete", {
      dirsRemoved,
      filesRemoved,
      failures,
      bytesFreedMB: (bytesFreed / (1024 * 1024)).toFixed(1),
      durationMs,
    });
  } else {
    logger.info("Janitor: nothing to clean", { durationMs });
  }

  return result;
}

// ── Lifecycle ───────────────────────────────────────────────────

let janitorTimer: ReturnType<typeof setTimeout> | null = null;

export function startJanitor(): void {
  // Run immediately at startup
  runJanitor().catch((e) =>
    logger.error("Janitor: startup run failed", { error: (e as Error).message })
  );

  // Then repeat on interval
  const loop = () => {
    janitorTimer = setTimeout(async () => {
      try {
        await runJanitor();
      } catch (e) {
        logger.error("Janitor: periodic run failed", { error: (e as Error).message });
      }
      loop();
    }, JANITOR_INTERVAL_MS);
  };
  loop();

  logger.info("Janitor: scheduled", {
    intervalMinutes: JANITOR_INTERVAL_MS / 60_000,
    staleThresholdHours: STALE_THRESHOLD_MS / (60 * 60 * 1000),
    dirPrefixes: DIR_PREFIXES,
    filePrefixes: FILE_PREFIXES,
  });
}

export function stopJanitor(): void {
  if (janitorTimer) {
    clearTimeout(janitorTimer);
    janitorTimer = null;
  }
}
