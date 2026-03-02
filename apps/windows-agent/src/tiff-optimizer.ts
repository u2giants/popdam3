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
import { stat, rename, unlink, utimes, readdir, lstat, open } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
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

const execFileAsync = promisify(execFile);

function findImageMagick(): string | null {
  if (process.env.IM_PATH) return process.env.IM_PATH;

  const candidates = [
    "C:\\Program Files\\ImageMagick-7.1.2-Q16-HDRI\\magick.exe",
    "C:\\Program Files\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe",
    "C:\\Program Files\\ImageMagick-7.1.0-Q16-HDRI\\magick.exe",
    "C:\\Program Files\\ImageMagick-7.1.0-Q16\\magick.exe",
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  try {
    execFileSync("magick", ["--version"], { timeout: 5000 });
    return "magick";
  } catch {
    return null;
  }
}

const IM_EXE = findImageMagick();

// ── TIFF Tag 259 binary parser ──────────────────────────────────

const COMPRESSION_TAG = 259;

const COMPRESSION_MAP: Record<number, string> = {
  1: "none",
  5: "lzw",
  7: "jpeg",
  8: "zip",        // Adobe-style deflate
  32946: "zip",    // PKZIP-style deflate
  32773: "packbits",
  4: "ccittfax4",
  3: "ccittfax3",
  6: "jpeg-old",
  34712: "jp2k",
  50000: "zstd",
};

/**
 * Read TIFF IFD tag 259 (Compression) directly from file bytes.
 * Handles classic TIFF (version 42). Falls back for BigTIFF (version 43).
 */
async function readTiffCompressionTag(filePath: string): Promise<string> {
  const fh = await open(filePath, "r");
  try {
    // Read first 64KB — enough for header + first IFD in normal TIFFs
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await fh.read(buf, 0, 65536, 0);
    if (bytesRead < 8) return "unknown";

    // Byte order
    const bo = buf.toString("ascii", 0, 2);
    const le = bo === "II";
    if (bo !== "II" && bo !== "MM") return "unknown";

    const r16 = le ? (o: number) => buf.readUInt16LE(o) : (o: number) => buf.readUInt16BE(o);
    const r32 = le ? (o: number) => buf.readUInt32LE(o) : (o: number) => buf.readUInt32BE(o);

    const version = r16(2);
    if (version === 43) return "unknown"; // BigTIFF — let IM handle it
    if (version !== 42) return "unknown";

    let ifdOffset = r32(4);
    if (ifdOffset === 0 || ifdOffset + 2 > bytesRead) return "unknown";

    const entryCount = r16(ifdOffset);
    const entriesStart = ifdOffset + 2;

    for (let i = 0; i < entryCount; i++) {
      const entryOff = entriesStart + i * 12;
      if (entryOff + 12 > bytesRead) break;

      const tag = r16(entryOff);
      if (tag !== COMPRESSION_TAG) continue;

      // Type 3 = SHORT (2 bytes), Type 4 = LONG (4 bytes)
      const type = r16(entryOff + 2);
      let value: number;
      if (type === 3) {
        value = r16(entryOff + 8); // SHORT value in first 2 bytes of value field
      } else {
        value = r32(entryOff + 8);
      }

      return COMPRESSION_MAP[value] ?? `other:${value}`;
    }

    return "unknown"; // tag 259 not found in first IFD
  } finally {
    await fh.close();
  }
}

// ── Rate-limited unknown logging ────────────────────────────────

let unknownLogCount = 0;
const MAX_UNKNOWN_LOGS = 5;

function logUnknownCompression(filePath: string, context: string) {
  if (unknownLogCount < MAX_UNKNOWN_LOGS) {
    unknownLogCount++;
    logger.warn(`TIFF compression unknown after all methods (${unknownLogCount}/${MAX_UNKNOWN_LOGS})`, {
      filePath,
      context,
    });
  }
}

/** Reset the unknown log counter (call at start of each scan session). */
export function resetUnknownLogCounter() {
  unknownLogCount = 0;
}

// ── Compression type detection (updated chain) ──────────────────

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

async function detectCompressionViaImageMagick(filePath: string): Promise<string | null> {
  if (!IM_EXE) return null;
  try {
    const { stdout } = await execFileAsync(IM_EXE, ["identify", "-format", "%[compression]", `${filePath}[0]`], {
      timeout: 15000,
    });
    const compression = normalizeCompression((stdout ?? "").toString().trim());
    return compression === "unknown" ? null : compression;
  } catch (e) {
    logger.debug("ImageMagick TIFF compression read failed", { filePath, error: (e as Error).message });
    return null;
  }
}

export async function detectTiffCompression(filePath: string): Promise<string> {
  // 1) Direct IFD tag 259 read (fastest, no external process)
  try {
    const tagResult = await readTiffCompressionTag(filePath);
    if (tagResult !== "unknown") return tagResult;
  } catch (e) {
    logger.debug("TIFF tag 259 read failed", { filePath, error: (e as Error).message });
  }

  // 2) ImageMagick fallback (handles BigTIFF, exotic formats)
  const imResult = await detectCompressionViaImageMagick(filePath);
  if (imResult) return imResult;

  // 3) Sharp metadata (last resort)
  try {
    const meta = await sharp(filePath).metadata();
    const sharpResult = normalizeCompression(meta.compression);
    if (sharpResult !== "unknown") return sharpResult;
  } catch (e) {
    logger.debug("Sharp TIFF metadata failed", { filePath, error: (e as Error).message });
  }

  // All methods failed — log (rate-limited)
  logUnknownCompression(filePath, "tag259+IM+sharp all failed");
  return "unknown";
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
        new_file_created_at: originalCreatedAt?.toISOString() ?? undefined,
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
          new_file_created_at: originalCreatedAt?.toISOString() ?? undefined,
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
        new_file_created_at: originalCreatedAt?.toISOString() ?? undefined,
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
