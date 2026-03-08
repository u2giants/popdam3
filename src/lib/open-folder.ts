/**
 * Open Folder via popdam:// protocol handler.
 * Generates the URI from an asset's relative_path + user's path preference.
 */

import { getPathDisplayModes, getUserSyncRoot, type NasConfig } from "@/lib/path-utils";

export type PathMode = "unc_host" | "unc_ip" | "synology_drive";

const STORAGE_KEY = "popdam_open_folder_mode";

export function getPreferredPathMode(): PathMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "unc_host" || v === "unc_ip" || v === "synology_drive") return v;
  } catch { /* ignore */ }
  return "unc_host";
}

export function setPreferredPathMode(mode: PathMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch { /* ignore */ }
}

/**
 * Given a relative_path and NAS config, resolve the folder path
 * according to the user's preferred mode.
 */
export function resolveOpenFolderPath(
  relativePath: string,
  nasConfig: NasConfig,
  mode?: PathMode,
): string | null {
  const m = mode ?? getPreferredPathMode();
  const displays = getPathDisplayModes(relativePath, nasConfig, getUserSyncRoot());

  let fullPath: string | null = null;
  switch (m) {
    case "unc_host":
      fullPath = displays.uncHost;
      break;
    case "unc_ip":
      fullPath = displays.uncIp;
      break;
    case "synology_drive":
      fullPath = displays.remote;
      break;
  }

  if (!fullPath) return null;

  // Get the parent folder (strip the filename)
  const lastSep = Math.max(fullPath.lastIndexOf("\\"), fullPath.lastIndexOf("/"));
  if (lastSep <= 0) return fullPath;
  return fullPath.substring(0, lastSep);
}

/**
 * Build the popdam:// URI for opening a folder.
 */
export function buildOpenFolderUri(folderPath: string): string {
  return `popdam://open-folder?path=${encodeURIComponent(folderPath)}`;
}

function launchProtocol(uri: string) {
  // Use an anchor click with target="_top" to escape iframe sandboxing
  const a = document.createElement("a");
  a.href = uri;
  a.target = "_top";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 100);
}

/**
 * Trigger the popdam:// protocol to open a folder.
 * Returns false if no valid path could be resolved.
 */
export function openAssetFolder(
  relativePath: string,
  nasConfig: NasConfig,
  mode?: PathMode,
): boolean {
  const folder = resolveOpenFolderPath(relativePath, nasConfig, mode);
  if (!folder) return false;
  launchProtocol(buildOpenFolderUri(folder));
  return true;
}
