/**
 * Centralized constants for the Bridge Agent.
 * 
 * Documented in docs/WORKER_LOGIC.md and referenced here to eliminate magic numbers.
 */

// ── Heartbeat & Timing ────────────────────────────────────────────────

/** How often the agent sends a heartbeat to the cloud (ms) */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** Timeout for heartbeat API call (ms) - longer because it runs 4+ parallel DB queries */
export const HEARTBEAT_TIMEOUT_MS = 60_000;

/** Max delay between retry attempts (ms) - capped to stay under heartbeat interval */
export const RETRY_MAX_DELAY_MS = 5_000;

/** Default API call timeout (ms) */
export const API_TIMEOUT_MS = 30_000;

// ── Scanning ─────────────────────────────────────────────────────────

/** How often progress is reported during directory walking (ms) */
export const PROGRESS_INTERVAL_MS = 2_000;

/** How often to save a checkpoint during scanning (files) */
export const CHECKPOINT_FILE_INTERVAL = 500;

/** Max skipped directories to report (to prevent huge payloads) */
export const MAX_SKIPPED_DIRS = 500;

// ── Realtime ─────────────────────────────────────────────────────────

/** Debounce time for realtime scan requests (ms) */
export const REALTIME_DEBOUNCE_MS = 2_000;

// ── Batch Processing ─────────────────────────────────────────────────

/** Default number of files to process in each batch */
export const DEFAULT_BATCH_SIZE = 100;

/** Default thumbnail generation concurrency */
export const DEFAULT_THUMB_CONCURRENCY = 2;

/** Max concurrent thumbnail operations */
export const MAX_THUMB_CONCURRENCY = 8;

// ── Check-changed ───────────────────────────────────────────────────

/** Max files to send in a single check-changed call */
export const CHECK_CHANGED_CHUNK_SIZE = 20;

/** Max total files in a check-changed batch */
export const CHECK_CHANGED_MAX_BATCH = 500;

// ── Auto-scan ───────────────────────────────────────────────────────

/** Default interval for auto-scan (hours) */
export const DEFAULT_AUTO_SCAN_INTERVAL_HOURS = 6;
