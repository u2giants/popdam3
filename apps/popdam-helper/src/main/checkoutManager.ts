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
  redrive as apiRedrive,
} from "./damClient";
import { enqueue } from "./uploadQueue";
import { getConfig } from "./config";
import { validateRoot } from "./rootValidator";
import {
  getSeafileHealth,
  resolveSeafileTarget,
  ensureHydrated,
  getSeafileObjId,
} from "./seafileAdapter";
import { log } from "./logger";
import type { CheckoutRecord, RootMapping, StorageProvider } from "@shared/types";

// In-memory map of active checkouts: checkoutId → record
const active = new Map<string, CheckoutRecord>();
// File watchers keyed by checkoutId
const watchers = new Map<string, FSWatcher>();
// Checkouts currently being re-driven, to avoid double-enqueuing before the
// server clears redrive_requested.
const redriving = new Set<string>();

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

  // From here on the server has already created the checkout lock. If anything
  // below throws (source not synced locally, no folder mapping, hydration
  // timeout, copy error), we must release that lock — otherwise the asset is
  // left orphaned "checked out" with nothing in the Helper, and the web UI is
  // stuck on "Check In" forever. Release + rethrow so the caller can surface it.
  try {
    return await resolveCopyAndOpen(checkout_id, asset, root_mappings, config, res.open_after_checkout);
  } catch (e) {
    log.error(
      `Checkout ${checkout_id} failed after the server lock was created — releasing the lock:`,
      (e as Error).message,
    );
    await apiDiscard(checkout_id).catch((de) =>
      log.warn(`Could not release orphaned lock ${checkout_id}:`, (de as Error).message),
    );
    throw e;
  }
}

/**
 * The half of a checkout that runs AFTER the server lock exists: resolve the
 * source file (Seafile/SeaDrive or Synology), copy it into the private
 * workspace, record it, and open it. Split out so `checkout()` can release the
 * server lock if any of this throws (see the try/catch in `checkout`).
 */
async function resolveCopyAndOpen(
  checkout_id: string,
  asset: Awaited<ReturnType<typeof apiStartCheckout>>["asset"],
  root_mappings: Awaited<ReturnType<typeof apiStartCheckout>>["root_mappings"],
  config: ReturnType<typeof getConfig>,
  openAfterCheckout: boolean,
): Promise<{ checkoutId: string; workspacePath: string }> {
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

  const rootId = asset.relative_path.split("/")[0] ?? asset.relative_path.split("\\")[0];
  const preferred: StorageProvider = config.preferredProvider ?? "seafile";

  // Why Seafile didn't serve this checkout (if preferred). Carried into the
  // Synology-fallback error so the user sees the *real* reason ("SeaDrive client
  // not detected", "Libraries not mounted: …", hydration timeout) instead of a
  // misleading "set up your folder mappings" when SeaDrive simply isn't ready.
  let seafileIssue: string | null = null;

  const resolveSynologyPath = (): string => {
    try {
      return resolveAssetPath(rootId, asset.relative_path, mergedMappings);
    } catch {
      const base = seafileIssue
        ? `Could not get this file from SeaDrive (${seafileIssue}), and no Synology folder mapping is configured as a fallback.`
        : "No local path configured for this asset.";
      throw new Error(
        `${base}\n\nFix one of these in the Helper's Settings:\n• Install/sign in to SeaDrive and sync this library, or\n• map this NAS root to a local folder.`,
      );
    }
  };

  let sourcePath: string | null = null;
  let sourceProvider: StorageProvider = "synology";
  let seafileObjId: string | undefined;

  if (preferred === "seafile") {
    const health = getSeafileHealth(config);
    // Gate on the mount root existing — NOT on health.available, which is
    // all-or-nothing (it requires EVERY configured library to be mounted, so a
    // Character Licensed checkout would wrongly fail just because Generic Decor
    // isn't synced). resolveSeafileTarget + ensureHydrated below already verify
    // the SPECIFIC library and file this asset needs, and fall back if missing.
    if (health.root) {
      try {
        const target = resolveSeafileTarget(asset.relative_path, config);
        // Confirm the file is fully local (or trigger + wait for hydration)
        await ensureHydrated(target.localPath, {
          onProgress: (s) =>
            log.debug(`Hydrating ${target.localPath}: ${s.state} ${s.bytesDone ?? 0}B`),
        });
        sourcePath = target.localPath;
        sourceProvider = "seafile";
        seafileObjId =
          (await getSeafileObjId(target.mapping.libraryId, target.pathInLib, config)) ?? undefined;
      } catch (e) {
        seafileIssue = (e as Error).message;
        if (!config.synologyFallbackAllowed) throw e;
        log.warn(`Seafile resolution failed, falling back to Synology: ${seafileIssue}`);
      }
    } else if (!config.synologyFallbackAllowed) {
      throw new Error(
        "Seafile/SeaDrive is unavailable and fallback is not enabled for this account." +
          (health.detail ? `\n\n${health.detail}` : ""),
      );
    } else {
      seafileIssue = health.detail ?? "SeaDrive mount root not found";
      log.warn(`Seafile unavailable (${seafileIssue}); falling back to Synology.`);
    }
  }

  if (!sourcePath) {
    sourcePath = resolveSynologyPath();
    sourceProvider = "synology";
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
    source_provider: sourceProvider,
    source_local_path: sourcePath,
    seafile_obj_id: seafileObjId,
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
    sourceProvider,
    sourceLocalPath: sourcePath,
    seafileObjId,
    uploadProgress: null,
    errorMessage: null,
  };

  active.set(checkout_id, record);
  watchFile(checkout_id, copied.workspacePath);
  notify();

  if (openAfterCheckout) {
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
    uploadMethod: config.preferredProvider === "synology" ? "smb_local" : "synology_file_station",
    synologyUrl: instructions.upload_instructions.synology_url,
    synologyPort: instructions.upload_instructions.synology_port,
    relativePath: instructions.upload_instructions.relative_path,
    filename: instructions.upload_instructions.filename,
    tempSuffix: instructions.upload_instructions.temp_suffix,
    retryCount: 0,
    addedAt: Date.now(),
    sourceProvider: record.sourceProvider,
    seafileObjId: record.seafileObjId,
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

/**
 * The upload finished but the server is holding the lock in 'verifying' until
 * the bridge agent confirms the file landed intact on the Synology (Seafile
 * sources). Keep the checkout visible — it is NOT done yet.
 */
export function markVerifying(checkoutId: string): void {
  const record = active.get(checkoutId);
  if (!record) return;
  record.status = "verifying";
  record.uploadProgress = 100;
  record.errorMessage = null;
  notify();
}

/**
 * An upload exhausted all retries. Surface it on the checkout so the user sees
 * an actionable error instead of a checkout stuck in "uploading" forever. The
 * lock stays held (the file never landed), so the user can retry check-in.
 */
export function markUploadFailed(checkoutId: string, message: string): void {
  const record = active.get(checkoutId);
  if (!record) return;
  record.status = "error";
  record.errorMessage = message;
  notify();
}

/**
 * Reconcile locally-'verifying' checkouts against the server. The bridge agent
 * flips them to 'complete' once it confirms receipt (they drop out of the open
 * list), or the server flags verify_failed_at if the file never arrives intact
 * before the deadline (lock stays held — surfaced as an error to the user).
 * Only touches records currently in 'verifying' so it never disturbs in-flight
 * uploads or active edits.
 */
export async function reconcileVerifyingCheckouts(): Promise<void> {
  const verifying = getActiveCheckouts().filter((r) => r.status === "verifying");
  if (verifying.length === 0) return;

  let res;
  try {
    res = await getOpenCheckouts();
  } catch (e) {
    log.warn("Could not reconcile verifying checkouts:", (e as Error).message);
    return;
  }

  const serverById = new Map((res.checkouts ?? []).map((c) => [c.id, c]));
  let changed = false;

  for (const rec of verifying) {
    const server = serverById.get(rec.id) as
      | {
          status: string;
          verify_failed_at?: string | null;
          verify_error?: string | null;
          redrive_requested?: boolean;
        }
      | undefined;

    if (!server) {
      // No longer open → bridge agent confirmed receipt and it completed.
      rec.status = "complete";
      active.delete(rec.id);
      stopWatcher(rec.id);
      redriving.delete(rec.id);
      changed = true;
      continue;
    }

    if (server.status === "error") {
      // Auto-resolved past the deadline: lock released, asset freed. Surface the
      // server's explanation so the designer knows to check in again.
      rec.status = "error";
      rec.errorMessage =
        server.verify_error ??
        "Check-in could not be confirmed. Your work is saved locally — please check in again.";
      redriving.delete(rec.id);
      changed = true;
      continue;
    }

    if (server.redrive_requested) {
      // Server asked us to re-upload the retained snapshot to self-heal.
      void triggerRedrive(rec);
    }

    if (server.verify_failed_at) {
      // Still locked, but flagged — verification hasn't succeeded yet.
      rec.errorMessage =
        server.verify_error ??
        "Still confirming this check-in reached the server…";
      changed = true;
    } else if (rec.errorMessage) {
      // Recovered (e.g. a re-drive cleared the flag) — drop the stale message.
      rec.errorMessage = null;
      changed = true;
    }
  }

  if (changed) notify();
}

/**
 * Re-upload a stuck check-in's snapshot to the Synology. Best-effort: if the
 * snapshot is no longer available locally (e.g. after an app restart) we skip and
 * let the server auto-resolve at its deadline.
 */
async function triggerRedrive(rec: CheckoutRecord): Promise<void> {
  if (redriving.has(rec.id)) return;
  if (!rec.snapshotPath || !existsSync(rec.snapshotPath)) {
    log.warn(`Re-drive requested for ${rec.id} but snapshot is unavailable locally — leaving for server auto-resolve`);
    return;
  }
  redriving.add(rec.id);
  try {
    const { upload_instructions: ui } = await apiRedrive(rec.id);
    const config = getConfig();
    enqueue({
      checkoutId: rec.id,
      snapshotPath: rec.snapshotPath,
      uploadMethod: config.preferredProvider === "synology" ? "smb_local" : "synology_file_station",
      synologyUrl: ui.synology_url,
      synologyPort: ui.synology_port,
      relativePath: ui.relative_path,
      filename: ui.filename,
      tempSuffix: ui.temp_suffix,
      retryCount: 0,
      addedAt: Date.now(),
      sourceProvider: rec.sourceProvider,
      seafileObjId: rec.seafileObjId,
      isRedrive: true,
    });
    log.info(`Re-driving check-in ${rec.id} (re-uploading snapshot)`);
  } catch (e) {
    log.warn(`Re-drive trigger failed for ${rec.id}:`, (e as Error).message);
  } finally {
    // Clear shortly after so a later genuine re-request can proceed; the server
    // clears redrive_requested immediately, so this mainly guards the in-flight gap.
    redriving.delete(rec.id);
  }
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
