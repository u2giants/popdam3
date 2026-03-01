/**
 * TIFF Optimizer for the Windows Render Agent.
 *
 * - Scans the NAS for .tif/.tiff files
 * - Detects compression type using Sharp metadata
 * - Re-saves uncompressed TIFFs with ZIP lossless compression
 * - Preserves original Created/Modified timestamps
 *
 * Timestamp Preservation Rules (per PROJECT_BIBLE §7):
 *   1. Record original mtime + birthtime via stat() before touching the file
 *   2. After write, restore timestamps using utimes()
 *   3. If restoration fails, log error (file already saved at that point)
 */

import sharp from "sharp";
import path from "node:path";
import { stat, rename, unlink, utimes, readdir, lstat } from "node:fs/promises";
import { logger } from "./logger";

export interface TiffScanResult {
  relative_path: string;
  filename: string;
  file_size: number;
  file_modified_at: string;
  file_created_at: string | null;
  compression_type: string;
}

export interface TiffJobResult {
  success: boolean;
  new_file_size?: number;
  new_filename?: string;
  new_file_modified_at?: string;
  new_file_created_at?: string;
  original_backed_up?: boolean;
  original_deleted?: boolean;
  error?: string;
}

const TIFF_EXTENSIONS = new Set([".tif", ".tiff"]);

const EXCLUDED_DIR_PATTERNS = [
  /^___old$/i,
  /^__macosx$/i,
  /^\..*/,       // hidden dirs
  /^@eaDir$/,    // Synology metadata
];

// ── Compression type detection ──────────────────────────────────

/**
 * Map Sharp's TIFF compression values to human-readable names.
 * Sharp exposes: none, jpeg, deflate, packbits, lzw, webp, zstd, jp2k, ccittfax4
 * "deflate" in TIFF = ZIP compression
 */
function normalizeCompression(raw: string | undefined): string {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase();
  if (lower === "none" || lower === "uncompressed") return "none";
  if (lower === "deflate" || lower === "zip") return "zip";
  return lower; // lzw, packbits, jpeg, etc.
}

export async function detectTiffCompression(filePath: string): Promise<string> {
  try {
    const meta = await sharp(filePath).metadata();
    return normalizeCompression(meta.compression);
  } catch (e) {
    logger.warn("Failed to read TIFF metadata", { filePath, error: (e as Error).message });
    return "unknown";
  }
}

// ── Filesystem scanner for TIFFs ────────────────────────────────

export async function* scanTiffFiles(
  rootPath: string,
  mountRoot: string,
  callbacks?: {
    shouldAbort?: () => boolean;
    onProgress?: (dir: string) => void;
  }
): AsyncGenerator<TiffScanResult> {
  yield* walkDir(rootPath, mountRoot, callbacks);
}

async function* walkDir(
  dirPath: string,
  mountRoot: string,
  callbacks?: {
    shouldAbort?: () => boolean;
    onProgress?: (dir: string) => void;
  }
): AsyncGenerator<TiffScanResult> {
  if (callbacks?.shouldAbort?.()) return;

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
    callbacks?.onProgress?.(dirPath);
  } catch (e) {
    logger.warn("Cannot read directory for TIFF scan", { dirPath, error: (e as Error).message });
    return;
  }

  for (const entry of entries) {
    if (callbacks?.shouldAbort?.()) return;

    const fullPath = path.join(dirPath, entry.name);

    // Skip symlinks
    try {
      const ls = await lstat(fullPath);
      if (ls.isSymbolicLink()) continue;
    } catch { continue; }

    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_PATTERNS.some(p => p.test(entry.name))) continue;
      yield* walkDir(fullPath, mountRoot, callbacks);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!TIFF_EXTENSIONS.has(ext)) continue;

    try {
      const s = await stat(fullPath);

      // Build relative path from mount root
      let relPath = path.relative(mountRoot, fullPath);
      relPath = relPath.split("\\").join("/"); // POSIX
      if (relPath.startsWith("/")) relPath = relPath.slice(1);

      const compression = await detectTiffCompression(fullPath);

      yield {
        relative_path: relPath,
        filename: entry.name,
        file_size: s.size,
        file_modified_at: s.mtime.toISOString(),
        file_created_at: s.birthtime?.getFullYear() > 1970 ? s.birthtime.toISOString() : null,
        compression_type: compression,
      };
    } catch (e) {
      logger.warn("Failed to stat TIFF", { fullPath, error: (e as Error).message });
    }
  }
}

// ── TIFF Compression ────────────────────────────────────────────

export async function compressTiff(
  filePath: string,
  mode: "test" | "process",
  originalModifiedAt: Date,
  originalCreatedAt: Date | null,
): Promise<TiffJobResult> {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);

  // Record actual timestamps from disk before any changes
  let diskMtime: Date;
  let diskBirthtime: Date | null;
  try {
    const s = await stat(filePath);
    diskMtime = s.mtime;
    diskBirthtime = s.birthtime?.getFullYear() > 1970 ? s.birthtime : null;
  } catch (e) {
    return { success: false, error: `Cannot stat file: ${(e as Error).message}` };
  }

  // Use the timestamps from the DB (which were captured at scan time) as authoritative
  const targetMtime = originalModifiedAt;
  const targetAtime = diskMtime; // preserve access time from disk

  // Temp output path
  const tempPath = path.join(dir, `${base}_popdam_temp${ext}`);

  try {
    // Re-save with ZIP (deflate) compression
    await sharp(filePath)
      .tiff({ compression: "deflate", predictor: "horizontal" })
      .toFile(tempPath);

    // Get new file size
    const newStat = await stat(tempPath);
    const newSize = newStat.size;
    const origSize = (await stat(filePath)).size;

    if (mode === "test") {
      // Test mode: rename original to _big, rename temp to original name
      const bigPath = path.join(dir, `${base}_big${ext}`);
      await rename(filePath, bigPath);
      await rename(tempPath, filePath);

      // Restore timestamps on the new compressed file
      await restoreTimestamps(filePath, targetAtime, targetMtime);
      // Also preserve timestamps on the backed-up original
      await restoreTimestamps(bigPath, targetAtime, targetMtime);

      return {
        success: true,
        new_file_size: newSize,
        new_filename: path.basename(filePath),
        new_file_modified_at: targetMtime.toISOString(),
        new_file_created_at: originalCreatedAt?.toISOString() || null,
        original_backed_up: true,
        original_deleted: false,
      };
    } else {
      // Process mode: verify compressed is smaller, then replace
      if (newSize >= origSize) {
        // Compressed is not smaller — clean up and skip
        await unlink(tempPath).catch(() => {});
        return {
          success: true,
          new_file_size: origSize,
          new_filename: path.basename(filePath),
          new_file_modified_at: targetMtime.toISOString(),
          new_file_created_at: originalCreatedAt?.toISOString() || null,
          original_backed_up: false,
          original_deleted: false,
          error: "Compressed file not smaller than original — skipped",
        };
      }

      // Verify timestamps will be restored before deleting original
      await rename(filePath, filePath + ".popdam_backup");
      await rename(tempPath, filePath);

      // Restore timestamps
      const restored = await restoreTimestamps(filePath, targetAtime, targetMtime);
      if (!restored) {
        // Rollback: restore original
        await rename(filePath, tempPath).catch(() => {});
        await rename(filePath + ".popdam_backup", filePath).catch(() => {});
        return { success: false, error: "Timestamp restoration failed — rolled back" };
      }

      // Timestamps verified — delete backup
      await unlink(filePath + ".popdam_backup").catch(() => {});

      return {
        success: true,
        new_file_size: newSize,
        new_filename: path.basename(filePath),
        new_file_modified_at: targetMtime.toISOString(),
        new_file_created_at: originalCreatedAt?.toISOString() || null,
        original_backed_up: false,
        original_deleted: true,
      };
    }
  } catch (e) {
    // Cleanup temp file on error
    await unlink(tempPath).catch(() => {});
    return { success: false, error: (e as Error).message };
  }
}

// ── Delete the _big backup ──────────────────────────────────────

export async function deleteOriginalBackup(filePath: string): Promise<{ success: boolean; error?: string }> {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const bigPath = path.join(dir, `${base}_big${ext}`);

  try {
    await unlink(bigPath);
    return { success: true };
  } catch (e) {
    return { success: false, error: `Cannot delete backup: ${(e as Error).message}` };
  }
}

// ── Timestamp restoration ───────────────────────────────────────

async function restoreTimestamps(
  filePath: string,
  atime: Date,
  mtime: Date,
): Promise<boolean> {
  try {
    await utimes(filePath, atime, mtime);
    // Verify
    const s = await stat(filePath);
    const diff = Math.abs(s.mtime.getTime() - mtime.getTime());
    if (diff > 2000) { // allow 2s tolerance for filesystem precision
      logger.error("Timestamp restoration verification failed", {
        filePath,
        expected: mtime.toISOString(),
        actual: s.mtime.toISOString(),
        diffMs: diff,
      });
      return false;
    }
    return true;
  } catch (e) {
    logger.error("Failed to restore timestamps", {
      filePath,
      error: (e as Error).message,
    });
    return false;
  }
}
