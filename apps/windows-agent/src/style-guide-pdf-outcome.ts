export interface PdfExtractionLike {
  extraction_method: string;
  extracted_text: string | null;
  page_count: number | null;
  extraction_error: string | null;
}

export interface StyleGuidePdfOutcome {
  status: "extracted" | "failed" | "skipped";
  extraction_method: string | null;
  extracted_text: string | null;
  page_count: number | null;
  terminal_reason: string | null;
}

export function toStyleGuidePdfOutcome(result: PdfExtractionLike): StyleGuidePdfOutcome {
  if (result.extraction_method === "skipped") {
    return {
      status: "skipped",
      extraction_method: "skipped",
      extracted_text: null,
      page_count: result.page_count,
      terminal_reason: result.extraction_error || "File exceeds the bounded extraction size limit",
    };
  }
  if (result.extracted_text?.trim()) {
    return {
      status: "extracted",
      extraction_method: result.extraction_method,
      extracted_text: result.extracted_text,
      page_count: result.page_count,
      terminal_reason: null,
    };
  }
  return {
    status: "failed",
    extraction_method: result.extraction_method === "failed" ? null : result.extraction_method,
    extracted_text: null,
    page_count: result.page_count,
    terminal_reason: result.extraction_error || "No searchable text could be extracted",
  };
}
