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
import { completeCheckin } from "./damClient";
import { sha256File } from "./hash";
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

// ── Init ──────────────────────────────────────────────────────────────────────

export function initQueue(): void {
  queuePath = join(app.getPath("userData"), "upload-queue.json");
}

export function setProgressCallback(cb: (checkoutId: string, percent: number) => void): void {
  progressCallback = cb;
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
      (progress) => progressCallback?.(checkoutId, progress.percent),
    );

    const finalHash = await sha256File(snapshotPath);
    const finalSize = statSync(snapshotPath).size;

    await completeCheckin({
      checkout_id: checkoutId,
      final_hash: finalHash,
      final_size: finalSize,
      upload_method: "synology_file_station",
      synology_upload_user: synologyUser,
    });

    removeJob(checkoutId);
    progressCallback?.(checkoutId, 100);
    log.info(`Upload complete for checkout ${checkoutId}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`Upload failed for checkout ${checkoutId}:`, msg);

    const retryCount = job.retryCount + 1;
    if (retryCount >= UPLOAD_MAX_RETRIES) {
      updateJob(checkoutId, { status: "failed", retryCount });
    } else {
      updateJob(checkoutId, { status: "pending", retryCount });
      await sleep(UPLOAD_RETRY_DELAY_MS * retryCount);
    }
  }
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
