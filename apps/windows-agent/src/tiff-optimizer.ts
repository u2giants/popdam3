/**
 * TIFF Optimizer for the Windows Render Agent.
 *
 * Responsibilities:
 *   - Scan NAS for .tif/.tiff files and detect compression type
 *   - Compress uncompressed TIFFs with ZIP (deflate) lossless compression
 *   - Bulletproof timestamp preservation (mtime + CreationTime) with strict rollback
 *
 * Timestamp Preservation Rules (per PROJECT_BIBLE §7, WORKER_LOGIC §9):
 *   1. Capture atime, mtime, and Windows CreationTime before touching the file
 *   2. After write, restore all timestamps with bounded retries
 *   3. Verify restoration against originals within configurable tolerance
 *   4. If any verification fails: rollback file swap and report failure
 *   5. NEVER return success if timestamp restoration is unverified
 */

import sharp from "sharp";
import path from "node:path";
import { stat, rename, unlink, readdir, lstat, open } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "./logger";
import {
  captureTimestamps,
  restoreTimestamps,
  TIMESTAMP_ERROR,
  type CapturedTimestamps,
  type TimestampRestoreResult,
  type TimestampErrorCode,
} from "./tiff-timestamps";
import { shouldSkipFolder, shouldSkipPath } from "@popdam/path-filters";

export { setTimestampConfig, getTimestampConfig, DEFAULT_TIMESTAMP_CONFIG } from "./tiff-timestamps";

// ── Result types ────────────────────────────────────────────────

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
  error_code?: TimestampErrorCode | string;
  /** Extended timestamp audit fields */
  timestamp_restore_status?: "verified" | "failed" | "skipped";
  creation_time_restored?: boolean;
  mtime_restored?: boolean;
  verification_details?: TimestampRestoreResult["verification_details"];
}

// ── Constants ───────────────────────────────────────────────────

const TIFF_EXTENSIONS = new Set([".tif", ".tiff"]);

const execFileAsync = promisify(execFile);

// ── ImageMagick discovery ───────────────────────────────────────

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
  8: "zip",
  32946: "zip",
  32773: "packbits",
  4: "ccittfax4",
  3: "ccittfax3",
  6: "jpeg-old",
  34712: "jp2k",
  50000: "zstd",
};

async function readTiffCompressionTag(filePath: string): Promise<string> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(65536);
    const { bytesRead } = await fh.read(buf, 0, 65536, 0);
    if (bytesRead < 8) return "unknown";

    const bo = buf.toString("ascii", 0, 2);
    const le = bo === "II";
    if (bo !== "II" && bo !== "MM") return "unknown";

    const r16 = le ? (o: number) => buf.readUInt16LE(o) : (o: number) => buf.readUInt16BE(o);
    const r32 = le ? (o: number) => buf.readUInt32LE(o) : (o: number) => buf.readUInt32BE(o);

    const version = r16(2);
    if (version === 43) return "unknown"; // BigTIFF
    if (version !== 42) return "unknown";

    const ifdOffset = r32(4);
    if (ifdOffset === 0 || ifdOffset + 2 > bytesRead) return "unknown";

    const entryCount = r16(ifdOffset);
    const entriesStart = ifdOffset + 2;

    for (let i = 0; i < entryCount; i++) {
      const entryOff = entriesStart + i * 12;
      if (entryOff + 12 > bytesRead) break;

      const tag = r16(entryOff);
      if (tag !== COMPRESSION_TAG) continue;

      const type = r16(entryOff + 2);
      let value: number;
      if (type === 3) {
        value = r16(entryOff + 8);
      } else {
        value = r32(entryOff + 8);
      }

      return COMPRESSION_MAP[value] ?? `other:${value}`;
    }

    return "unknown";
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
      filePath, context,
    });
  }
}

export function resetUnknownLogCounter() {
  unknownLogCount = 0;
}

// ── Compression detection ───────────────────────────────────────

function normalizeCompression(raw: string | undefined): string {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase();
  if (lower === "none" || lower === "uncompressed") return "none";
  if (lower === "deflate" || lower === "zip") return "zip";
  return lower;
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
  try {
    const tagResult = await readTiffCompressionTag(filePath);
    if (tagResult !== "unknown") return tagResult;
  } catch (e) {
    logger.debug("TIFF tag 259 read failed", { filePath, error: (e as Error).message });
  }

  const imResult = await detectCompressionViaImageMagick(filePath);
  if (imResult) return imResult;

  try {
    const meta = await sharp(filePath).metadata();
    const sharpResult = normalizeCompression(meta.compression);
    if (sharpResult !== "unknown") return sharpResult;
  } catch (e) {
    logger.debug("Sharp TIFF metadata failed", { filePath, error: (e as Error).message });
  }

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

    try {
      const ls = await lstat(fullPath);
      if (ls.isSymbolicLink()) continue;
    } catch { continue; }

    if (entry.isDirectory()) {
      if (shouldSkipFolder(entry.name)) continue;
      yield* walkDir(fullPath, mountRoot, callbacks);
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!TIFF_EXTENSIONS.has(ext)) continue;

    try {
      const s = await stat(fullPath);

      let relPath = path.relative(mountRoot, fullPath);
      relPath = relPath.split("\\").join("/");
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

/**
 * Compress a TIFF with ZIP (deflate).
 *
 * Timestamp guarantees:
 *   - Captures mtime + atime + Windows CreationTime BEFORE any file operation
 *   - Restores ALL timestamps after file swap with bounded retries
 *   - Verifies restoration within configurable tolerance
 *   - On ANY verification failure: rolls back to original file and returns failure
 *   - NEVER returns success unless timestamps are verified
 */
export async function compressTiff(
  filePath: string,
  mode: "test" | "process",
  originalModifiedAt: Date,
  originalCreatedAt: Date | null,
  jobId?: string,
): Promise<TiffJobResult> {
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const tempPath = path.join(dir, `${base}_popdam_temp${ext}`);

  // ── Step 1: Capture all timestamps from disk ──
  let captured: CapturedTimestamps;
  try {
    captured = await captureTimestamps(filePath, jobId);
  } catch (e) {
    return {
      success: false,
      error: `Timestamp capture failed: ${(e as Error).message}`,
      error_code: TIMESTAMP_ERROR.CAPTURE_FAILED,
      timestamp_restore_status: "skipped",
      mtime_restored: false,
      creation_time_restored: false,
    };
  }

  // Use DB-provided mtime as authoritative target (per PROJECT_BIBLE §7)
  const targetTimestamps: CapturedTimestamps = {
    atime: captured.atime,
    mtime: originalModifiedAt,
    creationTime: originalCreatedAt ?? captured.creationTime,
    creationTimeSource: captured.creationTimeSource,
  };

  // ── Step 2: Compress the TIFF ──
  try {
    let compressedVia = "sharp";
    try {
      await sharp(filePath)
        .tiff({ compression: "deflate", predictor: "horizontal" })
        .toFile(tempPath);
    } catch (sharpErr) {
      const msg = (sharpErr as Error).message || "";
      logger.warn("Sharp TIFF write failed, trying ImageMagick fallback", { filePath, jobId, error: msg });

      await unlink(tempPath).catch(() => {});

      if (!IM_EXE) {
        return {
          success: false,
          error: `Sharp failed (${msg}) and ImageMagick is not available for fallback`,
          timestamp_restore_status: "skipped",
          mtime_restored: false,
          creation_time_restored: false,
        };
      }

      try {
        await execFileAsync(
          IM_EXE,
          ["convert", `${filePath}[0]`, "-compress", "zip", tempPath],
          { timeout: 120_000 },
        );
        compressedVia = "imagemagick";
      } catch (imErr) {
        await unlink(tempPath).catch(() => {});
        return {
          success: false,
          error: `Sharp failed (${msg}); ImageMagick also failed: ${(imErr as Error).message}`,
          timestamp_restore_status: "skipped",
          mtime_restored: false,
          creation_time_restored: false,
        };
      }
    }

    logger.debug(`TIFF compressed via ${compressedVia}`, { filePath, jobId });

    const newStat = await stat(tempPath);
    const newSize = newStat.size;
    const origSize = (await stat(filePath)).size;

    // ── Step 3: File swap + timestamp restore ──
    if (mode === "test") {
      return await handleTestMode(filePath, tempPath, dir, base, ext, targetTimestamps, newSize, jobId);
    } else {
      return await handleProcessMode(filePath, tempPath, targetTimestamps, newSize, origSize, jobId);
    }
  } catch (e) {
    await unlink(tempPath).catch(() => {});
    return {
      success: false,
      error: (e as Error).message,
      timestamp_restore_status: "skipped",
      mtime_restored: false,
      creation_time_restored: false,
    };
  }
}

// ── Test mode: keep _big backup, strict timestamp verification ──

async function handleTestMode(
  filePath: string,
  tempPath: string,
  dir: string,
  base: string,
  ext: string,
  timestamps: CapturedTimestamps,
  newSize: number,
  jobId?: string,
): Promise<TiffJobResult> {
  const bigPath = path.join(dir, `${base}_big${ext}`);

  await rename(filePath, bigPath);
  await rename(tempPath, filePath);

  // Restore timestamps on BOTH files
  const compressedRestore = await restoreTimestamps(filePath, timestamps, jobId);
  const backupRestore = await restoreTimestamps(bigPath, timestamps, jobId);

  if (!compressedRestore.success) {
    // Rollback: restore original file
    logger.error("Test mode: timestamp restore failed on compressed file — rolling back", {
      jobId, filePath, error_code: compressedRestore.error_code,
    });
    await safeRollback(filePath, bigPath, tempPath);
    return {
      success: false,
      error: `Test mode timestamp restore failed: ${compressedRestore.error_message}`,
      error_code: compressedRestore.error_code,
      timestamp_restore_status: "failed",
      mtime_restored: compressedRestore.mtime_restored,
      creation_time_restored: compressedRestore.creation_time_restored,
      verification_details: compressedRestore.verification_details,
    };
  }

  if (!backupRestore.success) {
    logger.warn("Test mode: timestamp restore failed on backup file (non-fatal for result)", {
      jobId, bigPath, error_code: backupRestore.error_code,
    });
  }

  return {
    success: true,
    new_file_size: newSize,
    new_filename: path.basename(filePath),
    new_file_modified_at: timestamps.mtime.toISOString(),
    new_file_created_at: timestamps.creationTime?.toISOString() ?? undefined,
    original_backed_up: true,
    original_deleted: false,
    timestamp_restore_status: "verified",
    mtime_restored: compressedRestore.mtime_restored,
    creation_time_restored: compressedRestore.creation_time_restored,
    verification_details: compressedRestore.verification_details,
  };
}

// ── Process mode: atomic swap with strict rollback ──────────────

async function handleProcessMode(
  filePath: string,
  tempPath: string,
  timestamps: CapturedTimestamps,
  newSize: number,
  origSize: number,
  jobId?: string,
): Promise<TiffJobResult> {
  // Skip if compressed file isn't smaller
  if (newSize >= origSize) {
    await unlink(tempPath).catch(() => {});
    return {
      success: true,
      new_file_size: origSize,
      new_filename: path.basename(filePath),
      new_file_modified_at: timestamps.mtime.toISOString(),
      new_file_created_at: timestamps.creationTime?.toISOString() ?? undefined,
      original_backed_up: false,
      original_deleted: false,
      error: "Compressed file not smaller than original — skipped",
      timestamp_restore_status: "skipped",
      mtime_restored: false,
      creation_time_restored: false,
    };
  }

  const backupPath = filePath + ".popdam_backup";

  // Create backup
  await rename(filePath, backupPath);

  // Verify backup exists before proceeding
  try {
    await stat(backupPath);
  } catch {
    // Backup creation failed — try to restore
    await rename(backupPath, filePath).catch(() => {});
    return {
      success: false,
      error: "Backup creation failed — backup file not found after rename",
      timestamp_restore_status: "skipped",
      mtime_restored: false,
      creation_time_restored: false,
    };
  }

  // Swap in compressed file
  await rename(tempPath, filePath);

  // Restore timestamps with strict verification
  const restoreResult = await restoreTimestamps(filePath, timestamps, jobId);

  if (!restoreResult.success) {
    // CRITICAL: Rollback — put original back
    logger.error("Process mode: timestamp restore FAILED — initiating rollback", {
      jobId, filePath,
      error_code: restoreResult.error_code,
      error_message: restoreResult.error_message,
    });

    const rollbackOk = await atomicRollback(filePath, backupPath, jobId);
    if (!rollbackOk) {
      return {
        success: false,
        error: `Timestamp restore failed AND rollback failed — MANUAL INTERVENTION REQUIRED. ${restoreResult.error_message}`,
        error_code: TIMESTAMP_ERROR.ROLLBACK_FAILED,
        timestamp_restore_status: "failed",
        mtime_restored: restoreResult.mtime_restored,
        creation_time_restored: restoreResult.creation_time_restored,
        verification_details: restoreResult.verification_details,
      };
    }

    return {
      success: false,
      error: `Timestamp restore failed, rolled back to original: ${restoreResult.error_message}`,
      error_code: restoreResult.error_code,
      timestamp_restore_status: "failed",
      mtime_restored: restoreResult.mtime_restored,
      creation_time_restored: restoreResult.creation_time_restored,
      verification_details: restoreResult.verification_details,
    };
  }

  // Timestamps verified — safe to delete backup
  await unlink(backupPath).catch((e) => {
    logger.warn("Failed to delete backup after successful compression", {
      jobId, backupPath, error: (e as Error).message,
    });
  });

  logger.info("TIFF compression + timestamp restore verified", {
    jobId, filePath,
    origSize, newSize,
    savings: `${((1 - newSize / origSize) * 100).toFixed(1)}%`,
    mtime_restored: restoreResult.mtime_restored,
    creation_time_restored: restoreResult.creation_time_restored,
  });

  return {
    success: true,
    new_file_size: newSize,
    new_filename: path.basename(filePath),
    new_file_modified_at: timestamps.mtime.toISOString(),
    new_file_created_at: timestamps.creationTime?.toISOString() ?? undefined,
    original_backed_up: false,
    original_deleted: true,
    timestamp_restore_status: "verified",
    mtime_restored: restoreResult.mtime_restored,
    creation_time_restored: restoreResult.creation_time_restored,
    verification_details: restoreResult.verification_details,
  };
}

// ── Rollback helpers ────────────────────────────────────────────

/** Rollback for process mode: put backup back as original */
async function atomicRollback(
  currentPath: string,
  backupPath: string,
  jobId?: string,
): Promise<boolean> {
  try {
    // Remove the bad compressed file
    await unlink(currentPath).catch(() => {});
    // Restore backup as original
    await rename(backupPath, currentPath);
    // Verify original is back
    await stat(currentPath);
    logger.info("Rollback successful — original file restored", { jobId, currentPath });
    return true;
  } catch (e) {
    logger.error("ROLLBACK FAILED — manual intervention required", {
      jobId, currentPath, backupPath, error: (e as Error).message,
    });
    return false;
  }
}

/** Rollback for test mode: put original back from _big */
async function safeRollback(
  currentPath: string,
  bigPath: string,
  _tempPath: string,
): Promise<void> {
  try {
    await unlink(currentPath).catch(() => {});
    await rename(bigPath, currentPath);
  } catch (e) {
    logger.error("Test mode rollback failed", { currentPath, bigPath, error: (e as Error).message });
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
