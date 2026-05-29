import { join } from "path";
import { readFile, open } from "node:fs/promises";
import * as mupdf from "mupdf";
import * as api from "./api-client.js";
import { logger } from "./logger.js";

interface SentinelAsset {
  id: string;
  filename: string;
  relative_path: string;
}

/**
 * Detect whether an .ai file is a sentinel (saved without PDF compatibility).
 *
 * Uses mupdf text extraction on page 0 — the only reliable method.
 * Checking for "/CompatibilityAlert" in raw bytes is NOT reliable: the procedure
 * is defined in the resource dictionary of ALL modern .ai PDFs, so a byte-search
 * matches every .ai file regardless of whether it has real artwork.
 *
 * Sentinel files render a single page whose extracted text contains the canonical
 * Adobe warning phrase. Real files have actual artwork and no such text on page 0.
 */
async function detectSentinel(filePath: string): Promise<boolean> {
  const buf = Buffer.alloc(512);
  let headStr: string;
  const fh = await open(filePath, "r");
  try {
    const { bytesRead } = await fh.read(buf, 0, 512, 0);
    headStr = buf.slice(0, bytesRead).toString("latin1");
  } finally {
    await fh.close();
  }

  // Old format: pure PostScript, no PDF layer.
  if (headStr.startsWith("%!PS-Adobe-") && !headStr.includes("%PDF-")) {
    return true;
  }

  // Modern format: open with mupdf and extract page-0 text.
  const fileBuffer = await readFile(filePath);
  const doc = mupdf.Document.openDocument(fileBuffer, "application/pdf");
  if (doc.countPages() === 0) return false;
  const text = doc.loadPage(0).toStructuredText("preserve-whitespace").asText();
  return text.includes("saved without PDF Content");
}

export async function runAiSentinelScan(
  assets: SentinelAsset[],
  nasContainerMountRoot: string,
): Promise<void> {
  logger.info("AI sentinel scan batch starting", { count: assets.length });

  const results: api.AiSentinelScanResult[] = [];
  let sentinelCount = 0;

  for (const asset of assets) {
    const absolutePath = join(nasContainerMountRoot, asset.relative_path);
    try {
      const isSentinel = await detectSentinel(absolutePath);
      results.push({ asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path, is_sentinel: isSentinel });
      if (isSentinel) {
        sentinelCount++;
        logger.debug("Sentinel .ai detected", { path: asset.relative_path });
      }
    } catch (e) {
      logger.warn("AI sentinel check failed", { path: asset.relative_path, error: (e as Error).message });
      results.push({ asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path, is_sentinel: false });
    }
  }

  logger.info("AI sentinel scan batch done", { checked: results.length, sentinel: sentinelCount });
  await api.completeAiSentinelScan(results);
}
