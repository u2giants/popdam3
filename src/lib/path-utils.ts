/**
 * Path display utilities — derives display paths from relative_path + config.
 * See docs/PATH_UTILS.md for spec.
 */

export interface NasConfig {
  NAS_HOST: string;
  NAS_IP: string;
  NAS_SHARE: string;
}

export interface PathDisplayModes {
  uncHost: string;
  uncIp: string;
  remote: string | null; // null if USER_SYNC_ROOT not set
}

function toBackslash(p: string): string {
  return p.replace(/\//g, "\\");
}

export function getPathDisplayModes(
  relativePath: string,
  config: NasConfig,
  userSyncRoot?: string | null
): PathDisplayModes {
  const backslashed = toBackslash(relativePath);

  return {
    uncHost: `\\\\${config.NAS_HOST}\\${config.NAS_SHARE}\\${backslashed}`,
    uncIp: `\\\\${config.NAS_IP}\\${config.NAS_SHARE}\\${backslashed}`,
    remote: userSyncRoot
      ? `${userSyncRoot.replace(/[/\\]$/, "")}\\${config.NAS_SHARE}\\${backslashed}`
      : null,
  };
}

export function getUserSyncRoot(): string | null {
  try {
    return localStorage.getItem("popdam_user_sync_root");
  } catch {
    return null;
  }
}
