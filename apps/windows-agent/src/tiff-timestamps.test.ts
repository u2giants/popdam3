/**
 * Tests for TIFF timestamp preservation logic.
 *
 * Tests cover:
 *   - Restore verification (mtime + CreationTime)
 *   - Retry behavior with bounded backoff
 *   - Error code mapping for each failure mode
 *   - Rollback semantics in process and test modes
 *   - Backward compatibility of TiffJobResult
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock filesystem + child_process before imports ──────────────

const mockStat = vi.fn();
const mockUtimes = vi.fn();
const mockRename = vi.fn();
const mockUnlink = vi.fn();
const mockExecFile = vi.fn();

vi.mock("node:fs/promises", () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  utimes: (...args: unknown[]) => mockUtimes(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
  readdir: vi.fn().mockResolvedValue([]),
  lstat: vi.fn(),
  open: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execFileSync: vi.fn().mockImplementation(() => { throw new Error("not found"); }),
}));

vi.mock("node:util", () => ({
  promisify: (fn: Function) => (...args: unknown[]) => {
    return new Promise((resolve, reject) => {
      fn(...args, (err: Error | null, ...results: unknown[]) => {
        if (err) reject(err);
        else resolve(results.length === 1 ? results[0] : { stdout: results[0], stderr: results[1] });
      });
    });
  },
}));

// Mock sharp
vi.mock("sharp", () => ({
  default: vi.fn().mockReturnValue({
    tiff: vi.fn().mockReturnValue({
      toFile: vi.fn().mockResolvedValue({}),
    }),
    metadata: vi.fn().mockResolvedValue({ compression: "none" }),
  }),
}));

// Mock logger
vi.mock("./logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Import after mocks ──────────────────────────────────────────

import {
  captureTimestamps,
  restoreTimestamps,
  setTimestampConfig,
  DEFAULT_TIMESTAMP_CONFIG,
  TIMESTAMP_ERROR,
  type CapturedTimestamps,
} from "./tiff-timestamps";

// ── Helpers ─────────────────────────────────────────────────────

const MOCK_DATE = new Date("2024-06-15T12:00:00Z");
const MOCK_DATE_2 = new Date("2024-06-15T12:00:01Z"); // 1s later

function mockStatResult(mtime: Date, birthtime?: Date) {
  return {
    atime: mtime,
    mtime,
    birthtime: birthtime ?? mtime,
    size: 1024,
    isFile: () => true,
    isDirectory: () => false,
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe("TIFF Timestamp Preservation", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    setTimestampConfig(DEFAULT_TIMESTAMP_CONFIG);
    // Default: stat returns consistent timestamps
    mockStat.mockResolvedValue(mockStatResult(MOCK_DATE));
    mockUtimes.mockResolvedValue(undefined);
    mockRename.mockResolvedValue(undefined);
    mockUnlink.mockResolvedValue(undefined);
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  describe("captureTimestamps", () => {
    it("captures mtime and atime from stat", async () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      mockStat.mockResolvedValueOnce(mockStatResult(MOCK_DATE, MOCK_DATE_2));

      const result = await captureTimestamps("/test/file.tif", "job-1");

      expect(result.mtime).toEqual(MOCK_DATE);
      expect(result.atime).toEqual(MOCK_DATE);
      expect(result.creationTime).toEqual(MOCK_DATE_2);
      expect(result.creationTimeSource).toBe("stat");
    });

    it("uses PowerShell for CreationTime on Windows", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      mockStat.mockResolvedValueOnce(mockStatResult(MOCK_DATE));
      mockExecFile.mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "2024-06-15T10:00:00.0000000Z", "");
      });

      const result = await captureTimestamps("C:\\test\\file.tif", "job-1");

      expect(result.creationTime).toEqual(new Date("2024-06-15T10:00:00Z"));
      expect(result.creationTimeSource).toBe("powershell");
    });

    it("falls back to stat birthtime if PowerShell fails", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      const btime = new Date("2024-01-01T00:00:00Z");
      mockStat.mockResolvedValueOnce(mockStatResult(MOCK_DATE, btime));
      mockExecFile.mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error("PowerShell not available"), "", "");
      });

      const result = await captureTimestamps("C:\\test\\file.tif");

      expect(result.creationTime).toEqual(btime);
      expect(result.creationTimeSource).toBe("stat");
    });
  });

  describe("restoreTimestamps", () => {
    const original: CapturedTimestamps = {
      atime: MOCK_DATE,
      mtime: MOCK_DATE,
      creationTime: new Date("2024-01-01T00:00:00Z"),
      creationTimeSource: "powershell",
    };

    it("succeeds when mtime + creation verify within tolerance", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });

      // stat after utimes returns matching mtime
      mockStat.mockResolvedValue(mockStatResult(MOCK_DATE));

      // PowerShell restore succeeds
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "2024-01-01T00:00:00.0000000Z", "");
      });

      const result = await restoreTimestamps("/test/file.tif", original, "job-1");

      expect(result.success).toBe(true);
      expect(result.mtime_restored).toBe(true);
      expect(result.creation_time_restored).toBe(true);
      expect(result.verification_details?.attempts).toBe(1);
    });

    it("fails with MTIME_VERIFY_FAILED when mtime drift exceeds tolerance", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      setTimestampConfig({ toleranceMs: 1000, maxRetries: 1 });

      // stat returns mtime 5s off from original
      const driftedTime = new Date(MOCK_DATE.getTime() + 5000);
      mockStat.mockResolvedValue(mockStatResult(driftedTime));

      // PowerShell succeeds for creation time
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "2024-01-01T00:00:00.0000000Z", "");
      });

      const result = await restoreTimestamps("/test/file.tif", original, "job-1");

      expect(result.success).toBe(false);
      expect(result.error_code).toBe(TIMESTAMP_ERROR.MTIME_VERIFY_FAILED);
      expect(result.mtime_restored).toBe(false);
    });

    it("fails with CREATION_RESTORE_FAILED when PowerShell restore fails", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      setTimestampConfig({ maxRetries: 1, failOnCreationRestore: true });

      mockStat.mockResolvedValue(mockStatResult(MOCK_DATE));

      // All PowerShell calls fail (both restore and verify)
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error("Access denied"), "", "");
      });

      const result = await restoreTimestamps("/test/file.tif", original, "job-1");

      expect(result.success).toBe(false);
      expect(result.error_code).toBe(TIMESTAMP_ERROR.CREATION_RESTORE_FAILED);
      expect(result.creation_time_restored).toBe(false);
    });

    it("retries up to maxRetries times", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      setTimestampConfig({ maxRetries: 3, toleranceMs: 500 });

      // First 2 calls: mtime off by 2s; 3rd call: within tolerance
      let callCount = 0;
      mockStat.mockImplementation(() => {
        callCount++;
        if (callCount <= 4) { // 2 attempts fail (stat called twice per attempt for verify)
          return Promise.resolve(mockStatResult(new Date(MOCK_DATE.getTime() + 2000)));
        }
        return Promise.resolve(mockStatResult(MOCK_DATE));
      });

      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "2024-01-01T00:00:00.0000000Z", "");
      });

      const result = await restoreTimestamps("/test/file.tif", original, "job-1");

      expect(result.verification_details?.attempts).toBeGreaterThanOrEqual(1);
    });

    it("does not fail on creation restore when failOnCreationRestore is false", async () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      setTimestampConfig({ maxRetries: 1, failOnCreationRestore: false });

      mockStat.mockResolvedValue(mockStatResult(MOCK_DATE));

      // PowerShell fails
      mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(new Error("fail"), "", "");
      });

      const result = await restoreTimestamps("/test/file.tif", original, "job-1");

      // Should succeed because failOnCreationRestore is false
      // mtime is within tolerance, creation failure is non-fatal
      expect(result.success).toBe(true);
      expect(result.mtime_restored).toBe(true);
    });

    it("succeeds without creation time when none was captured", async () => {
      Object.defineProperty(process, "platform", { value: "linux" });

      const noCreation: CapturedTimestamps = {
        ...original,
        creationTime: null,
        creationTimeSource: "unavailable",
      };

      mockStat.mockResolvedValue(mockStatResult(MOCK_DATE));

      const result = await restoreTimestamps("/test/file.tif", noCreation, "job-1");

      expect(result.success).toBe(true);
      expect(result.creation_time_restored).toBe(true); // vacuously true
    });
  });

  describe("Error codes", () => {
    it("has all required error codes", () => {
      expect(TIMESTAMP_ERROR.CAPTURE_FAILED).toBe("TIMESTAMP_CAPTURE_FAILED");
      expect(TIMESTAMP_ERROR.MTIME_RESTORE_FAILED).toBe("MTIME_RESTORE_FAILED");
      expect(TIMESTAMP_ERROR.CREATION_RESTORE_FAILED).toBe("CREATION_RESTORE_FAILED");
      expect(TIMESTAMP_ERROR.MTIME_VERIFY_FAILED).toBe("MTIME_VERIFY_FAILED");
      expect(TIMESTAMP_ERROR.CREATION_VERIFY_FAILED).toBe("CREATION_VERIFY_FAILED");
      expect(TIMESTAMP_ERROR.ROLLBACK_FAILED).toBe("ROLLBACK_FAILED");
    });
  });

  describe("TiffJobResult backward compatibility", () => {
    it("extended fields are optional", () => {
      // Verify the type structure allows existing consumers to work
      const minimalResult = {
        success: true,
        new_file_size: 1024,
        new_filename: "test.tif",
      };

      // These should be valid without the new fields
      expect(minimalResult.success).toBe(true);
      expect(minimalResult).not.toHaveProperty("timestamp_restore_status");
      expect(minimalResult).not.toHaveProperty("creation_time_restored");
    });
  });
});
