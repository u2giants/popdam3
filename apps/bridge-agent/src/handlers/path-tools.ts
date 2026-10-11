/** Moved out of index.ts (#234) — pure move, no behavior change. */
import { stat, readdir } from "node:fs/promises";
import * as api from "../api-client.js";
import { config } from "../config.js";
import { logger } from "../logger.js";

// ── Path Test Handler ────────────────────────────────────────────

export async function handlePathTest(cmd: { request_id: string; container_mount_root: string; scan_roots: string[] }) {
  logger.info("Path test requested", { requestId: cmd.request_id });

  let mountRootValid = false;
  try {
    const s = await stat(cmd.container_mount_root);
    mountRootValid = s.isDirectory();
  } catch { /* not found */ }

  const scanRootResults: Array<{ path: string; valid: boolean; file_count?: number; error?: string }> = [];
  for (const root of cmd.scan_roots) {
    try {
      const s = await stat(root);
      if (!s.isDirectory()) {
        scanRootResults.push({ path: root, valid: false, error: "exists but is not a directory" });
        continue;
      }
      const entries = await readdir(root);
      scanRootResults.push({ path: root, valid: true, file_count: entries.length });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      scanRootResults.push({ path: root, valid: false, error: code === "ENOENT" ? "not found" : code === "EACCES" ? "permission denied" : String(e) });
    }
  }

  await api.reportPathTest(cmd.request_id, {
    mount_root_valid: mountRootValid,
    scan_root_results: scanRootResults,
  });

  logger.info("Path test completed", { mountRootValid, scanRootResults });
}

export async function handleDirBrowse(cmd: { request_id: string; path: string }) {
  const target = cmd.path.trim();
  logger.info("Dir browse requested", { requestId: cmd.request_id, path: target });

  try {
    let entries: api.DirEntry[];

    if (!target) {
      // Empty path → list scan roots
      const scanRootsCfg = config.scanRoots ?? [];
      entries = await Promise.all(
        scanRootsCfg.map(async (root: string) => {
          try {
            const s = await stat(root);
            return { name: root, is_dir: s.isDirectory() };
          } catch {
            return { name: root, is_dir: true };
          }
        })
      );
    } else {
      const rawEntries = await readdir(target, { withFileTypes: true });
      entries = await Promise.all(
        rawEntries.map(async (e) => {
          const entry: api.DirEntry = { name: e.name, is_dir: e.isDirectory() };
          if (!e.isDirectory()) {
            try {
              const s = await stat(`${target}/${e.name}`);
              entry.size = s.size;
              entry.modified = s.mtime.toISOString();
            } catch { /* skip */ }
          }
          return entry;
        })
      );
    }

    await api.reportDirBrowse(cmd.request_id, target, entries);
    logger.info("Dir browse completed", { path: target, count: entries.length });
  } catch (e) {
    const msg = (e as NodeJS.ErrnoException).message ?? String(e);
    logger.warn("Dir browse failed", { path: target, error: msg });
    await api.reportDirBrowse(cmd.request_id, target, []);
  }
}
