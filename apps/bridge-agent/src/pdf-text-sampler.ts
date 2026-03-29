/**
 * PDF Text Sampler
 *
 * Takes a list of PDF assets (passed from admin-api via heartbeat config),
 * reads each from the NAS filesystem, attempts text extraction via pdf-parse,
 * and classifies the result:
 *   'pdf_text'       — ≥100 chars extracted (native text PDF)
 *   'likely_scanned' — >0 but <100 chars (probably a scanned image PDF)
 *   'failed'         — 0 chars or threw an error
 *
 * Results are POSTed to agent-api complete-pdf-text-sample.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "./logger.js";
import { config } from "./config.js";
import * as api from "./api-client.js";

// pdf-parse is a CJS module; use createRequire for ESM compatibility
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string; numpages: number }>;

export interface PdfSampleAsset {
  id: string;
  relative_path: string;
  filename: string;
}

export interface PdfTextSampleResult {
  asset_id: string;
  filename: string;
  relative_path: string;
  extraction_method: "pdf_text" | "likely_scanned" | "failed";
  extracted_text: string | null;
  page_count: number | null;
  char_count: number;
  extraction_error: string | null;
}

export async function runPdfTextSample(
  assets: PdfSampleAsset[],
  mountRoot: string,
): Promise<void> {
  if (assets.length === 0) {
    logger.info("PDF text sample: no assets to process");
    return;
  }

  logger.info("PDF text sample: starting", { count: assets.length, mountRoot });

  const results: PdfTextSampleResult[] = [];

  for (const asset of assets) {
    const fullPath = join(mountRoot, asset.relative_path);
    let result: PdfTextSampleResult;

    try {
      const buffer = await readFile(fullPath);
      const parsed = await Promise.race([
        pdfParse(buffer),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("pdf-parse timed out after 30s")), 30_000)
        ),
      ]);
      const text = (parsed.text || "").trim();
      const charCount = text.length;
      const method: PdfTextSampleResult["extraction_method"] =
        charCount >= 100 ? "pdf_text" : charCount > 0 ? "likely_scanned" : "failed";

      result = {
        asset_id: asset.id,
        filename: asset.filename,
        relative_path: asset.relative_path,
        extraction_method: method,
        extracted_text: charCount > 0 ? text : null,
        page_count: parsed.numpages || null,
        char_count: charCount,
        extraction_error: null,
      };

      logger.info("PDF text sample: extracted", {
        filename: asset.filename,
        method,
        chars: charCount,
        pages: parsed.numpages,
      });
    } catch (e) {
      const errMsg = (e as Error).message;
      logger.warn("PDF text sample: extraction failed", {
        filename: asset.filename,
        path: fullPath,
        error: errMsg,
      });
      result = {
        asset_id: asset.id,
        filename: asset.filename,
        relative_path: asset.relative_path,
        extraction_method: "failed",
        extracted_text: null,
        page_count: null,
        char_count: 0,
        extraction_error: errMsg.slice(0, 500),
      };
    }

    results.push(result);
  }

  await api.completePdfTextSample(results);
  logger.info("PDF text sample: completed", { total: results.length });
}
