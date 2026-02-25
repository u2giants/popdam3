/**
 * Preflight health checks for the Windows Render Agent.
 *
 * Checks NAS accessibility (with drive mapping) and Illustrator COM
 * readiness before allowing the agent to claim render jobs.
 */

import { writeFile, unlink, mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "./logger";
import { ensureNasMapped } from "./nas-mapper";

const execFileAsync = promisify(execFile);

// ── Types ───────────────────────────────────────────────────────

export interface HealthStatus {
  healthy: boolean;
  nasHealthy: boolean;
  illustratorHealthy: boolean;
  illustratorCrashDialog: boolean;
  lastPreflightError: string | null;
  lastPreflightAt: string | null;
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

async function getIllustratorProcessDiagnostics(): Promise<{ raw: string; crashDialogDetected: boolean }> {
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      'Get-Process Illustrator -ErrorAction SilentlyContinue | Select-Object Id,Responding,MainWindowTitle | Format-List',
    ], { timeout: 10_000, windowsHide: true });

    const trimmed = stdout.trim();
    if (!trimmed) return { raw: "No Illustrator process found.", crashDialogDetected: false };

    const lc = trimmed.toLowerCase();
    const crashDialogDetected =
      lc.includes("quit unexpectedly") ||
      lc.includes("crash") ||
      lc.includes("recovery") ||
      lc.includes("safe mode") ||
      lc.includes("not responding") ||
      // Responding : False indicates a hung/blocked process
      /responding\s*:\s*false/i.test(trimmed);

    return { raw: trimmed, crashDialogDetected };
  } catch {
    return { raw: "Diagnostics unavailable (powershell failed).", crashDialogDetected: false };
  }
}

async function checkIllustratorReady(): Promise<{ ok: boolean; error?: string; crashDialogDetected?: boolean }> {
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
      timeout: 30_000,
      windowsHide: true,
    });

    await unlink(vbsPath).catch(() => {});

    if (stderr && stderr.includes("COM_ERROR")) {
      // COM failed — run diagnostics to check for crash dialog
      const diag = await getIllustratorProcessDiagnostics();
      if (diag.crashDialogDetected) {
        return {
          ok: false,
          crashDialogDetected: true,
          error: "Illustrator crash recovery dialog blocking automation. Open Illustrator manually, dismiss the crash recovery / safe mode dialog, then restart the agent.",
        };
      }
      return { ok: false, error: stderr.trim() };
    }
    if (!stdout.includes("OK")) {
      return { ok: false, error: `Unexpected output: ${stdout.substring(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    const msg = (e as Error).message;

    // On any failure, run diagnostics to detect crash dialog
    const diag = await getIllustratorProcessDiagnostics();
    if (diag.crashDialogDetected) {
      return {
        ok: false,
        crashDialogDetected: true,
        error: "Illustrator crash recovery dialog blocking automation. Open Illustrator manually, dismiss the crash recovery / safe mode dialog, then restart the agent.",
      };
    }

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
  nasUsername: string;
  nasPassword: string;
}): Promise<HealthStatus> {
  logger.info("Running preflight health checks...");

  // NAS check — map drive (or authenticate UNC) then verify
  const nasResult = await ensureNasMapped(opts.mountPath, {
    host: opts.nasHost,
    share: opts.nasShare,
    username: opts.nasUsername,
    password: opts.nasPassword,
  });
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
    illustratorCrashDialog: aiResult.crashDialogDetected === true,
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
