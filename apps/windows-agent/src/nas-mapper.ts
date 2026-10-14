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
import { createHash } from "node:crypto";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

export interface NasCredentials {
  host: string;
  share: string;
  username: string;
  password: string;
}

/** True if the string looks like a drive letter (e.g. "Z:" or "Z") */
/**
 * Remove a secret from text before it is logged or returned. `net use` errors
 * from execFile include the full command line, which carries the NAS password.
 */
export function redactSecret(text: string, secret: string | undefined): string {
  if (!text || !secret) return text;
  return text.split(secret).join("[REDACTED]");
}

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
 * PowerShell script that maps the share. Every value (including the password)
 * is read from environment variables so nothing secret lands in the parent
 * process argv.
 *
 * Session 0 (Windows service) note: `New-SmbMapping` is unreliable there — it
 * can report success while leaving no DOS drive letter that Node's `fs.access`
 * can see, and PowerShell's InitializeDefaultDrives provider error is fatal
 * under `$ErrorActionPreference='Stop'`. `net use` creates a real device the
 * service process can read. The password is still only in the child's env,
 * never in node's argv; redactSecret scrubs it from any net.exe stderr.
 */
export function buildSmbMappingScript(useDrive: boolean, useCreds: boolean): string {
  const parts = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$u=$env:POPDAM_NAS_UNC",
    "$d=$env:POPDAM_NAS_DRIVE",
    "$usr=$env:POPDAM_NAS_USER",
    "$pw=$env:POPDAM_NAS_PASS",
  ];
  if (useDrive && useCreds) parts.push("net use $d $u /user:$usr $pw /persistent:no");
  else if (useDrive) parts.push("net use $d $u /persistent:no");
  else if (useCreds) parts.push("net use $u /user:$usr $pw /persistent:no");
  else parts.push("net use $u /persistent:no");
  // net use exit 2 = "This network connection does not exist" on delete; for
  // map, non-zero with "already connected" is handled by the caller.
  parts.push("exit $LASTEXITCODE");
  return parts.join("; ");
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
  options: { force?: boolean } = {},
): Promise<{ ok: boolean; error?: string }> {
  const { host, share, username, password } = creds;

  if (!host) {
    return {
      ok: false,
      error: "NAS host not configured. The cloud has not delivered NAS credentials to this agent yet. " +
        "Verify that WINDOWS_AGENT_NAS_HOST is saved in PopDAM Settings > Windows Agent > NAS Access, " +
        "then wait for the next heartbeat (30s). " +
        "Current values received: host=" + JSON.stringify(host || "(empty)") +
        ", share=" + JSON.stringify(share || "(empty)") +
        ", mount_path=" + JSON.stringify(mountPath || "(empty)") +
        ", username=" + JSON.stringify(username ? "(set)" : "(empty)") + ".",
    };
  }
  if (!share) {
    return {
      ok: false,
      error: "NAS share not configured. host=" + JSON.stringify(host) +
        " was received but share is empty. " +
        "Set WINDOWS_AGENT_NAS_SHARE in PopDAM Settings > Windows Agent > NAS Access.",
    };
  }

  const cleanHost = host.replace(/^\\+/, "");
  const cleanShare = share.replace(/^\\+/, "").replace(/^\/+/, "");
  const uncPath = `\\\\${cleanHost}\\${cleanShare}`;

  const useDrive = mountPath && mountPath.trim() && isDriveLetter(mountPath);
  const driveLetter = useDrive ? normalizeDrive(mountPath!) : null;
  const verifyPath = driveLetter ? `${driveLetter}\\` : uncPath;

  // 1. Quick check — already accessible? A forced remap (new mapping or new
  // credentials) skips this so the session is rebuilt with the current values.
  if (!options.force) {
    try {
      await access(verifyPath, constants.R_OK);
      logger.debug("NAS already accessible", { path: verifyPath });
      return { ok: true };
    } catch {
      // Not accessible yet — proceed to map
    }
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

  // 3. Map the share.
  // The password must never appear on the agent process command line (readable
  // by any local user via WMI / Task Manager). Map via a PowerShell child and
  // pass every value through that child's environment instead. `net use` is
  // used inside the child because New-SmbMapping is unreliable in Session 0
  // (service context) — see buildSmbMappingScript.
  try {
    const { stderr } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", buildSmbMappingScript(!!driveLetter, !!username)],
      {
        timeout: 15_000,
        windowsHide: true,
        env: {
          ...process.env,
          POPDAM_NAS_UNC: uncPath,
          POPDAM_NAS_DRIVE: driveLetter || "",
          POPDAM_NAS_USER: username || "",
          POPDAM_NAS_PASS: password || "",
        },
      },
    );

    if (stderr && stderr.toLowerCase().includes("error")) {
      logger.warn("net use stderr", { stderr: redactSecret(stderr.trim(), password) });
    }

    logger.info("NAS share mapped successfully", {
      drive: driveLetter || "(UNC)",
      uncPath,
    });
  } catch (e) {
    const msg = redactSecret((e as Error).message, password);
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

/**
 * Stateful wrapper around ensureNasMapped for the render claim loop.
 *
 *  - Failures back off exponentially (5 s doubling to a 5 min cap), so a dead
 *    share is not retried on every poll. Repeated failed logins can get the NAS
 *    to auto-block the agent's IP.
 *  - A change in the configured mount path, host, share, user or password forces
 *    an immediate remap with the new values, bypassing the backoff.
 *  - Credentials are only compared as a SHA-256 digest; they are never stored
 *    or logged in plain text.
 */
export const NAS_REMAP_BASE_MS = 5_000;
export const NAS_REMAP_MAX_MS = 300_000;

export function createNasMountGuard(now: () => number = Date.now) {
  let appliedKey: string | null = null;
  let failures = 0;
  let nextAttemptAt = 0;
  let lastError: string | undefined;

  return async function ensure(
    mountPath: string | undefined,
    creds: NasCredentials,
  ): Promise<{ ok: boolean; error?: string; backingOff?: boolean }> {
    const key = createHash("sha256")
      .update(JSON.stringify([mountPath || "", creds.host, creds.share, creds.username, creds.password]))
      .digest("hex");
    const changed = key !== appliedKey;

    if (!changed && failures > 0 && now() < nextAttemptAt) {
      return { ok: false, error: lastError, backingOff: true };
    }

    const result = await ensureNasMapped(mountPath, creds, { force: changed || failures > 0 });
    if (result.ok) {
      appliedKey = key;
      failures = 0;
      nextAttemptAt = 0;
      lastError = undefined;
      return { ok: true };
    }

    // Remember the values we tried so a later change still forces a remap.
    appliedKey = key;
    failures += 1;
    const delay = Math.min(NAS_REMAP_MAX_MS, NAS_REMAP_BASE_MS * 2 ** (failures - 1));
    nextAttemptAt = now() + delay;
    lastError = result.error;
    return { ok: false, error: result.error, backingOff: false };
  };
}
