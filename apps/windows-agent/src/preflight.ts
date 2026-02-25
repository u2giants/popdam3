/**
 * Preflight health checks for the Windows Render Agent.
 *
 * Checks NAS accessibility and Illustrator COM readiness before
 * allowing the agent to claim render jobs.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, writeFile, unlink, mkdtemp } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

// ── Types ───────────────────────────────────────────────────────

export interface HealthStatus {
  healthy: boolean;
  nasHealthy: boolean;
  illustratorHealthy: boolean;
  lastPreflightError: string | null;
  lastPreflightAt: string | null;
}

// ── NAS check ───────────────────────────────────────────────────

async function checkNasAccess(
  mountPath: string | undefined,
  nasHost: string,
  nasShare: string,
): Promise<{ ok: boolean; error?: string }> {
  let targetPath: string;

  if (mountPath && mountPath.trim()) {
    // Mapped drive mode — check the root of the mount
    targetPath = mountPath.trim().replace(/\\+$/, "") + "\\";
  } else if (nasHost) {
    // UNC mode
    const host = nasHost.replace(/^\\+/, "");
    const share = nasShare.replace(/^\\+/, "").replace(/^\/+/, "");
    targetPath = `\\\\${host}\\${share}`;
  } else {
    return { ok: false, error: "No NAS path configured (neither mount path nor UNC host)" };
  }

  try {
    await access(targetPath, constants.R_OK);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: `Cannot read NAS path "${targetPath}": ${(e as Error).message}`,
    };
  }
}

// ── Illustrator COM smoke test ──────────────────────────────────

const ILLUSTRATOR_SMOKE_VBS = `
Option Explicit
On Error Resume Next

Dim appRef
Set appRef = CreateObject("Illustrator.Application")

If Err.Number <> 0 Then
  WScript.StdErr.Write "COM_ERROR: " & Err.Description
  WScript.Quit 1
End If

' Suppress dialogs
appRef.UserInteractionLevel = -1

WScript.StdOut.Write "OK"
WScript.Quit 0
`.trim();

async function checkIllustratorReady(): Promise<{ ok: boolean; error?: string }> {
  let tmpDir: string | undefined;
  try {
    tmpDir = await mkdtemp(path.join(tmpdir(), "popdam-preflight-"));
    const vbsPath = path.join(tmpDir, "smoke.vbs");
    await writeFile(vbsPath, ILLUSTRATOR_SMOKE_VBS, "utf-8");

    const { stdout, stderr } = await execFileAsync("cscript.exe", [
      "//Nologo",
      "//E:VBScript",
      vbsPath,
    ], {
      timeout: 30_000, // 30s — Illustrator can be slow to start
      windowsHide: true,
    });

    // Cleanup
    await unlink(vbsPath).catch(() => {});

    if (stderr && stderr.includes("COM_ERROR")) {
      return { ok: false, error: stderr.trim() };
    }
    if (!stdout.includes("OK")) {
      return { ok: false, error: `Unexpected output: ${stdout.substring(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("ETIMEDOUT") || msg.includes("timed out")) {
      return {
        ok: false,
        error: "Illustrator COM timed out (30s). It may be blocked by a crash-recovery or licensing dialog.",
      };
    }
    return { ok: false, error: `Illustrator COM check failed: ${msg}` };
  } finally {
    if (tmpDir) {
      const { rmdir } = await import("node:fs/promises");
      await rmdir(tmpDir).catch(() => {});
    }
  }
}

// ── Main preflight ──────────────────────────────────────────────

export async function runPreflight(opts: {
  mountPath?: string;
  nasHost: string;
  nasShare: string;
}): Promise<HealthStatus> {
  logger.info("Running preflight health checks...");

  const nasResult = await checkNasAccess(opts.mountPath, opts.nasHost, opts.nasShare);
  if (nasResult.ok) {
    logger.info("  ✓ NAS access OK");
  } else {
    logger.error("  ✗ NAS access FAILED", { error: nasResult.error });
  }

  const aiResult = await checkIllustratorReady();
  if (aiResult.ok) {
    logger.info("  ✓ Illustrator COM OK");
  } else {
    logger.error("  ✗ Illustrator COM FAILED", { error: aiResult.error });
  }

  const healthy = nasResult.ok && aiResult.ok;
  const errors: string[] = [];
  if (nasResult.error) errors.push(nasResult.error);
  if (aiResult.error) errors.push(aiResult.error);

  const status: HealthStatus = {
    healthy,
    nasHealthy: nasResult.ok,
    illustratorHealthy: aiResult.ok,
    lastPreflightError: errors.length > 0 ? errors.join("; ") : null,
    lastPreflightAt: new Date().toISOString(),
  };

  if (healthy) {
    logger.info("Preflight PASSED — agent is healthy");
  } else {
    logger.warn("Preflight FAILED — agent will NOT claim render jobs", {
      nasHealthy: nasResult.ok,
      illustratorHealthy: aiResult.ok,
    });
  }

  return status;
}
