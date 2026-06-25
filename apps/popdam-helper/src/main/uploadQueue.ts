/**
 * Background upload queue — persisted to userData/upload-queue.json.
 * Uploads snapshots to Synology asynchronously so the user can keep working.
 * Pure JSON file store — no native modules needed.
 */

import { app } from "electron";
import { join, dirname } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { log } from "./logger";
import { loadToken } from "./credentials";
import { uploadFile } from "./synologyClient";
import { completeCheckin, redriveComplete } from "./damClient";
import { sha256File, quickHashFile } from "./hash";
import { getConfig } from "./config";
import { copySnapshotToManagedPath } from "./fileOps";
import { statSync } from "fs";
import { UPLOAD_MAX_RETRIES, UPLOAD_RETRY_DELAY_MS } from "@shared/constants";
import type { UploadJob } from "@shared/types";

interface StoredJob extends UploadJob {
  status: "pending" | "uploading" | "failed";
  lastAttempt: number | null;
}

let queuePath: string;
let running = false;
let progressCallback: ((checkoutId: string, percent: number) => void) | null = null;
let verifyingCallback: ((checkoutId: string) => void) | null = null;
let failedCallback: ((checkoutId: string, message: string) => void) | null = null;

// ── Init ──────────────────────────────────────────────────────────────────────

export function initQueue(): void {
  queuePath = join(app.getPath("userData"), "upload-queue.json");
  recoverStaleJobs();
}

/**
 * Crash recovery: any job left in "uploading" status at startup means a previous
 * run died mid-upload (between marking the job "uploading" and either completing
 * the check-in or recording a failure). processQueue() only picks up "pending"
 * jobs, so without this sweep those checkouts would stay locked forever. Reset
 * them to "pending" so the upload is retried from scratch on resume — the upload
 * targets a temp filename and overwrites on retry, so re-running is safe.
 */
function recoverStaleJobs(): void {
  const jobs = readJobs();
  let recovered = 0;
  for (const job of jobs) {
    if (job.status === "uploading") {
      job.status = "pending";
      recovered++;
    }
  }
  if (recovered > 0) {
    writeJobs(jobs);
    log.warn(`Recovered ${recovered} stale upload job(s) interrupted by a previous shutdown — re-queued as pending`);
  }
}

export function setProgressCallback(cb: (checkoutId: string, percent: number) => void): void {
  progressCallback = cb;
}

/**
 * Called when an upload finished but the server parked the check-in in
 * 'verifying' (Seafile-sourced) — the lock is NOT released until the bridge
 * agent confirms the file landed intact on the Synology.
 */
export function setVerifyingCallback(cb: (checkoutId: string) => void): void {
  verifyingCallback = cb;
}

/**
 * Called when an upload has exhausted all retries and permanently failed. Lets
 * the UI surface the check-in failure (otherwise the checkout sits in
 * "uploading" forever with no signal to the user).
 */
export function setFailedCallback(cb: (checkoutId: string, message: string) => void): void {
  failedCallback = cb;
}

// ── Persistence helpers ───────────────────────────────────────────────────────

function readJobs(): StoredJob[] {
  try {
    return JSON.parse(readFileSync(queuePath, "utf-8"));
  } catch {
    return [];
  }
}

function writeJobs(jobs: StoredJob[]): void {
  mkdirSync(dirname(queuePath), { recursive: true });
  writeFileSync(queuePath, JSON.stringify(jobs, null, 2), "utf-8");
}

// ── Enqueue ───────────────────────────────────────────────────────────────────

export function enqueue(job: UploadJob): void {
  const jobs = readJobs();
  const existing = jobs.findIndex((j) => j.checkoutId === job.checkoutId);
  const stored: StoredJob = { ...job, status: "pending", lastAttempt: null };
  if (existing >= 0) {
    jobs[existing] = stored;
  } else {
    jobs.push(stored);
  }
  writeJobs(jobs);
  log.info(`Enqueued upload for checkout ${job.checkoutId}`);
  if (!running) processQueue();
}

// ── Process ───────────────────────────────────────────────────────────────────

export async function processQueue(): Promise<void> {
  if (running) return;
  running = true;

  try {
    while (true) {
      const jobs = readJobs();
      const job = jobs.find(
        (j) => j.status === "pending" && j.retryCount < UPLOAD_MAX_RETRIES,
      );
      if (!job) break;
      await processJob(job);
    }
  } finally {
    running = false;
  }
}

async function processJob(job: StoredJob): Promise<void> {
  const { checkoutId, snapshotPath } = job;
  log.info(`Processing upload job for checkout ${checkoutId}`);

  updateJob(checkoutId, { status: "uploading", lastAttempt: Date.now() });

  try {
    if (!existsSync(snapshotPath)) {
      throw new Error(`Snapshot file missing: ${snapshotPath}`);
    }

    let synologyUser = loadToken("synology_username");
    let uploadMethod = job.uploadMethod;

    try {
      if (job.uploadMethod === "smb_local") {
        const config = getConfig();
        copySnapshotToManagedPath(
          snapshotPath,
          job.relativePath,
          config.rootMappings,
          job.tempSuffix,
        );
        progressCallback?.(checkoutId, 99);
      } else {
        await uploadViaFileStation(job, snapshotPath, checkoutId);
      }
    } catch (e) {
      if (job.uploadMethod !== "smb_local") throw e;
      log.warn(`SMB/local write failed for checkout ${checkoutId}; falling back to Synology File Station:`, (e as Error).message);
      await uploadViaFileStation(job, snapshotPath, checkoutId);
      uploadMethod = "synology_file_station";
      synologyUser = loadToken("synology_username");
    }

    // Re-drive: re-upload of a stuck 'verifying' check-in. The file is already on
    // the server's side; we just re-pushed the same snapshot. Report to
    // /redrive-complete and let verification continue — do NOT finalize.
    if (job.isRedrive) {
      await redriveComplete(checkoutId);
      removeJob(checkoutId);
      log.info(`Re-drive upload finished for checkout ${checkoutId} — verification will retry`);
      return;
    }

    const finalHash = await sha256File(snapshotPath);
    // Quick-hash (head+tail+size) is what the Synology-side verifier checks the
    // landed file against — cheap to verify there. Full hash above is kept as the
    // forensic content hash recorded on the check-in.
    const finalQuickHash = await quickHashFile(snapshotPath);
    const finalSize = statSync(snapshotPath).size;

    const result = await completeCheckin({
      checkout_id: checkoutId,
      final_hash: finalHash,
      final_quick_hash: finalQuickHash,
      final_size: finalSize,
      upload_method: uploadMethod,
      synology_upload_user: synologyUser,
      source_provider: job.sourceProvider,
      source_version: job.seafileObjId ?? null,
    });

    removeJob(checkoutId);
    if (result.status === "verifying") {
      // Upload landed on Synology, but the lock is held until the bridge agent
      // confirms the fully-synced file is intact. Don't mark it complete here.
      verifyingCallback?.(checkoutId);
      log.info(`Upload finished for checkout ${checkoutId} — awaiting server-side receipt confirmation`);
    } else {
      progressCallback?.(checkoutId, 100);
      log.info(`Upload complete for checkout ${checkoutId}`);
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`Upload failed for checkout ${checkoutId}:`, msg);

    // Missing Synology credentials won't fix themselves on retry — fail fast so
    // the user is prompted immediately (main wires this to open Settings) rather
    // than waiting through 5 retry backoffs first.
    const missingCreds = /credentials? not configured/i.test(msg);
    const retryCount = missingCreds ? UPLOAD_MAX_RETRIES : job.retryCount + 1;
    if (retryCount >= UPLOAD_MAX_RETRIES) {
      updateJob(checkoutId, { status: "failed", retryCount });
      failedCallback?.(
        checkoutId,
        missingCreds
          ? "Your Synology credentials aren't set up yet, so this check-in can't upload. Add them in Settings, then check in again."
          : `Check-in upload failed after ${UPLOAD_MAX_RETRIES} attempts: ${msg}. Your edited file is safe in your workspace — try checking in again.`,
      );
    } else {
      updateJob(checkoutId, { status: "pending", retryCount });
      await sleep(UPLOAD_RETRY_DELAY_MS * retryCount);
    }
  }
}

async function uploadViaFileStation(
  job: StoredJob,
  snapshotPath: string,
  checkoutId: string,
): Promise<void> {
  const synologyUser = loadToken("synology_username");
  const synologyPass = loadToken("synology_password");
  if (!synologyUser || !synologyPass) {
    throw new Error("Synology credentials not configured. Please open Settings.");
  }

  const synologyConfig = {
    url: job.synologyUrl ?? "",
    port: job.synologyPort,
    username: synologyUser,
    password: synologyPass,
  };

  const remoteDir = dirname(job.relativePath).replace(/^[^/\\]+[/\\]/, "");
  const shareName = job.relativePath.split("/")[0] ?? job.relativePath.split("\\")[0];
  const tempName = job.filename + job.tempSuffix;

  await uploadFile(
    synologyConfig,
    snapshotPath,
    shareName,
    remoteDir,
    tempName,
    job.filename,
    // The Synology client reports 100% when the temp upload finishes, before
    // rename and cloud finalization. Keep the UI in uploading state until this
    // queue confirms complete/verifying below.
    (progress) => progressCallback?.(checkoutId, Math.min(progress.percent, 99)),
  );
}

function updateJob(checkoutId: string, updates: Partial<StoredJob>): void {
  const jobs = readJobs();
  const idx = jobs.findIndex((j) => j.checkoutId === checkoutId);
  if (idx >= 0) {
    jobs[idx] = { ...jobs[idx], ...updates };
    writeJobs(jobs);
  }
}

function removeJob(checkoutId: string): void {
  const jobs = readJobs().filter((j) => j.checkoutId !== checkoutId);
  writeJobs(jobs);
}

export function getPendingJobs(): { checkoutId: string; status: string; retryCount: number }[] {
  return readJobs().map((j) => ({
    checkoutId: j.checkoutId,
    status: j.status,
    retryCount: j.retryCount,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
