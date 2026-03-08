/**
 * AI Raster Inspector — detects embedded rasters in .ai files.
 *
 * Inspection chain (most accurate first):
 *   1. Illustrator ExtendScript — opens file in AI, enumerates RasterItem
 *      objects, reports dimensions / embedded size. Most accurate.
 *   2. PDF stream parsing — scans raw PDF bytes for image XObjects.
 *   3. Ghostscript — renders page 1, intercepts image operators.
 *
 * Threshold: only flags files with embedded rasters > 5 MB total.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

const EMBEDDED_RASTER_THRESHOLD_BYTES = 5 * 1024 * 1024; // 5 MB

// ── Illustrator path discovery ──────────────────────────────────

function findIllustrator(): string | null {
  if (process.env.ILLUSTRATOR_PATH) {
    return existsSync(process.env.ILLUSTRATOR_PATH) ? process.env.ILLUSTRATOR_PATH : null;
  }

  const roots = [
    "C:\\Program Files\\Adobe",
    "C:\\Program Files (x86)\\Adobe",
  ];

  for (const root of roots) {
    try {
      const dirs = readdirSync(root)
        .filter((d: string) => /illustrator/i.test(d))
        .sort()
        .reverse();
      for (const d of dirs) {
        // Support path: Adobe Illustrator 2024/Support Files/Contents/Windows/Illustrator.exe
        const candidates = [
          path.join(root, d, "Support Files", "Contents", "Windows", "Illustrator.exe"),
          path.join(root, d, "Illustrator.exe"),
        ];
        for (const c of candidates) {
          if (existsSync(c)) return c;
        }
      }
    } catch { /* not found */ }
  }
  return null;
}

// ── Ghostscript path discovery ──────────────────────────────────

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

const AI_EXE = findIllustrator();
const GS_EXE = findGhostscript();

// ── Types ───────────────────────────────────────────────────────

export interface RasterFinding {
  index: number;
  width: number;
  height: number;
  bitsPerComponent: number;
  colorSpace: string;
  estimatedBytes: number;
  isEmbedded: boolean;
  linkedFilePath?: string;
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

// ── Main entry ──────────────────────────────────────────────────

export async function inspectAiFile(filePath: string): Promise<InspectionResult> {
  const empty: InspectionResult = {
    hasEmbeddedRasters: false,
    totalEmbeddedBytes: 0,
    largestRasterBytes: 0,
    embeddedCount: 0,
    rasterItems: [],
    exceedsThreshold: false,
    inspectionMethod: "none",
  };

  // Quick check: very small files (< 100KB) won't have large rasters
  try {
    const st = await stat(filePath);
    if (st.size < 100_000) return empty;
  } catch (e) {
    return { ...empty, error: `stat failed: ${(e as Error).message}` };
  }

  // Method 1: ExtendScript via Illustrator (most accurate)
  if (AI_EXE) {
    try {
      const result = await inspectWithExtendScript(filePath);
      if (result) return result;
    } catch (e) {
      logger.debug("ExtendScript inspection failed, falling back", {
        filePath,
        error: (e as Error).message,
      });
    }
  }

  // Method 2: Direct PDF stream parsing (fast, no deps)
  try {
    const result = await parseEmbeddedImages(filePath);
    if (result) return result;
  } catch (e) {
    logger.debug("PDF parse failed, trying Ghostscript", {
      filePath,
      error: (e as Error).message,
    });
  }

  // Method 3: Ghostscript
  try {
    return await inspectWithGhostscript(filePath);
  } catch (e) {
    logger.warn("All inspection methods failed", {
      filePath,
      error: (e as Error).message,
    });
    return { ...empty, error: (e as Error).message, inspectionMethod: "failed" };
  }
}

// ── Method 1: Illustrator ExtendScript ──────────────────────────

async function inspectWithExtendScript(filePath: string): Promise<InspectionResult | null> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "popdam-jsx-"));
  const jsxPath = path.join(tmpDir, "inspect-rasters.jsx");
  const outPath = path.join(tmpDir, "result.json");

  // ExtendScript that enumerates raster items and reports sizes.
  // Illustrator's ExtendScript uses ES3 — no let/const, no template literals.
  const jsx = `
// PopDAM Raster Inspector — ExtendScript for Illustrator
#target illustrator

var filePath = "${filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}";
var outPath = "${outPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}";

var result = {
  rasters: [],
  error: null,
  totalEmbedded: 0
};

try {
  var doc = app.open(new File(filePath));

  // Enumerate all RasterItems (these are always embedded bitmaps)
  for (var i = 0; i < doc.rasterItems.length; i++) {
    var ri = doc.rasterItems[i];
    var w = Math.round(ri.width);
    var h = Math.round(ri.height);
    var bpc = 8;
    var cs = "RGB";
    try { cs = ri.imageColorSpace.toString().replace("ImageColorSpace.", ""); } catch(e2) {}
    var comps = (cs === "CMYK") ? 4 : (cs === "Grayscale") ? 1 : 3;
    var estBytes = w * h * comps * (bpc / 8);

    result.rasters.push({
      index: i,
      width: w,
      height: h,
      bitsPerComponent: bpc,
      colorSpace: cs,
      estimatedBytes: estBytes,
      isEmbedded: true,
      linkedFilePath: null
    });
    result.totalEmbedded += estBytes;
  }

  // Also check PlacedItems — these might be embedded or linked
  for (var j = 0; j < doc.placedItems.length; j++) {
    var pi = doc.placedItems[j];
    var pw = Math.round(pi.width);
    var ph = Math.round(pi.height);
    var linked = false;
    var linkPath = null;
    try {
      if (pi.file && pi.file.exists) {
        linked = true;
        linkPath = pi.file.fsName;
      }
    } catch(e3) {
      // file property throws if embedded — that means it IS embedded
    }

    if (!linked) {
      // Embedded placed item — estimate size
      var estBytes2 = pw * ph * 3; // assume RGB 8bpc
      result.rasters.push({
        index: result.rasters.length,
        width: pw,
        height: ph,
        bitsPerComponent: 8,
        colorSpace: "RGB",
        estimatedBytes: estBytes2,
        isEmbedded: true,
        linkedFilePath: null
      });
      result.totalEmbedded += estBytes2;
    }
    // Linked items are fine — skip them
  }

  doc.close(SaveOptions.DONOTSAVECHANGES);
} catch(e) {
  result.error = e.message || String(e);
  try { app.activeDocument.close(SaveOptions.DONOTSAVECHANGES); } catch(e4) {}
}

// Write result JSON
var f = new File(outPath);
f.open("w");
f.encoding = "UTF-8";
f.write(JSON.stringify(result));
f.close();
`;

  try {
    await writeFile(jsxPath, jsx, "utf-8");

    // Run Illustrator with the JSX script (headless-ish via -run)
    await execFileAsync(AI_EXE!, ["-run", jsxPath], {
      timeout: 120_000, // 2 min timeout per file
      windowsHide: true,
    });

    // Read result
    let raw: string;
    try {
      raw = await readFile(outPath, "utf-8");
    } catch {
      logger.debug("ExtendScript produced no output file", { filePath });
      return null;
    }

    const data = JSON.parse(raw) as {
      rasters: Array<{
        index: number;
        width: number;
        height: number;
        bitsPerComponent: number;
        colorSpace: string;
        estimatedBytes: number;
        isEmbedded: boolean;
        linkedFilePath: string | null;
      }>;
      error: string | null;
      totalEmbedded: number;
    };

    if (data.error) {
      logger.debug("ExtendScript reported error", { filePath, error: data.error });
      return null; // fall through to other methods
    }

    const embeddedItems = data.rasters.filter(r => r.isEmbedded);
    const totalEmbeddedBytes = embeddedItems.reduce((s, r) => s + r.estimatedBytes, 0);
    const largestRasterBytes = embeddedItems.length > 0
      ? Math.max(...embeddedItems.map(r => r.estimatedBytes))
      : 0;

    return {
      hasEmbeddedRasters: embeddedItems.length > 0,
      totalEmbeddedBytes,
      largestRasterBytes,
      embeddedCount: embeddedItems.length,
      rasterItems: embeddedItems
        .filter(r => r.estimatedBytes > 100_000) // only report > 100KB
        .map(r => ({
          index: r.index,
          width: r.width,
          height: r.height,
          bitsPerComponent: r.bitsPerComponent,
          colorSpace: r.colorSpace,
          estimatedBytes: r.estimatedBytes,
          isEmbedded: true,
          linkedFilePath: r.linkedFilePath ?? undefined,
        })),
      exceedsThreshold: totalEmbeddedBytes > EMBEDDED_RASTER_THRESHOLD_BYTES,
      inspectionMethod: "extendscript",
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ── Method 2: PDF stream parsing ────────────────────────────────

async function parseEmbeddedImages(filePath: string): Promise<InspectionResult | null> {
  const MAX_READ = 50 * 1024 * 1024;
  const st = await stat(filePath);
  const readSize = Math.min(st.size, MAX_READ);

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
      const components = colorSpace === "DeviceCMYK" ? 4
        : colorSpace === "DeviceGray" ? 1 : 3;
      const estimatedBytes = width * height * components * (bpc / 8);

      rasterItems.push({
        index: index++, width, height, bitsPerComponent: bpc,
        colorSpace, estimatedBytes, isEmbedded: true,
      });
    }
  }

  if (rasterItems.length === 0) return null;

  const totalEmbeddedBytes = rasterItems.reduce((sum, r) => sum + r.estimatedBytes, 0);
  const largestRasterBytes = Math.max(...rasterItems.map(r => r.estimatedBytes));

  return {
    hasEmbeddedRasters: true,
    totalEmbeddedBytes,
    largestRasterBytes,
    embeddedCount: rasterItems.length,
    rasterItems: rasterItems.filter(r => r.estimatedBytes > 100_000),
    exceedsThreshold: totalEmbeddedBytes > EMBEDDED_RASTER_THRESHOLD_BYTES,
    inspectionMethod: "pdf_parse",
  };
}

// ── Method 3: Ghostscript ───────────────────────────────────────

async function inspectWithGhostscript(filePath: string): Promise<InspectionResult> {
  const tmpDir = await mkdtemp(path.join(tmpdir(), "popdam-inspect-"));
  const psScript = path.join(tmpDir, "inspect.ps");

  const ps = `
%!PS
/imagecount 0 def
/totalsize 0 def
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
    await writeFile(psScript, ps);

    const { stdout } = await execFileAsync(GS_EXE, [
      "-dNOPAUSE", "-dBATCH", "-dSAFER", "-dNODISPLAY",
      "-dFirstPage=1", "-dLastPage=1",
      psScript, filePath,
    ], { timeout: 30_000 });

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
          index, width, height, bitsPerComponent: bpc,
          colorSpace, estimatedBytes, isEmbedded: true,
        });
      }
    });

    const totalEmbeddedBytes = rasterItems.reduce((sum, r) => sum + r.estimatedBytes, 0);
    const largestRasterBytes = rasterItems.length > 0
      ? Math.max(...rasterItems.map(r => r.estimatedBytes)) : 0;

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
