/**
 * Fallback decoder for PSD files that ImageMagick cannot read.
 *
 * Live finding (Oct 13 2026, EDGE-ALIEN): ImageMagick 7.1.2-31 fails with
 * "unable to decompress image ... psd.c/ReadPSDChannel" on some 8-bit CMYK PSDs.
 * psd-tools (Python, composite of the merged image) decodes the same file.
 *
 * Used only when the env var PSD_TOOLS_PYTHON names a Python with psd-tools
 * installed. Without it the fallback is off and the failure is reported as before.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The ImageMagick failure this fallback exists for. */
export function isPsdDecodeFailure(message: string): boolean {
  return /unable to decompress image|ReadPSDChannel/.test(message);
}

/** Python program: argv[1] = source .psd, argv[2] = output .png. Composite of merged image. */
export const PSD_TOOLS_SCRIPT = [
  "import sys",
  "from psd_tools import PSDImage",
  "img = PSDImage.open(sys.argv[1]).composite()",
  "if img is None:",
  "    raise SystemExit('psd_tools: no composite image')",
  "img.convert('RGB').save(sys.argv[2], 'PNG')",
].join("\n");

/** Returns the configured Python executable, or null when the fallback is off. */
export function psdToolsPython(): string | null {
  const p = (process.env.PSD_TOOLS_PYTHON || "").trim();
  return p.length > 0 ? p : null;
}

/**
 * Decode `psdPath` to a PNG at `outPng` with psd-tools. Throws on failure.
 * The script is passed with `-c`, so the file path is never interpolated into code.
 */
export async function compositePsdWithPsdTools(pythonExe: string, psdPath: string, outPng: string): Promise<void> {
  await execFileAsync(pythonExe, ["-c", PSD_TOOLS_SCRIPT, psdPath, outPng], { timeout: 180_000 });
}
