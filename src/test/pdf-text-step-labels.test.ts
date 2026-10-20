import { describe, expect, it } from "vitest";
import { stepLabel } from "@/components/settings/pdf-text-samples/shared";

describe("PDF text sample step labels", () => {
  it("names the OCR step after Indra, the engine the cascade runs first", () => {
    expect(stepLabel("ocr")).toBe("OCR (Indra)");
  });

  it("keeps the other cascade step labels stable", () => {
    expect(stepLabel("mupdf")).toBe("mupdf text extraction");
    expect(stepLabel("rendering")).toBe("Rendering page to PNG");
    expect(stepLabel("ai_vision")).toBe("AI vision");
    expect(stepLabel(null)).toBe("");
  });
});
