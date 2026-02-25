/**
 * Illustrator COM automation via VBScript.
 *
 * Generates a JPG thumbnail by:
 *   1. Writing a temporary VBScript that opens the .ai file in Illustrator
 *   2. Exports as JPEG at the configured DPI
 *   3. Closes the document
 *
 * Requirements:
 *   - Adobe Illustrator installed on the Windows machine
 *   - Node.js running on Windows with access to cscript.exe
 */

import { writeFile, readFile, unlink, mkdtemp, access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "./config";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

// ── Stable error codes ──────────────────────────────────────────

export const IllustratorErrorCode = {
  COM_CREATE_FAILED: "ILLUSTRATOR_COM_CREATE_FAILED",
  OPEN_FAILED: "ILLUSTRATOR_OPEN_FAILED",
  EXPORT_FAILED: "ILLUSTRATOR_EXPORT_FAILED",
  TIMEOUT: "ILLUSTRATOR_TIMEOUT",
  EMPTY_OUTPUT: "ILLUSTRATOR_EMPTY_OUTPUT",
  UNEXPECTED: "ILLUSTRATOR_UNEXPECTED_ERROR",
} as const;

type IllustratorErrorCodeValue = typeof IllustratorErrorCode[keyof typeof IllustratorErrorCode];

const EXIT_CODE_MAP: Record<number, { code: IllustratorErrorCodeValue; hint: string }> = {
  1: { code: IllustratorErrorCode.COM_CREATE_FAILED, hint: "Could not create Illustrator.Application COM object. Is Illustrator installed and licensed?" },
  2: { code: IllustratorErrorCode.OPEN_FAILED, hint: "Illustrator could not open the file. It may be corrupted, password-protected, or created with an incompatible version." },
  3: { code: IllustratorErrorCode.EXPORT_FAILED, hint: "JPEG export failed. Possible disk-full or permission issue in temp directory." },
};

// ── cscript.exe path resolution ─────────────────────────────────

let resolvedCscriptPath: string | null = null;

async function resolveCscriptPath(): Promise<string> {
  if (resolvedCscriptPath) return resolvedCscriptPath;

  // Prefer Sysnative to escape WoW64 redirection (32-bit Node on 64-bit Windows)
  const sysnative = "C:\\Windows\\Sysnative\\cscript.exe";
  const system32 = "C:\\Windows\\System32\\cscript.exe";

  for (const candidate of [sysnative, system32]) {
    try {
      await access(candidate);
      resolvedCscriptPath = candidate;
      logger.info("Resolved cscript.exe path", { path: candidate });
      return candidate;
    } catch {
      // not available, try next
    }
  }

  // Final fallback: rely on PATH
  logger.warn("Could not find cscript.exe at known paths, falling back to PATH lookup");
  resolvedCscriptPath = "cscript.exe";
  return "cscript.exe";
}

// ── Post-failure diagnostics ────────────────────────────────────

async function getIllustratorDiagnostics(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      'Get-Process Illustrator -ErrorAction SilentlyContinue | Select-Object Id,Responding,MainWindowTitle | Format-List',
    ], { timeout: 10_000, windowsHide: true });

    const trimmed = stdout.trim();
    if (!trimmed) return "No Illustrator process found.";
    return trimmed;
  } catch {
    return "Diagnostics unavailable (powershell failed).";
  }
}

function buildErrorMessage(
  code: IllustratorErrorCodeValue,
  hint: string,
  diagnostics: string,
  rawDetail?: string,
): string {
  const parts = [`[${code}] ${hint}`];
  if (rawDetail) parts.push(`Detail: ${rawDetail}`);
  parts.push(`Illustrator process state:\n${diagnostics}`);
  return parts.join("\n");
}

// ── VBScript generation ─────────────────────────────────────────

const THUMB_MAX_DIM = 1200;

function generateVbScript(inputPath: string, outputPath: string, _dpi: number): string {
  const escapedInput = inputPath.replace(/\\/g, "\\\\");
  const escapedOutput = outputPath.replace(/\\/g, "\\\\");

  return `
Option Explicit
On Error Resume Next

Dim appRef
Set appRef = CreateObject("Illustrator.Application")

If Err.Number <> 0 Then
  WScript.StdErr.Write "ERROR: Could not start Illustrator: " & Err.Description
  WScript.Quit 1
End If

Err.Clear

' Suppress all dialogs and alerts
appRef.UserInteractionLevel = -1

' Open the file with options to ignore missing links
Dim openOptions
Set openOptions = CreateObject("Illustrator.OpenOptions")
openOptions.UpdateLinks = 2

Dim docRef
Set docRef = appRef.Open("${escapedInput}", 1, openOptions)

If Err.Number <> 0 Then
  WScript.StdErr.Write "ERROR: Could not open file: " & Err.Description
  WScript.Quit 2
End If

Err.Clear

' Configure JPEG export options
Dim exportOptions
Set exportOptions = CreateObject("Illustrator.ExportOptionsJPEG")
exportOptions.QualityFactor = 85
exportOptions.HorizontalScale = 100
exportOptions.VerticalScale = 100
exportOptions.AntiAliasing = True
exportOptions.Optimization = True

' Calculate scale to fit within ${THUMB_MAX_DIM}px
Dim docWidth, docHeight, scale
docWidth = docRef.Width
docHeight = docRef.Height

If docWidth > docHeight Then
  If docWidth > ${THUMB_MAX_DIM} Then
    scale = (${THUMB_MAX_DIM} / docWidth) * 100
  Else
    scale = 100
  End If
Else
  If docHeight > ${THUMB_MAX_DIM} Then
    scale = (${THUMB_MAX_DIM} / docHeight) * 100
  Else
    scale = 100
  End If
End If

exportOptions.HorizontalScale = scale
exportOptions.VerticalScale = scale

' Export
Dim outputFile
Set outputFile = CreateObject("Scripting.FileSystemObject")
docRef.Export "${escapedOutput}", 1, exportOptions

If Err.Number <> 0 Then
  WScript.StdErr.Write "ERROR: Export failed: " & Err.Description
  docRef.Close 2 ' Close without saving
  WScript.Quit 3
End If

' Close without saving
docRef.Close 2

WScript.StdOut.Write "OK"
WScript.Quit 0
`.trim();
}

export interface RenderResult {
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * Render an AI file using Adobe Illustrator's COM interface.
 * Returns the JPEG buffer.
 */
export async function renderWithIllustrator(
  filePath: string,
): Promise<RenderResult> {
  const cscriptPath = await resolveCscriptPath();
  const tmpDir = await mkdtemp(path.join(tmpdir(), "popdam-ai-render-"));
  const vbsPath = path.join(tmpDir, "render.vbs");
  const jpgPath = path.join(tmpDir, "output.jpg");

  try {
    const script = generateVbScript(filePath, jpgPath, config.illustratorDpi);
    await writeFile(vbsPath, script, "utf-8");

    logger.info("Starting Illustrator render", { filePath, cscriptPath, timeout: config.illustratorTimeoutMs });

    let stdout = "";
    let stderr = "";
    let exitCode: number | null = null;

    try {
      const result = await execFileAsync(cscriptPath, [
        "//Nologo",
        "//E:VBScript",
        vbsPath,
      ], {
        timeout: config.illustratorTimeoutMs,
        windowsHide: true,
      });
      stdout = result.stdout;
      stderr = result.stderr;
      exitCode = 0;
    } catch (execErr: unknown) {
      const e = execErr as { code?: string; killed?: boolean; signal?: string; stderr?: string; stdout?: string };

      // Timeout detection
      if (e.killed || e.code === "ETIMEDOUT" || e.signal === "SIGTERM") {
        const diagnostics = await getIllustratorDiagnostics();
        throw new Error(buildErrorMessage(
          IllustratorErrorCode.TIMEOUT,
          `Illustrator did not respond within ${config.illustratorTimeoutMs}ms. It may be blocked by a crash-recovery or licensing dialog.`,
          diagnostics,
        ));
      }

      // Non-zero exit code
      stderr = e.stderr || "";
      stdout = e.stdout || "";
      // Extract exit code from the error object
      const exitMatch = String(execErr).match(/exit code (\d+)/i);
      exitCode = exitMatch ? parseInt(exitMatch[1], 10) : null;

      // Also check for the 'code' property being a number
      if (exitCode === null && typeof (execErr as { code?: unknown }).code === "number") {
        exitCode = (execErr as { code: number }).code;
      }
    }

    // Map exit code to structured error
    if (exitCode !== 0) {
      const diagnostics = await getIllustratorDiagnostics();
      const mapped = exitCode !== null ? EXIT_CODE_MAP[exitCode] : undefined;

      if (mapped) {
        throw new Error(buildErrorMessage(
          mapped.code,
          mapped.hint,
          diagnostics,
          stderr.trim() || undefined,
        ));
      }

      // Unknown exit code
      throw new Error(buildErrorMessage(
        IllustratorErrorCode.UNEXPECTED,
        `VBScript exited with code ${exitCode}.`,
        diagnostics,
        stderr.trim() || stdout.trim() || undefined,
      ));
    }

    // Verify stderr for ERROR markers even on exit 0
    if (stderr && stderr.includes("ERROR:")) {
      const diagnostics = await getIllustratorDiagnostics();
      throw new Error(buildErrorMessage(
        IllustratorErrorCode.UNEXPECTED,
        "VBScript reported an error on stderr despite exit code 0.",
        diagnostics,
        stderr.trim(),
      ));
    }

    if (!stdout.includes("OK")) {
      const diagnostics = await getIllustratorDiagnostics();
      throw new Error(buildErrorMessage(
        IllustratorErrorCode.UNEXPECTED,
        "VBScript did not output 'OK'.",
        diagnostics,
        stdout.substring(0, 300),
      ));
    }

    // Read the exported JPEG
    const buffer = await readFile(jpgPath);

    if (buffer.length === 0) {
      throw new Error(buildErrorMessage(
        IllustratorErrorCode.EMPTY_OUTPUT,
        "Illustrator export produced an empty file.",
        await getIllustratorDiagnostics(),
      ));
    }

    logger.info("Illustrator render completed", { filePath, size: buffer.length });

    return {
      buffer,
      width: 0,
      height: 0,
    };
  } finally {
    await unlink(vbsPath).catch(() => {});
    await unlink(jpgPath).catch(() => {});
    const { rmdir } = await import("node:fs/promises");
    await rmdir(tmpDir).catch(() => {});
  }
}
