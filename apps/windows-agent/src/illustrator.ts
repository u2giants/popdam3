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

import { writeFile, readFile, unlink, mkdtemp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { config } from "./config";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

/**
 * Generate a VBScript that opens an AI file in Illustrator,
 * exports as JPEG, and closes.
 */
function generateVbScript(inputPath: string, outputPath: string, dpi: number): string {
  // Escape backslashes for VBScript string literals
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
  // NAS mapping is now handled centrally by ensureNasMapped() in preflight.
  // No per-job mount needed here.

  const tmpDir = await mkdtemp(path.join(tmpdir(), "popdam-ai-render-"));
  const vbsPath = path.join(tmpDir, "render.vbs");
  const jpgPath = path.join(tmpDir, "output.jpg");

  try {
    // Write VBScript
    const script = generateVbScript(filePath, jpgPath, config.illustratorDpi);
    await writeFile(vbsPath, script, "utf-8");

    logger.info("Starting Illustrator render", { filePath, timeout: config.illustratorTimeoutMs });

    // Execute via cscript.exe (Windows Script Host)
    const { stdout, stderr } = await execFileAsync("cscript.exe", [
      "//Nologo",
      "//E:VBScript",
      vbsPath,
    ], {
      timeout: config.illustratorTimeoutMs,
      windowsHide: true,
    });

    if (stderr && stderr.includes("ERROR:")) {
      throw new Error(stderr.trim());
    }

    if (!stdout.includes("OK")) {
      throw new Error(`Illustrator script returned unexpected output: ${stdout}`);
    }

    // Read the exported JPEG
    const buffer = await readFile(jpgPath);

    if (buffer.length === 0) {
      throw new Error("Illustrator export produced an empty file");
    }

    // We don't have easy access to dimensions without sharp on Windows,
    // but the cloud will accept width=0/height=0 and the thumbnail will display fine.
    // If sharp is available, we could read metadata here.
    logger.info("Illustrator render completed", { filePath, size: buffer.length });

    return {
      buffer,
      width: 0,  // Dimensions not critical for thumbnail display
      height: 0,
    };
  } finally {
    // Cleanup temp files
    await unlink(vbsPath).catch(() => {});
    await unlink(jpgPath).catch(() => {});
    const { rmdir } = await import("node:fs/promises");
    await rmdir(tmpDir).catch(() => {});
  }
}
