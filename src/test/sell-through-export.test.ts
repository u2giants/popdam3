import { describe, expect, it } from "vitest";
import {
  createSellThroughPreviewRows,
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
});
