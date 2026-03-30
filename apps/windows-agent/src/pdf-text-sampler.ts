import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "./logger";
import * as api from "./api-client";

// pdf-parse and mupdf are only available after a full installer run, not OTA dist updates.
// Load them lazily inside the function so a missing module never crashes startup.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<any>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tryRequire(mod: string): any | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(mod);
  } catch {
    return null;
  }
}

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

      let rawText: string;
      let numPages: number;

      try {
        const pdfParse = tryRequire("pdf-parse") as ((buf: Buffer) => Promise<{ text: string; numpages: number }>) | null;
        if (!pdfParse) throw new Error("pdf-parse not installed");
        const parsed = await Promise.race([
          pdfParse(buffer),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("pdf-parse timed out after 30s")), 30_000)
          ),
        ]);
        rawText = parsed.text || "";
        numPages = parsed.numpages;
      } catch (primaryErr) {
        logger.warn("PDF text sample: pdf-parse failed, trying mupdf fallback", {
          filename: asset.filename,
          error: (primaryErr as Error).message,
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mupdf: any = await dynamicImport("mupdf").catch(() => null);
        if (!mupdf) throw new Error("mupdf not installed");
        const doc = mupdf.Document.openDocument(buffer, "application/pdf");
        numPages = doc.countPages();
        const parts: string[] = [];
        for (let p = 0; p < numPages; p++) {
          parts.push(doc.loadPage(p).toStructuredText("preserve-whitespace").asText());
        }
        rawText = parts.join("\n");
      }

      const text = rawText.trim();
      const charCount = text.length;
      const method: PdfTextSampleResult["extraction_method"] =
        charCount >= 100 ? "pdf_text" : charCount > 0 ? "likely_scanned" : "failed";

      result = {
        asset_id: asset.id,
        filename: asset.filename,
        relative_path: asset.relative_path,
        extraction_method: method,
        extracted_text: charCount > 0 ? text : null,
        page_count: numPages || null,
        char_count: charCount,
        extraction_error: null,
      };

      logger.info("PDF text sample: extracted", {
        filename: asset.filename,
        method,
        chars: charCount,
        pages: numPages,
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
