/**
 * Local file operations: copy, snapshot, stability check, path resolution.
 * Never touches remote systems — that's uploadQueue.ts's job.
 */

import { join, dirname, normalize, isAbsolute, sep } from "path";
import { copyFile, mkdir, stat, open, writeFile, rename, unlink, access } from "fs/promises";
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
import { joinWithinRoot, safePathSegment } from "./pathSafety";

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
  return joinWithinRoot(mapping.local_path, safeRelative);
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
  return joinWithinRoot(join(workspacePath, WORKSPACE_SUBDIR), safePathSegment(checkoutId, "checkout id"));
}

export function snapshotDir(workspacePath: string, checkoutId: string): string {
  return joinWithinRoot(join(workspacePath, SNAPSHOTS_SUBDIR), safePathSegment(checkoutId, "checkout id"));
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
  if (!(await pathExists(sourcePath))) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  const destDir = checkoutDir(workspacePath, checkoutId);
  await mkdir(destDir, { recursive: true });
  const destPath = joinWithinRoot(destDir, safePathSegment(filename));

  log.info(`Copying ${sourcePath} → ${destPath}`);
  await copyFile(sourcePath, destPath);

  const hash = await sha256File(destPath);
  const size = (await stat(destPath)).size;

  return { workspacePath: destPath, hash, size };
}

export async function copySnapshotToManagedPath(
  snapshotPath: string,
  relativePath: string,
  rootMappings: RootMapping[],
  tempSuffix: string,
): Promise<string> {
  const rootId = relativePath.split("/")[0] ?? relativePath.split("\\")[0];
  const finalPath = resolveAssetPath(rootId, relativePath, rootMappings);
  const finalDir = dirname(finalPath);
  const tempPath = join(finalDir, `${finalPath.split(/[\\/]/).pop() ?? "upload"}${tempSuffix}`);

  await mkdir(finalDir, { recursive: true });
  log.info(`Copying ${snapshotPath} → ${tempPath}`);
  await copyFile(snapshotPath, tempPath);
  try {
    await rename(tempPath, finalPath);
  } catch (e) {
    await unlink(tempPath).catch(() => { /* best effort cleanup */ });
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

export async function writeCheckoutMeta(destDir: string, meta: CheckoutMeta): Promise<void> {
  await writeFile(
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

    let st;
    try {
      st = await stat(filePath);
    } catch {
      throw new Error(`File disappeared during stability check: ${filePath}`);
    }
    const size = st.size;
    const mtime = st.mtimeMs;

    if (size === lastSize && mtime === lastMtime) {
      stableCount++;
      if (stableCount >= 2) {
        // Try to open for exclusive read to confirm not locked
        try {
          const fh = await open(filePath, "r");
          await fh.close();
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
  await mkdir(snapDir, { recursive: true });
  const snapPath = joinWithinRoot(snapDir, safePathSegment(filename));

  log.info(`Snapshotting ${workspaceFilePath} → ${snapPath}`);
  await copyFile(workspaceFilePath, snapPath);

  const hash = await sha256File(snapPath);
  const size = (await stat(snapPath)).size;

  return { snapshotPath: snapPath, hash, size };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
