import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "./logger";
import * as api from "./api-client";

// pdf-parse, mupdf, tesseract.js, and @anthropic-ai/sdk are only available after
// a full installer run, not OTA dist updates. Load them lazily inside the function
// so a missing module never crashes startup.
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
  extraction_method: "pdf_text" | "likely_scanned" | "failed" | "ocr_text" | "ai_vision";
  extracted_text: string | null;
  page_count: number | null;
  char_count: number;
  extraction_error: string | null;
}

export async function runPdfTextSample(
  assets: PdfSampleAsset[],
  mountRoot: string,
  anthropicApiKey?: string,
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

      let rawText = "";
      let numPages: number | null = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let mupdfRef: any = null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let mupdfDoc: any = null;

      // ── Step 1: pdf-parse (primary text extraction) ──────────────────
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
        logger.warn("PDF text sample: pdf-parse failed, trying mupdf text extraction", {
          filename: asset.filename,
          error: (primaryErr as Error).message,
        });

        // ── Step 2: mupdf text extraction (fallback) ──────────────────
        try {
          mupdfRef = await dynamicImport("mupdf").catch(() => null);
          if (!mupdfRef) throw new Error("mupdf not installed");
          mupdfDoc = mupdfRef.Document.openDocument(buffer, "application/pdf");
          numPages = mupdfDoc.countPages();
          const parts: string[] = [];
          for (let p = 0; p < numPages; p++) {
            parts.push(mupdfDoc.loadPage(p).toStructuredText("preserve-whitespace").asText());
          }
          rawText = parts.join("\n");
        } catch (mupdfErr) {
          logger.warn("PDF text sample: mupdf text extraction also failed", {
            filename: asset.filename,
            error: (mupdfErr as Error).message,
          });
        }
      }

      const text = rawText.trim();
      const charCount = text.length;

      if (charCount >= 100) {
        // Sufficient native text — done
        result = {
          asset_id: asset.id,
          filename: asset.filename,
          relative_path: asset.relative_path,
          extraction_method: "pdf_text",
          extracted_text: text,
          page_count: numPages,
          char_count: charCount,
          extraction_error: null,
        };
        logger.info("PDF text sample: extracted via text", {
          filename: asset.filename,
          chars: charCount,
          pages: numPages,
        });
      } else {
        // Sparse or no text — try OCR then AI vision

        // ── Step 3: render page 0 to PNG via mupdf (used by OCR + AI) ──
        let pngBuffer: Buffer | null = null;
        try {
          if (!mupdfRef) mupdfRef = await dynamicImport("mupdf").catch(() => null);
          if (mupdfRef) {
            if (!mupdfDoc) {
              mupdfDoc = mupdfRef.Document.openDocument(buffer, "application/pdf");
              numPages = mupdfDoc.countPages();
            }
            const page = mupdfDoc.loadPage(0);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pixmap = page.toPixmap([2, 0, 0, 2, 0, 0] as any, mupdfRef.ColorSpace.DeviceRGB, false);
            pngBuffer = Buffer.from(pixmap.asPNG() as Uint8Array);
          }
        } catch (renderErr) {
          logger.warn("PDF text sample: mupdf page render failed", {
            filename: asset.filename,
            error: (renderErr as Error).message,
          });
        }

        // ── Step 4: OCR via tesseract.js ──────────────────────────────
        let ocrText = "";
        if (pngBuffer) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tesseractLib: any = await dynamicImport("tesseract.js").catch(() => null);
            if (!tesseractLib) throw new Error("tesseract.js not installed");
            const worker = await tesseractLib.createWorker("eng");
            const ocrResult = await worker.recognize(pngBuffer);
            await worker.terminate();
            ocrText = (ocrResult.data.text as string).trim();
          } catch (ocrErr) {
            logger.warn("PDF text sample: OCR failed", {
              filename: asset.filename,
              error: (ocrErr as Error).message,
            });
          }
        }

        if (ocrText.length >= 100) {
          result = {
            asset_id: asset.id,
            filename: asset.filename,
            relative_path: asset.relative_path,
            extraction_method: "ocr_text",
            extracted_text: ocrText,
            page_count: numPages,
            char_count: ocrText.length,
            extraction_error: null,
          };
          logger.info("PDF text sample: extracted via OCR", {
            filename: asset.filename,
            chars: ocrText.length,
          });
        } else {
          // ── Step 5: AI vision via Claude ──────────────────────────────
          let aiText = "";
          let aiErrMsg = "";
          if (pngBuffer && anthropicApiKey) {
            try {
              const AnthropicLib = tryRequire("@anthropic-ai/sdk");
              if (!AnthropicLib) throw new Error("@anthropic-ai/sdk not installed");
              const Anthropic = AnthropicLib.default ?? AnthropicLib;
              const anthropic = new Anthropic({ apiKey: anthropicApiKey });
              const aiResponse = await anthropic.messages.create({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 2048,
                messages: [{
                  role: "user",
                  content: [
                    {
                      type: "image",
                      source: {
                        type: "base64",
                        media_type: "image/png",
                        data: pngBuffer.toString("base64"),
                      },
                    },
                    {
                      type: "text",
                      text: "Extract all text from this document page. Return only the raw extracted text with no commentary.",
                    },
                  ],
                }],
              });
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const first = aiResponse.content[0] as any;
              if (first && first.type === "text") {
                aiText = (first.text as string).trim();
              }
            } catch (aiErr) {
              aiErrMsg = (aiErr as Error).message;
              logger.warn("PDF text sample: AI vision failed", {
                filename: asset.filename,
                error: aiErrMsg,
              });
            }
          }

          if (aiText.length > 0) {
            result = {
              asset_id: asset.id,
              filename: asset.filename,
              relative_path: asset.relative_path,
              extraction_method: "ai_vision",
              extracted_text: aiText,
              page_count: numPages,
              char_count: aiText.length,
              extraction_error: null,
            };
            logger.info("PDF text sample: extracted via AI vision", {
              filename: asset.filename,
              chars: aiText.length,
            });
          } else {
            // All methods exhausted — use best available text
            const finalText = ocrText.length > 0 ? ocrText : text;
            const finalCount = finalText.length;
            const method: "pdf_text" | "likely_scanned" | "failed" =
              finalCount >= 100 ? "pdf_text" : finalCount > 0 ? "likely_scanned" : "failed";
            result = {
              asset_id: asset.id,
              filename: asset.filename,
              relative_path: asset.relative_path,
              extraction_method: method,
              extracted_text: finalCount > 0 ? finalText : null,
              page_count: numPages,
              char_count: finalCount,
              extraction_error: aiErrMsg ? aiErrMsg.slice(0, 500) : null,
            };
            logger.info("PDF text sample: minimal/no text after all methods", {
              filename: asset.filename,
              method,
              chars: finalCount,
            });
          }
        }
      }
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
