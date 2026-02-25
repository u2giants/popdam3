/**
 * NAS drive mapping helper for Windows Render Agent.
 *
 * Ensures the NAS share is accessible before rendering:
 *   - Drive-letter mode (e.g. "Z:"): maps \\host\share → Z: via `net use`
 *   - UNC mode: authenticates \\host\share via `net use` (no drive letter)
 *
 * Idempotent — safe to call repeatedly. Verifies accessibility after mapping.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

export interface NasCredentials {
  host: string;
  share: string;
  username: string;
  password: string;
}

/** True if the string looks like a drive letter (e.g. "Z:" or "Z") */
function isDriveLetter(s: string): boolean {
  const clean = s.trim().replace(/:$/, "");
  return /^[A-Za-z]$/.test(clean);
}

/** Normalize "Z" or "Z:" → "Z:" */
function normalizeDrive(s: string): string {
  const clean = s.trim().replace(/:$/, "").toUpperCase();
  return `${clean}:`;
}

/**
 * Ensure the NAS share is mapped and accessible.
 *
 * @param mountPath  - If set (e.g. "Z:" or "Z"), map the UNC share to this drive letter.
 *                     If empty/undefined, authenticate UNC path without a drive letter.
 * @param creds      - NAS host, share, username, password.
 * @returns           { ok, error? }
 */
export async function ensureNasMapped(
  mountPath: string | undefined,
  creds: NasCredentials,
): Promise<{ ok: boolean; error?: string }> {
  const { host, share, username, password } = creds;

  if (!host) {
    return {
      ok: false,
      error: "NAS host not configured — the cloud has not delivered NAS credentials to this agent yet. " +
        "Verify that WINDOWS_AGENT_NAS_HOST is saved in PopDAM Settings → Windows Agent → NAS Access, " +
        "then wait for the next heartbeat (≤30s). " +
        `Current values received: host="${host || "(empty)}", share="${share || "(empty)}", ` +
        `mount_path="${mountPath || "(empty)}", username="${username ? "(set)" : "(empty)"}".`,
    };
  }
  if (!share) {
    return {
      ok: false,
      error: `NAS share not configured — host="${host}" was received but share is empty. ` +
        "Set WINDOWS_AGENT_NAS_SHARE in PopDAM Settings → Windows Agent → NAS Access.",
    };
  }

  const cleanHost = host.replace(/^\\+/, "");
  const cleanShare = share.replace(/^\\+/, "").replace(/^\/+/, "");
  const uncPath = `\\\\${cleanHost}\\${cleanShare}`;

  const useDrive = mountPath && mountPath.trim() && isDriveLetter(mountPath);
  const driveLetter = useDrive ? normalizeDrive(mountPath!) : null;
  const verifyPath = driveLetter ? `${driveLetter}\\` : uncPath;

  // 1. Quick check — already accessible?
  try {
    await access(verifyPath, constants.R_OK);
    logger.debug("NAS already accessible", { path: verifyPath });
    return { ok: true };
  } catch {
    // Not accessible yet — proceed to map
  }

  // 2. If drive-letter mode, delete any stale mapping first
  if (driveLetter) {
    try {
      await execFileAsync("net", ["use", driveLetter, "/delete", "/yes"], {
        timeout: 10_000,
        windowsHide: true,
      });
      logger.debug("Removed stale drive mapping", { drive: driveLetter });
    } catch {
      // Ignore — may not exist
    }
  }

  // 3. Map the share
  try {
    const args: string[] = ["use"];

    if (driveLetter) {
      // net use Z: \\host\share /user:USERNAME PASSWORD /persistent:no
      args.push(driveLetter, uncPath);
    } else {
      // net use \\host\share /user:USERNAME PASSWORD
      args.push(uncPath);
    }

    if (username) {
      args.push(`/user:${username}`, password || "");
    }

    if (driveLetter) {
      args.push("/persistent:no");
    }

    const { stderr } = await execFileAsync("net", args, {
      timeout: 15_000,
      windowsHide: true,
    });

    if (stderr && stderr.toLowerCase().includes("error")) {
      logger.warn("net use stderr", { stderr: stderr.trim() });
    }

    logger.info("NAS share mapped successfully", {
      drive: driveLetter || "(UNC)",
      uncPath,
    });
  } catch (e) {
    const msg = (e as Error).message;
    // "already connected" is fine — means mapping exists
    if (!msg.includes("already") && !msg.includes("1219")) {
      return {
        ok: false,
        error: `net use failed for ${driveLetter || uncPath}: ${msg}`,
      };
    }
    logger.debug("net use reported already connected — continuing");
  }

  // 4. Verify accessibility after mapping
  try {
    await access(verifyPath, constants.R_OK);
    logger.info("NAS path verified accessible", { path: verifyPath });
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `NAS mapped but path "${verifyPath}" not readable: ${(e as Error).message}`,
    };
  }
}
