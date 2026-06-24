/**
 * Local file operations: copy, snapshot, stability check, path resolution.
 * Never touches remote systems — that's uploadQueue.ts's job.
 */

import { join, dirname, normalize, isAbsolute, sep } from "path";
import {
  copyFileSync, mkdirSync, existsSync, statSync, openSync, closeSync, writeFileSync,
  renameSync, unlinkSync,
} from "fs";
import { app } from "electron";
import { sha256File } from "./hash";
import { log } from "./logger";
import {
  STABILITY_WAIT_MS,
  STABILITY_MAX_ATTEMPTS,
  WORKSPACE_SUBDIR,
  SNAPSHOTS_SUBDIR,
} from "@shared/constants";
import type { RootMapping } from "@shared/types";

// ── Path construction ─────────────────────────────────────────────────────────

/**
 * Resolve an asset's source path from its root_id + relative_path.
 * Throws if root_id is unmapped or relative_path is unsafe.
 */
export function resolveAssetPath(
  rootId: string,
  relativePath: string,
  rootMappings: RootMapping[],
): string {
  const mapping = rootMappings.find((m) => m.root_id === rootId);
  if (!mapping) throw new Error(`No local mapping for root_id "${rootId}"`);

  const safeRelative = sanitizeRelativePath(stripRootSegment(rootId, relativePath));
  return join(mapping.local_path, safeRelative);
}

function stripRootSegment(rootId: string, relativePath: string): string {
  const parts = relativePath.replace(/\\/g, "/").replace(/^\/+/, "").split("/");
  if (parts[0]?.toLowerCase() === rootId.toLowerCase()) {
    return parts.slice(1).join("/");
  }
  return relativePath;
}

/**
 * Reject relative paths that try to escape the root.
 */
function sanitizeRelativePath(p: string): string {
  // Normalize all separators
  const normalized = normalize(p.replace(/\\/g, "/"));
  // Reject absolute paths, UNC paths, drive letters, or traversals
  if (
    isAbsolute(normalized) ||
    normalized.startsWith("..") ||
    normalized.includes(".." + sep) ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.startsWith("//") ||
    normalized.startsWith("\\\\")
  ) {
    throw new Error(`Unsafe relative path rejected: "${p}"`);
  }
  return normalized;
}

// ── Workspace paths ───────────────────────────────────────────────────────────

export function workspaceBase(configWorkspacePath: string): string {
  return configWorkspacePath || join(app.getPath("userData"), "workspace");
}

export function checkoutDir(workspacePath: string, checkoutId: string): string {
  return join(workspacePath, WORKSPACE_SUBDIR, checkoutId);
}

export function snapshotDir(workspacePath: string, checkoutId: string): string {
  return join(workspacePath, SNAPSHOTS_SUBDIR, checkoutId);
}

// ── Copy to workspace ─────────────────────────────────────────────────────────

export interface CopiedFile {
  workspacePath: string;
  hash: string;
  size: number;
}

export async function copyToWorkspace(
  sourcePath: string,
  checkoutId: string,
  filename: string,
  workspacePath: string,
): Promise<CopiedFile> {
  if (!existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  const destDir = checkoutDir(workspacePath, checkoutId);
  mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, filename);

  log.info(`Copying ${sourcePath} → ${destPath}`);
  copyFileSync(sourcePath, destPath);

  const hash = await sha256File(destPath);
  const size = statSync(destPath).size;

  return { workspacePath: destPath, hash, size };
}

export function copySnapshotToManagedPath(
  snapshotPath: string,
  relativePath: string,
  rootMappings: RootMapping[],
  tempSuffix: string,
): string {
  const rootId = relativePath.split("/")[0] ?? relativePath.split("\\")[0];
  const finalPath = resolveAssetPath(rootId, relativePath, rootMappings);
  const finalDir = dirname(finalPath);
  const tempPath = join(finalDir, `${finalPath.split(/[\\/]/).pop() ?? "upload"}${tempSuffix}`);

  mkdirSync(finalDir, { recursive: true });
  log.info(`Copying ${snapshotPath} → ${tempPath}`);
  copyFileSync(snapshotPath, tempPath);
  try {
    renameSync(tempPath, finalPath);
  } catch (e) {
    try { unlinkSync(tempPath); } catch { /* best effort cleanup */ }
    throw e;
  }
  return finalPath;
}

// ── Checkout metadata sidecar ─────────────────────────────────────────────────

export interface CheckoutMeta {
  checkout_id: string;
  asset_id: string;
  root_id: string;
  relative_path: string;
  filename: string;
  checked_out_at: string;
  source_hash: string;
  source_size: number;
  dam_url: string;
  // Storage provider the source was read from (default "synology" when absent).
  source_provider?: string;
  source_local_path?: string;
  seafile_obj_id?: string;
}

export function writeCheckoutMeta(destDir: string, meta: CheckoutMeta): void {
  writeFileSync(
    join(destDir, ".pop-checkout.json"),
    JSON.stringify(meta, null, 2),
    "utf-8",
  );
}

// ── File stability check ──────────────────────────────────────────────────────

export async function waitForFileStable(filePath: string): Promise<void> {
  let lastSize = -1;
  let lastMtime = -1;
  let stableCount = 0;

  for (let attempt = 0; attempt < STABILITY_MAX_ATTEMPTS; attempt++) {
    await sleep(STABILITY_WAIT_MS);

    if (!existsSync(filePath)) {
      throw new Error(`File disappeared during stability check: ${filePath}`);
    }

    const stat = statSync(filePath);
    const size = stat.size;
    const mtime = stat.mtimeMs;

    if (size === lastSize && mtime === lastMtime) {
      stableCount++;
      if (stableCount >= 2) {
        // Try to open for exclusive read to confirm not locked
        try {
          const fd = openSync(filePath, "r");
          closeSync(fd);
        } catch {
          // Still locked — keep waiting
          stableCount = 0;
          continue;
        }
        return; // stable
      }
    } else {
      stableCount = 0;
    }

    lastSize = size;
    lastMtime = mtime;
  }

  throw new Error(
    `File "${filePath}" did not stabilize after ${STABILITY_MAX_ATTEMPTS} checks. It may still be saving.`,
  );
}

// ── Snapshot ──────────────────────────────────────────────────────────────────

export interface Snapshot {
  snapshotPath: string;
  hash: string;
  size: number;
}

export async function createSnapshot(
  workspaceFilePath: string,
  checkoutId: string,
  filename: string,
  workspacePath: string,
): Promise<Snapshot> {
  const snapDir = snapshotDir(workspacePath, checkoutId);
  mkdirSync(snapDir, { recursive: true });
  const snapPath = join(snapDir, filename);

  log.info(`Snapshotting ${workspaceFilePath} → ${snapPath}`);
  copyFileSync(workspaceFilePath, snapPath);

  const hash = await sha256File(snapPath);
  const size = statSync(snapPath).size;

  return { snapshotPath: snapPath, hash, size };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
