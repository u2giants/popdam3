/**
 * Checkout state machine — coordinates the full checkout/check-in lifecycle.
 * This is the orchestrator: it calls damClient, fileOps, uploadQueue, and
 * chokidar to drive a checkout from start to finish.
 */

import { shell } from "electron";
import chokidar, { FSWatcher } from "chokidar";
import { existsSync, statSync } from "fs";
import { join, dirname, basename } from "path";
import {
  resolveAssetPath,
  copyToWorkspace,
  writeCheckoutMeta,
  waitForFileStable,
  createSnapshot,
  checkoutDir,
} from "./fileOps";
import { sha256File } from "./hash";
import {
  startCheckout as apiStartCheckout,
  prepareCheckin as apiPrepareCheckin,
  discardCheckout as apiDiscard,
  getOpenCheckouts,
} from "./damClient";
import { enqueue } from "./uploadQueue";
import { getConfig } from "./config";
import { validateRoot } from "./rootValidator";
import { log } from "./logger";
import type { CheckoutRecord, RootMapping } from "@shared/types";

// In-memory map of active checkouts: checkoutId → record
const active = new Map<string, CheckoutRecord>();
// File watchers keyed by checkoutId
const watchers = new Map<string, FSWatcher>();

let changeListener: (() => void) | null = null;

export function onCheckoutsChanged(cb: () => void): void {
  changeListener = cb;
}

function notify(): void {
  changeListener?.();
}

// ── Load from server on startup ───────────────────────────────────────────────

export async function loadActiveCheckouts(): Promise<void> {
  try {
    const res = await getOpenCheckouts();
    const config = getConfig();
    for (const co of res.checkouts ?? []) {
      const assetInfo = (co as any).assets ?? {};
      const record: CheckoutRecord = {
        id: co.id,
        assetId: assetInfo.id ?? "",
        userId: "",
        deviceId: null,
        status: co.status as CheckoutRecord["status"],
        checkedOutAt: co.checked_out_at,
        checkedInAt: null,
        filename: assetInfo.filename ?? "",
        relativePath: assetInfo.relative_path ?? "",
        rootId: "",
        sourceHash: co.source_hash,
        sourceSize: co.source_size,
        workspacePath: join(
          checkoutDir(config.workspacePath, co.id),
          assetInfo.filename ?? "",
        ),
        snapshotPath: null,
        uploadProgress: null,
        errorMessage: null,
      };
      active.set(co.id, record);
      watchFile(co.id, record.workspacePath);
    }
    notify();
  } catch (e) {
    log.warn("Failed to load active checkouts from server:", e);
  }
}

// ── Checkout ──────────────────────────────────────────────────────────────────

export async function checkout(
  token: string,
  assetId?: string,
): Promise<{ checkoutId: string; workspacePath: string }> {
  const config = getConfig();

  const res = await apiStartCheckout({
    token,
    asset_id: assetId,
    device_id: config.deviceId,
    helper_version: config.helperVersion,
    computer_id: config.deviceName,
  });

  const { checkout_id, asset, root_mappings } = res;

  // Merge server root_mappings with locally saved paths
  const localMappings = config.rootMappings;
  const mergedMappings: RootMapping[] = root_mappings.map((rm: any) => {
    const local = localMappings.find((l) => l.root_id === rm.root_id);
    return {
      root_id: rm.root_id,
      display_name: rm.display_name ?? rm.root_id,
      local_path: local?.local_path ?? rm.local_path ?? "",
      marker_verified: local?.marker_verified ?? false,
    };
  });

  // Double-check each mapping's local path is still pointing at the right folder level
  for (const mapping of mergedMappings) {
    if (!mapping.local_path) continue;
    const vResult = validateRoot(mapping.local_path, mapping.root_id);
    if (!vResult.ok) {
      if (vResult.reason === "too_deep" || vResult.reason === "too_shallow") {
        // Auto-correct in memory for this checkout — user should fix in Settings
        log.warn(`Root path level mismatch for "${mapping.root_id}" — correcting to ${vResult.suggestedPath}`);
        mapping.local_path = vResult.suggestedPath;
      } else if (vResult.reason === "wrong_root_id") {
        throw new Error(
          `Folder mapping for "${mapping.root_id}" points to the wrong NAS root ("${vResult.actual}"). Please fix your folder mappings in Settings.`,
        );
      }
      // no_marker and forbidden are non-blocking here — resolveAssetPath will fail if path is truly wrong
    }
  }

  let sourcePath: string;
  try {
    sourcePath = resolveAssetPath(
      asset.relative_path.split("/")[0] ?? asset.relative_path.split("\\")[0],
      asset.relative_path,
      mergedMappings,
    );
  } catch {
    // Fall back: try all mappings
    throw new Error(
      `No local path configured for this asset. Please set up your folder mappings in Settings.`,
    );
  }

  if (!existsSync(sourcePath)) {
    throw new Error(
      `File not found locally: ${sourcePath}\n\nIt may not have synced yet. Check your Seafile or Synology Drive client.`,
    );
  }

  const copied = await copyToWorkspace(
    sourcePath,
    checkout_id,
    asset.filename,
    config.workspacePath,
  );

  const destDir = checkoutDir(config.workspacePath, checkout_id);
  writeCheckoutMeta(destDir, {
    checkout_id,
    asset_id: asset.asset_id,
    root_id: asset.relative_path.split("/")[0],
    relative_path: asset.relative_path,
    filename: asset.filename,
    checked_out_at: new Date().toISOString(),
    source_hash: asset.expected_hash ?? copied.hash,
    source_size: asset.expected_size ?? copied.size,
    dam_url: `${config.damUrl}/assets/${asset.asset_id}`,
  });

  const record: CheckoutRecord = {
    id: checkout_id,
    assetId: asset.asset_id,
    userId: "",
    deviceId: config.deviceId,
    status: "active",
    checkedOutAt: new Date().toISOString(),
    checkedInAt: null,
    filename: asset.filename,
    relativePath: asset.relative_path,
    rootId: asset.relative_path.split("/")[0],
    sourceHash: asset.expected_hash ?? copied.hash,
    sourceSize: asset.expected_size ?? copied.size,
    workspacePath: copied.workspacePath,
    snapshotPath: null,
    uploadProgress: null,
    errorMessage: null,
  };

  active.set(checkout_id, record);
  watchFile(checkout_id, copied.workspacePath);
  notify();

  if (res.open_after_checkout) {
    await shell.openPath(copied.workspacePath);
  }

  return { checkoutId: checkout_id, workspacePath: copied.workspacePath };
}

// ── Check-in ──────────────────────────────────────────────────────────────────

export async function checkin(checkoutId: string): Promise<void> {
  const record = active.get(checkoutId);
  if (!record) throw new Error(`Checkout ${checkoutId} not found`);

  const config = getConfig();

  updateStatus(checkoutId, "checkin_queued");

  if (!existsSync(record.workspacePath)) {
    throw new Error(`Workspace file missing: ${record.workspacePath}`);
  }

  // Wait for file to stop saving
  await waitForFileStable(record.workspacePath);

  // Snapshot
  const snap = await createSnapshot(
    record.workspacePath,
    checkoutId,
    record.filename,
    config.workspacePath,
  );

  // Tell DAM we're about to upload
  const instructions = await apiPrepareCheckin({
    checkout_id: checkoutId,
    snapshot_hash: snap.hash,
    snapshot_size: snap.size,
  });

  record.snapshotPath = snap.snapshotPath;

  // Enqueue async upload
  enqueue({
    checkoutId,
    snapshotPath: snap.snapshotPath,
    uploadMethod: "synology_file_station",
    synologyUrl: instructions.upload_instructions.synology_url,
    synologyPort: instructions.upload_instructions.synology_port,
    relativePath: instructions.upload_instructions.relative_path,
    filename: instructions.upload_instructions.filename,
    tempSuffix: instructions.upload_instructions.temp_suffix,
    retryCount: 0,
    addedAt: Date.now(),
  });

  updateStatus(checkoutId, "uploading");
  notify();
}

// ── Discard ───────────────────────────────────────────────────────────────────

export async function discard(checkoutId: string): Promise<void> {
  await apiDiscard(checkoutId);
  stopWatcher(checkoutId);
  active.delete(checkoutId);
  notify();
}

// ── Reveal ────────────────────────────────────────────────────────────────────

export function revealFile(checkoutId: string): void {
  const record = active.get(checkoutId);
  if (!record || !existsSync(record.workspacePath)) return;
  shell.showItemInFolder(record.workspacePath);
}

export function openFile(checkoutId: string): void {
  const record = active.get(checkoutId);
  if (!record || !existsSync(record.workspacePath)) return;
  shell.openPath(record.workspacePath);
}

// ── Accessors ─────────────────────────────────────────────────────────────────

export function getActiveCheckouts(): CheckoutRecord[] {
  return Array.from(active.values());
}

export function updateUploadProgress(checkoutId: string, percent: number): void {
  const record = active.get(checkoutId);
  if (!record) return;
  record.uploadProgress = percent;
  if (percent >= 100) {
    record.status = "complete";
    active.delete(checkoutId);
    stopWatcher(checkoutId);
  }
  notify();
}

function updateStatus(checkoutId: string, status: CheckoutRecord["status"]): void {
  const record = active.get(checkoutId);
  if (!record) return;
  record.status = status;
  notify();
}

// ── File watcher ──────────────────────────────────────────────────────────────

function watchFile(checkoutId: string, filePath: string): void {
  if (!existsSync(filePath)) return;
  stopWatcher(checkoutId);

  const watcher = chokidar.watch(filePath, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 300 },
  });

  watcher.on("change", () => {
    const record = active.get(checkoutId);
    if (!record) return;
    log.debug(`File changed: ${filePath}`);
    notify();
  });

  watcher.on("unlink", () => {
    const record = active.get(checkoutId);
    if (!record) return;
    record.errorMessage = "Workspace file was deleted.";
    updateStatus(checkoutId, "error");
  });

  watchers.set(checkoutId, watcher);
}

function stopWatcher(checkoutId: string): void {
  const w = watchers.get(checkoutId);
  if (w) {
    w.close();
    watchers.delete(checkoutId);
  }
}
