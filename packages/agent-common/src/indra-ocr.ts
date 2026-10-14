/**
 * Indra OCR (datalab-to/indra, ONNX on CPU) for rendered PDF pages.
 *
 * Live test (Oct 14 2026, 40 stored pdf_text_samples pages): Indra ~9x faster than
 * tesseract.js and read spec-sheet fields (Date/Manager/License/SKU) where Tesseract
 * produced garbage. Runs through a Python interpreter that has `indra-ocr` installed,
 * named by INDRA_OCR_PYTHON (the bridge image sets it). Models come from
 * INDRA_OCR_MODEL_DIR when set, else the Hugging Face cache.
 *
 * Without INDRA_OCR_PYTHON, `indraPython()` returns null and callers use tesseract.js.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** Python program: argv[1] = page image. Prints the page text (reading order) as UTF-8. */
export const INDRA_OCR_SCRIPT = [
  "import sys, cv2",
  "from indra_ocr import OrtOCR, model_dir",
  "gray = cv2.imread(sys.argv[1], cv2.IMREAD_GRAYSCALE)",
  "if gray is None:",
  "    raise SystemExit('indra: unreadable image')",
  "page = OrtOCR(model_dir(), threads=4)(gray)",
  "sys.stdout.buffer.write(page.text.encode('utf-8'))",
].join("\n");

/** Returns the configured Python executable, or null when Indra is not installed here. */
export function indraPython(): string | null {
  const p = (process.env.INDRA_OCR_PYTHON || "").trim();
  return p.length > 0 ? p : null;
}

/** OCR a PNG buffer with Indra. Throws on failure. The image path is passed as argv, never as code. */
export async function ocrPngWithIndra(pythonExe: string, png: Buffer): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "indra-"));
  const file = path.join(dir, "page.png");
  try {
    await writeFile(file, png);
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        pythonExe,
        ["-c", INDRA_OCR_SCRIPT, file],
        { timeout: 120_000, maxBuffer: 16 * 1024 * 1024, encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
        (err, out, stderr) => (err ? reject(new Error(`${err.message}${stderr ? `: ${String(stderr).slice(-500)}` : ""}`)) : resolve(out)),
      );
    });
    return stdout.trim();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
