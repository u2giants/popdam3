/**
 * Path display + parsing utilities — derives display paths from relative_path + config.
 * See docs/PATH_UTILS.md for spec.
 */

export interface NasConfig {
  NAS_HOST: string;
  NAS_IP: string;
  NAS_SHARE: string;
  NAS_CONTAINER_MOUNT_ROOT?: string;
}

export interface PathDisplayModes {
  uncHost: string;
  uncIp: string;
  remote: string | null;
  container: string | null;
}

function toBackslash(p: string): string {
  return p.replace(/\//g, "\\");
}

/**
 * Normalize a relative path: forward slashes, no leading/trailing slash,
 * collapse repeated separators, reject ".." traversal.
 */
export function normalizeRelativePath(input: string): string {
  let p = input.replace(/\\/g, "/");
  p = p.replace(/\/+/g, "/");
  p = p.replace(/^\//, "").replace(/\/$/, "");
  p = p.trim();
  if (p.includes("..")) throw new Error("Path traversal (..) not allowed");
  return p;
}

export function getPathDisplayModes(
  relativePath: string,
  config: NasConfig,
  userSyncRoot?: string | null
): PathDisplayModes {
  const backslashed = toBackslash(relativePath);
  const share = config.NAS_SHARE;

  return {
    uncHost: `\\\\${config.NAS_HOST}\\${share}\\${backslashed}`,
    uncIp: `\\\\${config.NAS_IP}\\${share}\\${backslashed}`,
    remote: userSyncRoot
      ? `${userSyncRoot.replace(/[/\\]$/, "")}\\${share}\\${backslashed}`
      : null,
    container: config.NAS_CONTAINER_MOUNT_ROOT
      ? `${config.NAS_CONTAINER_MOUNT_ROOT.replace(/\/$/, "")}/${relativePath}`
      : null,
  };
}

export interface ParseResult {
  valid: boolean;
  relativePath: string | null;
  error?: string;
  displays?: PathDisplayModes;
}

/**
 * Parse any supported input path and extract the canonical relative_path.
 * Supports: UNC (host/IP), container path, Synology Drive local path, already-relative.
 */
export function parseInputPath(
  input: string,
  config: NasConfig,
  userSyncRoot?: string | null
): ParseResult {
  const trimmed = input.trim();
  if (!trimmed) return { valid: false, relativePath: null, error: "Empty input" };

  const shareLower = config.NAS_SHARE.toLowerCase();

  try {
    // UNC path: \\host\share\...  or  \\ip\share\...
    if (trimmed.startsWith("\\\\")) {
      const parts = trimmed.replace(/\\\\/g, "").split("\\").filter(Boolean);
      if (parts.length < 2) return { valid: false, relativePath: null, error: "Invalid UNC path" };
      const hostOrIp = parts[0];
      const share = parts[1];
      if (share.toLowerCase() !== shareLower) {
        return { valid: false, relativePath: null, error: `PATH_OUT_OF_SCOPE: path is not inside configured NAS share '${config.NAS_SHARE}'` };
      }
      const rel = normalizeRelativePath(parts.slice(2).join("/"));
      return {
        valid: true,
        relativePath: rel,
        displays: getPathDisplayModes(rel, config, userSyncRoot),
      };
    }

    // Container path: /mnt/nas/mac/...
    if (config.NAS_CONTAINER_MOUNT_ROOT) {
      const mountRoot = config.NAS_CONTAINER_MOUNT_ROOT.replace(/\/$/, "");
      if (trimmed.startsWith(mountRoot + "/") || trimmed === mountRoot) {
        const after = trimmed.slice(mountRoot.length);
        const rel = normalizeRelativePath(after);
        return {
          valid: true,
          relativePath: rel,
          displays: getPathDisplayModes(rel, config, userSyncRoot),
        };
      }
    }

    // Synology Drive local path
    if (userSyncRoot) {
      const syncNorm = userSyncRoot.replace(/\\/g, "/").replace(/\/$/, "").toLowerCase();
      const inputNorm = trimmed.replace(/\\/g, "/").toLowerCase();
      if (inputNorm.startsWith(syncNorm + "/")) {
        const after = trimmed.replace(/\\/g, "/").slice(syncNorm.length + 1);
        // Strip share prefix if present
        const afterParts = after.split("/");
        if (afterParts[0]?.toLowerCase() === shareLower) {
          const rel = normalizeRelativePath(afterParts.slice(1).join("/"));
          return {
            valid: true,
            relativePath: rel,
            displays: getPathDisplayModes(rel, config, userSyncRoot),
          };
        }
        return { valid: false, relativePath: null, error: `PATH_OUT_OF_SCOPE: share '${config.NAS_SHARE}' not found after sync root` };
      }
    }

    // Check if it contains share name somewhere (generic POSIX path with share)
    const posixInput = trimmed.replace(/\\/g, "/");
    const posixParts = posixInput.split("/").filter(Boolean);
    const shareIdx = posixParts.findIndex(p => p.toLowerCase() === shareLower);
    if (shareIdx >= 0 && shareIdx < posixParts.length - 1) {
      const rel = normalizeRelativePath(posixParts.slice(shareIdx + 1).join("/"));
      return {
        valid: true,
        relativePath: rel,
        displays: getPathDisplayModes(rel, config, userSyncRoot),
      };
    }

    // Already relative (no share prefix needed)
    if (!trimmed.startsWith("/") && !trimmed.startsWith("\\") && !trimmed.includes(":")) {
      const rel = normalizeRelativePath(trimmed);
      return {
        valid: true,
        relativePath: rel,
        displays: getPathDisplayModes(rel, config, userSyncRoot),
      };
    }

    return { valid: false, relativePath: null, error: "Could not parse path format" };
  } catch (e) {
    return { valid: false, relativePath: null, error: e instanceof Error ? e.message : "Parse error" };
  }
}

export function getUserSyncRoot(): string | null {
  try {
    return localStorage.getItem("popdam_user_sync_root");
  } catch {
    return null;
  }
}

export function setUserSyncRoot(path: string) {
  try {
    localStorage.setItem("popdam_user_sync_root", path);
  } catch {
    // silently fail
  }
}
