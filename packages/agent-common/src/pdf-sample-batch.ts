import { logger } from "./logger.js";

export interface PdfSampleAsset {
  id: string;
  relative_path: string;
  filename: string;
}

export interface PdfTextSampleResult {
  asset_id: string;
  filename: string;
  relative_path: string;
  extraction_method: "pdf_text" | "likely_scanned" | "failed" | "ocr_text" | "ai_vision" | "skipped";
  extracted_text: string | null;
  ocr_engine?: string | null;
  page_count: number | null;
  char_count: number;
  extraction_error: string | null;
  thumbnail_url?: string;
  /** Set when a file was intentionally skipped rather than failing */
  skip_reason?: string;
}

export interface FileProgressEntry {
  filename: string;
  status: "success" | "failed";
  method: string;
  chars: number;
  error?: string;
}

interface PdfSampleBatchOptions {
  resolvePath: (relativePath: string) => string;
  process: (asset: PdfSampleAsset, path: string, index: number, prior: FileProgressEntry[]) => Promise<PdfTextSampleResult>;
  describeResult: (asset: PdfSampleAsset, result: PdfTextSampleResult) => FileProgressEntry;
  progress: (processed: number, total: number, currentFile: string | null, step: string, entries: FileProgressEntry[], error?: string) => Promise<void>;
  complete: (results: PdfTextSampleResult[]) => Promise<void>;
}

export async function runPdfSampleBatch(
  assets: PdfSampleAsset[],
  { resolvePath, process, describeResult, progress, complete }: PdfSampleBatchOptions,
): Promise<void> {
  const results: PdfTextSampleResult[] = [];
  const fileResults: FileProgressEntry[] = [];

  // Report initial pickup
  await progress(0, assets.length, null, "starting", []);

  for (let i = 0; i < assets.length; i++) {
    const asset = assets[i];
    let fullPath = asset.relative_path;

    try {
      fullPath = resolvePath(asset.relative_path);
      const result = await process(asset, fullPath, i, fileResults);
      results.push(result);
      fileResults.push(describeResult(asset, result));
    } catch (e) {
      const errMsg = (e as Error).message;
      logger.warn("PDF text sample: extraction failed", {
        filename: asset.filename, path: fullPath, error: errMsg,
      });
      results.push({
        asset_id: asset.id, filename: asset.filename, relative_path: asset.relative_path,
        extraction_method: "failed", extracted_text: null,
        page_count: null, char_count: 0, extraction_error: errMsg.slice(0, 500),
      });
      fileResults.push({
        filename: asset.filename, status: "failed", method: "failed", chars: 0, error: errMsg.slice(0, 200),
      });
    }

    // Report progress after each file
    await progress(i + 1, assets.length, null, "done", fileResults);
  }

  try {
    await complete(results);
    logger.info("PDF text sample: completed", { total: results.length });
  } catch (e) {
    logger.error("PDF text sample: failed to submit results", { error: (e as Error).message });
    await progress(results.length, assets.length, null, "done", fileResults, (e as Error).message);
  }
}
