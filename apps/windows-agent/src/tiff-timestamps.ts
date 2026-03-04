/**
 * TIFF Timestamp Preservation — Windows-specific.
 *
 * Captures, restores, and verifies file timestamps including:
 *   - mtime (modified time) via fs.utimes()
 *   - atime (access time) via fs.utimes()
 *   - Windows CreationTime via PowerShell Set-ItemProperty
 *
 * Per PROJECT_BIBLE §7 and WORKER_LOGIC §9:
 *   Timestamps are sacred for licensor compliance.
 *   Any restore failure triggers rollback and job failure.
 */

import { stat, utimes } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

// ── Error codes ─────────────────────────────────────────────────

export const TIMESTAMP_ERROR = {
  CAPTURE_FAILED: "TIMESTAMP_CAPTURE_FAILED",
  MTIME_RESTORE_FAILED: "MTIME_RESTORE_FAILED",
  ATIME_RESTORE_FAILED: "ATIME_RESTORE_FAILED",
  CREATION_RESTORE_FAILED: "CREATION_RESTORE_FAILED",
  MTIME_VERIFY_FAILED: "MTIME_VERIFY_FAILED",
  CREATION_VERIFY_FAILED: "CREATION_VERIFY_FAILED",
  ROLLBACK_FAILED: "ROLLBACK_FAILED",
} as const;

export type TimestampErrorCode = typeof TIMESTAMP_ERROR[keyof typeof TIMESTAMP_ERROR];

// ── Config (overridable via admin_config knobs) ─────────────────

export interface TimestampConfig {
  toleranceMs: number;       // TIFF_TIMESTAMP_TOLERANCE_MS (default 2000)
  maxRetries: number;        // TIFF_RESTORE_MAX_RETRIES (default 3)
  failOnCreationRestore: boolean; // TIFF_FAIL_ON_CREATION_RESTORE (default true)
}

export const DEFAULT_TIMESTAMP_CONFIG: TimestampConfig = {
  toleranceMs: 2000,
  maxRetries: 3,
  failOnCreationRestore: true,
};

let activeConfig: TimestampConfig = { ...DEFAULT_TIMESTAMP_CONFIG };

export function setTimestampConfig(cfg: Partial<TimestampConfig>) {
  activeConfig = { ...DEFAULT_TIMESTAMP_CONFIG, ...cfg };
}

export function getTimestampConfig(): TimestampConfig {
  return { ...activeConfig };
}

// ── Captured timestamp bundle ───────────────────────────────────

export interface CapturedTimestamps {
  atime: Date;
  mtime: Date;
  /** Windows CreationTime (birthtime from stat, or from PowerShell). null if unavailable. */
  creationTime: Date | null;
  /** Whether creationTime was read from PowerShell (authoritative on Windows) */
  creationTimeSource: "powershell" | "stat" | "unavailable";
}

// ── Restore result ──────────────────────────────────────────────

export interface TimestampRestoreResult {
  success: boolean;
  mtime_restored: boolean;
  creation_time_restored: boolean;
  error_code?: TimestampErrorCode;
  error_message?: string;
  verification_details?: {
    mtime_expected: string;
    mtime_actual: string;
    mtime_diff_ms: number;
    creation_expected: string | null;
    creation_actual: string | null;
    creation_diff_ms: number | null;
    attempts: number;
  };
}

// ── Capture ─────────────────────────────────────────────────────

/**
 * Capture all critical timestamps from a file before any modification.
 * On Windows, uses PowerShell to get authoritative CreationTimeUtc.
 */
export async function captureTimestamps(
  filePath: string,
  jobId?: string,
): Promise<CapturedTimestamps> {
  const s = await stat(filePath);
  const atime = s.atime;
  const mtime = s.mtime;

  // Try PowerShell for authoritative Windows CreationTime
  let creationTime: Date | null = null;
  let creationTimeSource: CapturedTimestamps["creationTimeSource"] = "unavailable";

  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        `(Get-Item -LiteralPath '${filePath.replace(/'/g, "''")}').CreationTimeUtc.ToString('o')`,
      ], { timeout: 10_000 });

      const parsed = new Date(stdout.trim());
      if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1970) {
        creationTime = parsed;
        creationTimeSource = "powershell";
      }
    } catch (e) {
      logger.debug("PowerShell CreationTime read failed, falling back to stat", {
        filePath, jobId, error: (e as Error).message,
      });
    }
  }

  // Fallback to stat birthtime
  if (!creationTime && s.birthtime && s.birthtime.getFullYear() > 1970) {
    creationTime = s.birthtime;
    creationTimeSource = "stat";
  }

  logger.debug("Timestamps captured", {
    jobId,
    filePath,
    atime: atime.toISOString(),
    mtime: mtime.toISOString(),
    creationTime: creationTime?.toISOString() ?? null,
    creationTimeSource,
  });

  return { atime, mtime, creationTime, creationTimeSource };
}

// ── Restore ─────────────────────────────────────────────────────

/**
 * Restore timestamps to a file with bounded retries and strict verification.
 * Returns a detailed result indicating what was restored and any failures.
 */
export async function restoreTimestamps(
  filePath: string,
  original: CapturedTimestamps,
  jobId?: string,
): Promise<TimestampRestoreResult> {
  const cfg = activeConfig;
  let lastAttemptDetails: TimestampRestoreResult["verification_details"] | undefined;

  for (let attempt = 1; attempt <= cfg.maxRetries; attempt++) {
    // Small backoff on retries
    if (attempt > 1) {
      await new Promise(r => setTimeout(r, 200 * (attempt - 1)));
    }

    // 1) Restore atime + mtime via utimes
    try {
      await utimes(filePath, original.atime, original.mtime);
    } catch (e) {
      logger.error("utimes() failed", { filePath, jobId, attempt, error: (e as Error).message });
      if (attempt === cfg.maxRetries) {
        return {
          success: false,
          mtime_restored: false,
          creation_time_restored: false,
          error_code: TIMESTAMP_ERROR.MTIME_RESTORE_FAILED,
          error_message: `utimes failed after ${cfg.maxRetries} attempts: ${(e as Error).message}`,
        };
      }
      continue;
    }

    // 2) Restore CreationTime on Windows via PowerShell
    let creationRestored = false;
    if (original.creationTime && process.platform === "win32") {
      try {
        const isoStr = original.creationTime.toISOString();
        await execFileAsync("powershell.exe", [
          "-NoProfile", "-NonInteractive", "-Command",
          `$item = Get-Item -LiteralPath '${filePath.replace(/'/g, "''")}'; ` +
          `$item.CreationTimeUtc = [DateTime]::Parse('${isoStr}')`,
        ], { timeout: 10_000 });
        creationRestored = true;
      } catch (e) {
        logger.warn("PowerShell CreationTime restore failed", {
          filePath, jobId, attempt, error: (e as Error).message,
        });
        if (attempt === cfg.maxRetries && cfg.failOnCreationRestore) {
          return {
            success: false,
            mtime_restored: true, // utimes succeeded above
            creation_time_restored: false,
            error_code: TIMESTAMP_ERROR.CREATION_RESTORE_FAILED,
            error_message: `CreationTime restore failed after ${cfg.maxRetries} attempts: ${(e as Error).message}`,
          };
        }
        if (attempt < cfg.maxRetries) continue;
      }
    } else {
      // No creation time to restore, or not on Windows
      creationRestored = true;
    }

    // 3) Verify all restored values
    const verification = await verifyTimestamps(filePath, original, jobId);
    lastAttemptDetails = { ...verification, attempts: attempt };

    if (verification.mtime_diff_ms > cfg.toleranceMs) {
      logger.warn("mtime verification failed", {
        filePath, jobId, attempt,
        expected: verification.mtime_expected,
        actual: verification.mtime_actual,
        diffMs: verification.mtime_diff_ms,
      });
      if (attempt === cfg.maxRetries) {
        return {
          success: false,
          mtime_restored: false,
          creation_time_restored: creationRestored,
          error_code: TIMESTAMP_ERROR.MTIME_VERIFY_FAILED,
          error_message: `mtime verification failed: expected ${verification.mtime_expected}, got ${verification.mtime_actual} (diff ${verification.mtime_diff_ms}ms)`,
          verification_details: lastAttemptDetails,
        };
      }
      continue;
    }

    if (
      original.creationTime &&
      cfg.failOnCreationRestore &&
      verification.creation_diff_ms !== null &&
      verification.creation_diff_ms > cfg.toleranceMs
    ) {
      logger.warn("CreationTime verification failed", {
        filePath, jobId, attempt,
        expected: verification.creation_expected,
        actual: verification.creation_actual,
        diffMs: verification.creation_diff_ms,
      });
      if (attempt === cfg.maxRetries) {
        return {
          success: false,
          mtime_restored: true,
          creation_time_restored: false,
          error_code: TIMESTAMP_ERROR.CREATION_VERIFY_FAILED,
          error_message: `CreationTime verification failed: expected ${verification.creation_expected}, got ${verification.creation_actual} (diff ${verification.creation_diff_ms}ms)`,
          verification_details: lastAttemptDetails,
        };
      }
      continue;
    }

    // All checks passed
    logger.debug("Timestamps restored and verified", {
      jobId, filePath, attempt,
      mtime_diff_ms: verification.mtime_diff_ms,
      creation_diff_ms: verification.creation_diff_ms,
    });

    return {
      success: true,
      mtime_restored: true,
      creation_time_restored: creationRestored,
      verification_details: lastAttemptDetails,
    };
  }

  // Should not reach here, but safety net
  return {
    success: false,
    mtime_restored: false,
    creation_time_restored: false,
    error_code: TIMESTAMP_ERROR.MTIME_RESTORE_FAILED,
    error_message: "Exhausted all retry attempts",
    verification_details: lastAttemptDetails,
  };
}

// ── Verification ────────────────────────────────────────────────

interface VerificationResult {
  mtime_expected: string;
  mtime_actual: string;
  mtime_diff_ms: number;
  creation_expected: string | null;
  creation_actual: string | null;
  creation_diff_ms: number | null;
}

async function verifyTimestamps(
  filePath: string,
  original: CapturedTimestamps,
  jobId?: string,
): Promise<VerificationResult> {
  const s = await stat(filePath);

  const mtimeDiff = Math.abs(s.mtime.getTime() - original.mtime.getTime());

  let creationActual: string | null = null;
  let creationDiff: number | null = null;

  if (original.creationTime && process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("powershell.exe", [
        "-NoProfile", "-NonInteractive", "-Command",
        `(Get-Item -LiteralPath '${filePath.replace(/'/g, "''")}').CreationTimeUtc.ToString('o')`,
      ], { timeout: 10_000 });
      const parsed = new Date(stdout.trim());
      if (!isNaN(parsed.getTime())) {
        creationActual = parsed.toISOString();
        creationDiff = Math.abs(parsed.getTime() - original.creationTime.getTime());
      }
    } catch (e) {
      logger.debug("CreationTime verification read failed", { filePath, jobId, error: (e as Error).message });
      // Treat as failure — can't verify means can't trust
      creationDiff = Infinity;
    }
  }

  return {
    mtime_expected: original.mtime.toISOString(),
    mtime_actual: s.mtime.toISOString(),
    mtime_diff_ms: mtimeDiff,
    creation_expected: original.creationTime?.toISOString() ?? null,
    creation_actual: creationActual,
    creation_diff_ms: creationDiff,
  };
}
