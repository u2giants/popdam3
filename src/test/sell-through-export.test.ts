import { describe, expect, it } from "vitest";
import {
  createSellThroughPreviewRows,
  generateSellThroughWorkbook,
  normalizeStockNumber,
  parseSellThroughCsv,
  summarizeSellThroughRows,
} from "@/lib/sell-through-export";

describe("sell-through CSV export helpers", () => {
  it("parses quoted CSV cells and finds Vendor Stock Number case-insensitively", () => {
    const parsed = parseSellThroughCsv(
      'Retailer, vendor stock number ,Notes\r\nTarget, abc123 ,"Includes, comma"\r\nWalmart,def456,"Said ""yes"""',
    );

    expect(parsed.headers).toEqual(["Retailer", "vendor stock number", "Notes"]);
    expect(parsed.vendorStockNumberIndex).toBe(1);
    expect(parsed.rows).toEqual([
      ["Target", " abc123 ", "Includes, comma"],
      ["Walmart", "def456", 'Said "yes"'],
    ]);
  });

  it("normalizes stock numbers with trim and uppercase", () => {
    expect(normalizeStockNumber("  mqk8asesc01 ")).toBe("MQK8ASESC01");
    expect(normalizeStockNumber(null)).toBe("");
  });

  it("throws a useful error when the required column is missing", () => {
    expect(() => parseSellThroughCsv("SKU,Qty\nABC,2")).toThrow("Missing required column: Vendor Stock Number");
  });

  it("summarizes unique matches, unmatched values, and rows missing thumbnails", () => {
    const parsed = parseSellThroughCsv(
      "Vendor Stock Number,Qty\nabc123,1\nABC123,2\nmissing,3\nnoimage,4\n,5",
    );
    const previewRows = createSellThroughPreviewRows(
      parsed,
      new Map([
        ["ABC123", { sku: "ABC123", thumbnailUrl: "https://cdn.example.com/a.jpg" }],
        ["NOIMAGE", { sku: "NOIMAGE", thumbnailUrl: null }],
      ]),
    );

    expect(summarizeSellThroughRows(previewRows)).toEqual({
      totalDataRows: 5,
      uniqueStockNumbers: 3,
      matchedSkus: 2,
      unmatchedSkus: 1,
      rowsMissingThumbnail: 1,
    });
  });

  it("exports quantities as numbers, prices as currency, percentages as percentages, and dates as dates", async () => {
    const parsed = parseSellThroughCsv(
      "Vendor Stock Number,Units Sold,Net Sales,Unit Price,Sell Through %,Week Ending,Notes\n00123,1,1234.5,$12.50,25%,07/31/2026,Keep as text",
    );
    const previewRows = createSellThroughPreviewRows(parsed, new Map());
    const generated = await generateSellThroughWorkbook(parsed.headers, previewRows);

    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.default.Workbook();
    const workbookBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(generated.blob);
    });
    await workbook.xlsx.load(workbookBuffer);
    const sheet = workbook.getWorksheet("Sell-through Images");

    expect(sheet).toBeDefined();
    expect(sheet!.getCell(2, 3).value).toBe("00123");
    expect(sheet!.getCell(2, 4).value).toBe(1);
    expect(sheet!.getCell(2, 5).value).toBe(1234.5);
    expect(sheet!.getCell(2, 5).numFmt).toContain("$");
    expect(sheet!.getCell(2, 6).value).toBe(12.5);
    expect(sheet!.getCell(2, 6).numFmt).toContain("$");
    expect(sheet!.getCell(2, 7).value).toBe(0.25);
    expect(sheet!.getCell(2, 7).numFmt).toBe("0.0%");
    expect(sheet!.getCell(2, 8).value).toBeInstanceOf(Date);
    expect(sheet!.getCell(2, 8).numFmt).toBe("mm/dd/yyyy");
    expect(sheet!.getCell(2, 9).value).toBe("Keep as text");
  });
});
