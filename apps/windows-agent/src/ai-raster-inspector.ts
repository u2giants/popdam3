/**
 * AI Raster Inspector — detects embedded rasters in .ai files.
 *
 * Since .ai files are PDF-compatible, we use Ghostscript to enumerate
 * embedded image XObjects and report their sizes.
 *
 * Threshold: only flags files with embedded rasters > 5 MB total.
 *
 * Future enhancement: Illustrator ExtendScript for even deeper
 * inspection (PlacedItem vs RasterItem enumeration).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const EMBEDDED_RASTER_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5 MB

// ── Ghostscript path discovery (shared with renderer) ───────────

function findGhostscript(): string {
  if (process.env.GS_PATH) return process.env.GS_PATH;

  const gsRoot = "C:\\Program Files\\gs";
  try {
    const versions = readdirSync(gsRoot)
      .filter((d: string) => d.startsWith("gs"))
      .sort()
      .reverse();
    for (const v of versions) {
      const candidate = `${gsRoot}\\${v}\\bin\\gswin64c.exe`;
      if (existsSync(candidate)) return candidate;
    }
  } catch { /* not found */ }

  return "gswin64c";
}

const GS_EXE = findGhostscript();

export interface RasterFinding {
  index: number;
  width: number;
  height: number;
  bitsPerComponent: number;
  colorSpace: string;
  estimatedBytes: number;
}

export interface InspectionResult {
  hasEmbeddedRasters: boolean;
  totalEmbeddedBytes: number;
  largestRasterBytes: number;
  embeddedCount: number;
  rasterItems: RasterFinding[];
  exceedsThreshold: boolean;
  inspectionMethod: string;
  error?: string;
}

/**
 * Inspect an AI file for embedded raster images.
 *
 * Strategy: Use a small PostScript program via Ghostscript that
 * enumerates XObject images in the PDF and reports their dimensions.
 * We estimate size from width × height × components × (bpc/8).
 */
export async function inspectAiFile(filePath: string): Promise<InspectionResult> {
  const empty: InspectionResult = {
    hasEmbeddedRasters: false,
    totalEmbeddedBytes: 0,
    largestRasterBytes: 0,
    embeddedCount: 0,
    rasterItems: [],
    exceedsThreshold: false,
    inspectionMethod: "ghostscript_pdfinfo",
  };

  // Quick check: if file is very small, skip (< 100KB unlikely to have large rasters)
  try {
    const st = await stat(filePath);
    if (st.size < 100_000) return empty;
  } catch (e) {
    return { ...empty, error: `stat failed: ${(e as Error).message}` };
  }

  // Method 1: Parse the PDF stream directly for image XObjects
  // This is faster and doesn't need GS, but less reliable for complex AI files
  try {
    const result = await parseEmbeddedImages(filePath);
    if (result) return result;
  } catch (e) {
    logger.debug("Direct PDF parse failed, trying Ghostscript", {
      filePath,
      error: (e as Error).message,
    });
  }

  // Method 2: Use Ghostscript to extract image info
  try {
    return await inspectWithGhostscript(filePath);
  } catch (e) {
    logger.warn("Ghostscript inspection failed", {
      filePath,
      error: (e as Error).message,
    });
    return { ...empty, error: (e as Error).message, inspectionMethod: "failed" };
  }
}

/**
 * Simple PDF stream parser: look for image XObjects and estimate sizes.
 * Reads first 50MB of file to find /Subtype /Image entries.
 */
async function parseEmbeddedImages(filePath: string): Promise<InspectionResult | null> {
  const MAX_READ = 50 * 1024 * 1024;
  const st = await stat(filePath);
  const readSize = Math.min(st.size, MAX_READ);

  // Read file as buffer
  const fd = await import("node:fs").then(fs =>
    new Promise<number>((resolve, reject) =>
      fs.open(filePath, "r", (err, fd) => err ? reject(err) : resolve(fd))
    )
  );

  const buf = Buffer.alloc(readSize);
  await new Promise<void>((resolve, reject) => {
    import("node:fs").then(fs => {
      fs.read(fd, buf, 0, readSize, 0, (err) => {
        fs.close(fd, () => {});
        if (err) reject(err);
        else resolve();
      });
    });
  });

  const content = buf.toString("latin1");

  // Find image XObjects: /Subtype /Image with /Width, /Height, /BitsPerComponent
  const imagePattern = /<<[^>]*\/Subtype\s*\/Image[^>]*>>/g;
  const rasterItems: RasterFinding[] = [];
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = imagePattern.exec(content)) !== null) {
    const block = match[0];

    const widthMatch = block.match(/\/Width\s+(\d+)/);
    const heightMatch = block.match(/\/Height\s+(\d+)/);
    const bpcMatch = block.match(/\/BitsPerComponent\s+(\d+)/);
    const csMatch = block.match(/\/ColorSpace\s*\/(\w+)/);

    if (widthMatch && heightMatch) {
      const width = parseInt(widthMatch[1], 10);
      const height = parseInt(heightMatch[1], 10);
      const bpc = bpcMatch ? parseInt(bpcMatch[1], 10) : 8;
      const colorSpace = csMatch ? csMatch[1] : "DeviceRGB";

      // Estimate uncompressed size
      const components = colorSpace === "DeviceCMYK" ? 4
        : colorSpace === "DeviceGray" ? 1
        : 3; // RGB default
      const estimatedBytes = width * height * components * (bpc / 8);

      rasterItems.push({
        index: index++,
        width,
        height,
        bitsPerComponent: bpc,
        colorSpace,
        estimatedBytes,
      });
    }
  }

  if (rasterItems.length === 0) {
    // Could mean no images, or our parser missed them
    return null; // fall through to GS method
  }

  const totalEmbeddedBytes = rasterItems.reduce((sum, r) => sum + r.estimatedBytes, 0);
  const largestRasterBytes = Math.max(...rasterItems.map(r => r.estimatedBytes));

  return {
    hasEmbeddedRasters: rasterItems.length > 0,
    totalEmbeddedBytes,
    largestRasterBytes,
    embeddedCount: rasterItems.length,
    rasterItems: rasterItems.filter(r => r.estimatedBytes > 100_000), // only report > 100KB
    exceedsThreshold: totalEmbeddedBytes > EMBEDDED_RASTER_THRESHOLD_BYTES,
    inspectionMethod: "pdf_parse",
  };
}

/**
 * Use Ghostscript to get image info from the AI/PDF file.
 */
async function inspectWithGhostscript(filePath: string): Promise<InspectionResult> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "popdam-inspect-"));
  const psScript = path.join(tmpDir, "inspect.ps");

  // PostScript to enumerate images and print their properties
  const ps = `
%!PS
/imagecount 0 def
/totalsize 0 def

% Override the image operators to capture info
/image_orig /image load def
/image {
  dup type /dicttype eq {
    dup /Width get =print ( ) print
    dup /Height get =print ( ) print
    dup /BitsPerComponent known {
      dup /BitsPerComponent get =print
    } {
      (8) print
    } ifelse
    ( ) print
    dup /ColorSpace known {
      dup /ColorSpace get dup type /nametype eq { =print } { pop (RGB) print } ifelse
    } {
      (RGB) print
    } ifelse
    (\\n) print flush
    /imagecount imagecount 1 add def
  } if
  image_orig
} bind def
`;

  try {
    await import("node:fs/promises").then(fs => fs.writeFile(psScript, ps));

    const { stdout } = await execFileAsync(GS_EXE, [
      "-dNOPAUSE", "-dBATCH", "-dSAFER", "-dNODISPLAY",
      "-dFirstPage=1", "-dLastPage=1",
      psScript,
      filePath,
    ], { timeout: 30_000 });

    // Parse output lines: "width height bpc colorspace"
    const rasterItems: RasterFinding[] = [];
    const lines = stdout.split("\n").filter(l => l.trim().match(/^\d+/));

    lines.forEach((line, index) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const width = parseInt(parts[0], 10);
        const height = parseInt(parts[1], 10);
        const bpc = parseInt(parts[2], 10) || 8;
        const colorSpace = parts[3] || "RGB";
        const components = colorSpace.includes("CMYK") ? 4
          : colorSpace.includes("Gray") ? 1 : 3;
        const estimatedBytes = width * height * components * (bpc / 8);

        rasterItems.push({
          index,
          width,
          height,
          bitsPerComponent: bpc,
          colorSpace,
          estimatedBytes,
        });
      }
    });

    const totalEmbeddedBytes = rasterItems.reduce((sum, r) => sum + r.estimatedBytes, 0);
    const largestRasterBytes = rasterItems.length > 0
      ? Math.max(...rasterItems.map(r => r.estimatedBytes))
      : 0;

    return {
      hasEmbeddedRasters: rasterItems.length > 0,
      totalEmbeddedBytes,
      largestRasterBytes,
      embeddedCount: rasterItems.length,
      rasterItems: rasterItems.filter(r => r.estimatedBytes > 100_000),
      exceedsThreshold: totalEmbeddedBytes > EMBEDDED_RASTER_THRESHOLD_BYTES,
      inspectionMethod: "ghostscript",
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
