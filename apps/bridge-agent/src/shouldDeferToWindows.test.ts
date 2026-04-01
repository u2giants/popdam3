/**
 * Unit tests for shouldDeferToWindows() function
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FileCandidate } from "./scanner.js";

interface WindowsRenderPolicy {
  mode: "fallback_only" | "shared" | "primary";
  shared_percent: number;
  shared_types: ("psd" | "ai" | "pdf")[];
  shared_min_mb: number;
  require_windows_healthy: boolean;
  max_pending_jobs: number;
  final_fallback_on_local_failure: boolean;
}

function shouldDeferToWindows(
  file: FileCandidate,
  quickHash: string,
  effectiveMode: "fallback_only" | "primary" | "shared" | undefined,
  policy: WindowsRenderPolicy | null,
  windowsHealthy: boolean,
  pendingJobs: number,
): { defer: boolean; reason: string | null } {
  // "primary" mode: always defer
  if (effectiveMode === "primary") {
    return { defer: true, reason: "primary_mode" };
  }

  // "fallback_only" mode: never defer proactively
  if (effectiveMode === "fallback_only") {
    return { defer: false, reason: null };
  }

  // "shared" mode: apply policy rules
  if (effectiveMode === "shared" && policy) {
    // File type must be eligible
    if (!policy.shared_types.includes(file.fileType)) {
      return { defer: false, reason: "type_not_eligible" };
    }

    // Health guard: if require_windows_healthy, check the flag
    if (policy.require_windows_healthy && !windowsHealthy) {
      return { defer: false, reason: "windows_unhealthy" };
    }

    // Queue depth guard
    if (pendingJobs >= policy.max_pending_jobs) {
      return { defer: false, reason: "queue_full" };
    }

    // Offload decision: file_size >= shared_min_mb OR hash-deterministic percent
    const meetsMinSize = policy.shared_min_mb > 0 && file.fileSize >= policy.shared_min_mb * 1024 * 1024;

    // Deterministic: use quick_hash so re-scans produce same decision
    const hashNum = parseInt(quickHash.slice(0, 8), 16);
    const meetsPercent = (hashNum % 100) < policy.shared_percent;

    if (meetsMinSize || meetsPercent) {
      return { defer: true, reason: "shared_offload" };
    }
  }

  return { defer: false, reason: null };
}

const createMockFile = (overrides: Partial<FileCandidate> = {}): FileCandidate => ({
  absolutePath: "/mnt/nas/Decor/Projects/Disney/Frozen/HXP8RNBHN02/art.psd",
  relativePath: "Decor/Projects/Disney/Frozen/HXP8RNBHN02/art.psd",
  filename: "art.psd",
  fileType: "psd",
  fileSize: 5 * 1024 * 1024, // 5MB default
  modifiedAt: new Date(),
  fileCreatedAt: null,
  ...overrides,
});

const createMockPolicy = (overrides: Partial<WindowsRenderPolicy> = {}): WindowsRenderPolicy => ({
  mode: "shared",
  shared_percent: 50,
  shared_types: ["psd", "ai", "pdf"],
  shared_min_mb: 10,
  require_windows_healthy: true,
  max_pending_jobs: 100,
  final_fallback_on_local_failure: true,
  ...overrides,
});

describe("shouldDeferToWindows", () => {
  describe("primary mode", () => {
    it("should always defer in primary mode", () => {
      const file = createMockFile();
      const result = shouldDeferToWindows(file, "abc123", "primary", null, false, 0);
      expect(result.defer).toBe(true);
      expect(result.reason).toBe("primary_mode");
    });
  });

  describe("fallback_only mode", () => {
    it("should never defer in fallback_only mode", () => {
      const file = createMockFile();
      const result = shouldDeferToWindows(file, "abc123", "fallback_only", null, false, 0);
      expect(result.defer).toBe(false);
      expect(result.reason).toBeNull();
    });
  });

  describe("shared mode", () => {
    it("should defer when file type is eligible and other conditions met", () => {
      const file = createMockFile({ fileType: "psd" });
      const policy = createMockPolicy({
        shared_types: ["psd", "ai"],
        shared_min_mb: 0,
        shared_percent: 100,
        require_windows_healthy: false,
      });
      const result = shouldDeferToWindows(file, "abc123", "shared", policy, true, 0);
      expect(result.defer).toBe(true);
      expect(result.reason).toBe("shared_offload");
    });

    it("should not defer when file type is not in shared_types", () => {
      const file = createMockFile({ fileType: "pdf" });
      const policy = createMockPolicy({ shared_types: ["psd", "ai"] });
      const result = shouldDeferToWindows(file, "abc123", "shared", policy, true, 0);
      expect(result.defer).toBe(false);
      expect(result.reason).toBe("type_not_eligible");
    });

    it("should not defer when windows is unhealthy and require_windows_healthy is true", () => {
      const file = createMockFile();
      const policy = createMockPolicy({ require_windows_healthy: true });
      const result = shouldDeferToWindows(file, "abc123", "shared", policy, false, 0);
      expect(result.defer).toBe(false);
      expect(result.reason).toBe("windows_unhealthy");
    });

    it("should defer when windows is unhealthy but require_windows_healthy is false", () => {
      const file = createMockFile();
      const policy = createMockPolicy({
        require_windows_healthy: false,
        shared_min_mb: 0,
        shared_percent: 100,
      });
      const result = shouldDeferToWindows(file, "abc123", "shared", policy, false, 0);
      expect(result.defer).toBe(true);
    });

    it("should not defer when queue is full", () => {
      const file = createMockFile();
      const policy = createMockPolicy({ max_pending_jobs: 50 });
      const result = shouldDeferToWindows(file, "abc123", "shared", policy, true, 50);
      expect(result.defer).toBe(false);
      expect(result.reason).toBe("queue_full");
    });

    it("should defer based on file size when meets min_mb threshold", () => {
      const largeFile = createMockFile({ fileSize: 20 * 1024 * 1024 }); // 20MB
      const policy = createMockPolicy({
        shared_min_mb: 10,
        shared_percent: 0, // No percent-based offload
      });
      const result = shouldDeferToWindows(largeFile, "abc123", "shared", policy, true, 0);
      expect(result.defer).toBe(true);
    });

    it("should not defer when file is below min_mb threshold", () => {
      const smallFile = createMockFile({ fileSize: 5 * 1024 * 1024 }); // 5MB
      const policy = createMockPolicy({
        shared_min_mb: 10,
        shared_percent: 0,
      });
      const result = shouldDeferToWindows(smallFile, "abc123", "shared", policy, true, 0);
      expect(result.defer).toBe(false);
    });

    it("should use hash for deterministic percent-based offload", () => {
      const file = createMockFile();
      // Hash starting with 0x00000000 should always be in bottom percent
      const hashInBottom50 = "00000000abcdef";
      const hashInTop50 = "ffffffffabcdef";
      const policy = createMockPolicy({
        shared_min_mb: 0,
        shared_percent: 50,
      });

      const resultLow = shouldDeferToWindows(file, hashInBottom50, "shared", policy, true, 0);
      const resultHigh = shouldDeferToWindows(file, hashInTop50, "shared", policy, true, 0);

      expect(resultLow.defer).toBe(true);
      expect(resultHigh.defer).toBe(false);
    });
  });

  describe("undefined mode", () => {
    it("should not defer when mode is undefined", () => {
      const file = createMockFile();
      const policy = createMockPolicy();
      const result = shouldDeferToWindows(file, "abc123", undefined, policy, true, 0);
      expect(result.defer).toBe(false);
    });
  });

  describe("null policy in shared mode", () => {
    it("should not defer when policy is null in shared mode", () => {
      const file = createMockFile();
      const result = shouldDeferToWindows(file, "abc123", "shared", null, true, 0);
      expect(result.defer).toBe(false);
    });
  });
});
