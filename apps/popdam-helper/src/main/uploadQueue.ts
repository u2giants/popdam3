/**
 * Background upload queue — persists across restarts via SQLite.
 * Uploads snapshots to Synology asynchronously so the user can keep working.
 */

import { app } from "electron";
import { join, dirname } from "path";
import { existsSync } from "fs";
import Database from "better-sqlite3";
import { log } from "./logger";
import { loadToken } from "./credentials";
import { uploadFile } from "./synologyClient";
import { completeCheckin } from "./damClient";
import { sha256File } from "./hash";
import { statSync } from "fs";
import { UPLOAD_MAX_RETRIES, UPLOAD_RETRY_DELAY_MS } from "@shared/constants";
import type { UploadJob } from "@shared/types";

let db: Database.Database;
let running = false;
let progressCallback: ((checkoutId: string, percent: number) => void) | null = null;

// ── DB setup ──────────────────────────────────────────────────────────────────

export function initQueue(): void {
  const dbPath = join(app.getPath("userData"), "upload-queue.db");
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS upload_jobs (
      checkout_id    TEXT PRIMARY KEY,
      snapshot_path  TEXT NOT NULL,
      upload_method  TEXT NOT NULL DEFAULT 'synology_file_station',
      synology_url   TEXT,
      synology_port  TEXT NOT NULL DEFAULT '5001',
      relative_path  TEXT NOT NULL,
      filename       TEXT NOT NULL,
      temp_suffix    TEXT NOT NULL,
      retry_count    INTEGER NOT NULL DEFAULT 0,
      added_at       INTEGER NOT NULL,
      last_attempt   INTEGER,
      status         TEXT NOT NULL DEFAULT 'pending'
    )
  `);
}

export function setProgressCallback(cb: (checkoutId: string, percent: number) => void): void {
  progressCallback = cb;
}

// ── Enqueue ───────────────────────────────────────────────────────────────────

export function enqueue(job: UploadJob): void {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO upload_jobs
      (checkout_id, snapshot_path, upload_method, synology_url, synology_port,
       relative_path, filename, temp_suffix, retry_count, added_at, status)
    VALUES
      (@checkout_id, @snapshot_path, @upload_method, @synology_url, @synology_port,
       @relative_path, @filename, @temp_suffix, 0, @added_at, 'pending')
  `);
  stmt.run({
    checkout_id: job.checkoutId,
    snapshot_path: job.snapshotPath,
    upload_method: job.uploadMethod,
    synology_url: job.synologyUrl,
    synology_port: job.synologyPort,
    relative_path: job.relativePath,
    filename: job.filename,
    temp_suffix: job.tempSuffix,
    added_at: Date.now(),
  });
  log.info(`Enqueued upload for checkout ${job.checkoutId}`);
  if (!running) processQueue();
}

// ── Process ───────────────────────────────────────────────────────────────────

export async function processQueue(): Promise<void> {
  if (running) return;
  running = true;

  try {
    while (true) {
      const job = db
        .prepare(
          `SELECT * FROM upload_jobs
           WHERE status = 'pending'
             AND retry_count < ${UPLOAD_MAX_RETRIES}
           ORDER BY added_at ASC LIMIT 1`,
        )
        .get() as Record<string, unknown> | undefined;

      if (!job) break;

      await processJob(job);
    }
  } finally {
    running = false;
  }
}

async function processJob(row: Record<string, unknown>): Promise<void> {
  const checkoutId = row.checkout_id as string;
  const snapshotPath = row.snapshot_path as string;

  log.info(`Processing upload job for checkout ${checkoutId}`);

  db.prepare(`UPDATE upload_jobs SET status='uploading', last_attempt=? WHERE checkout_id=?`)
    .run(Date.now(), checkoutId);

  try {
    if (!existsSync(snapshotPath)) {
      throw new Error(`Snapshot file missing: ${snapshotPath}`);
    }

    // Get Synology credentials from keychain
    const synologyUser = await loadToken("synology_username");
    const synologyPass = await loadToken("synology_password");
    if (!synologyUser || !synologyPass) {
      throw new Error("Synology credentials not configured. Please open Settings.");
    }

    const synologyConfig = {
      url: (row.synology_url as string) ?? "",
      port: (row.synology_port as string) ?? "5001",
      username: synologyUser,
      password: synologyPass,
    };

    const relativePath = row.relative_path as string;
    const filename = row.filename as string;
    const tempName = filename + (row.temp_suffix as string);

    // Extract the directory part of the relative path
    const remoteDir = dirname(relativePath);
    const shareName = relativePath.split("/")[0] ?? relativePath.split("\\")[0];

    await uploadFile(
      synologyConfig,
      snapshotPath,
      shareName,
      remoteDir.replace(/^[^/\\]+[/\\]/, ""), // strip share prefix from remoteDir
      tempName,
      filename,
      (progress) => {
        progressCallback?.(checkoutId, progress.percent);
      },
    );

    // Compute final hash and size
    const finalHash = await sha256File(snapshotPath);
    const finalSize = statSync(snapshotPath).size;

    // Tell the DAM it's done
    await completeCheckin({
      checkout_id: checkoutId,
      final_hash: finalHash,
      final_size: finalSize,
      upload_method: "synology_file_station",
      synology_upload_user: synologyUser,
    });

    db.prepare(`DELETE FROM upload_jobs WHERE checkout_id=?`).run(checkoutId);
    progressCallback?.(checkoutId, 100);
    log.info(`Upload complete for checkout ${checkoutId}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`Upload failed for checkout ${checkoutId}:`, msg);

    const retryCount = (row.retry_count as number) + 1;
    if (retryCount >= UPLOAD_MAX_RETRIES) {
      db.prepare(
        `UPDATE upload_jobs SET status='failed', retry_count=? WHERE checkout_id=?`,
      ).run(retryCount, checkoutId);
    } else {
      db.prepare(
        `UPDATE upload_jobs SET status='pending', retry_count=? WHERE checkout_id=?`,
      ).run(retryCount, checkoutId);
      // Back off before next retry
      await sleep(UPLOAD_RETRY_DELAY_MS * retryCount);
    }
  }
}

export function getPendingJobs(): { checkoutId: string; status: string; retryCount: number }[] {
  return (
    db
      .prepare(`SELECT checkout_id, status, retry_count FROM upload_jobs`)
      .all() as Array<{ checkout_id: string; status: string; retry_count: number }>
  ).map((r) => ({
    checkoutId: r.checkout_id,
    status: r.status,
    retryCount: r.retry_count,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
