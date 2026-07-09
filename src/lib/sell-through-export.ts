export const VENDOR_STOCK_NUMBER_HEADER = "Vendor Stock Number";

export interface ParsedSellThroughCsv {
  headers: string[];
  rows: string[][];
  vendorStockNumberIndex: number;
}

export interface StyleGroupImageMatch {
  sku: string;
  thumbnailUrl: string | null;
}

export interface SellThroughRowPreview {
  originalRow: string[];
  stockNumber: string;
  match: StyleGroupImageMatch | null;
}

export interface SellThroughSummary {
  totalDataRows: number;
  uniqueStockNumbers: number;
  matchedSkus: number;
  unmatchedSkus: number;
  rowsMissingThumbnail: number;
}

export interface ThumbnailFetchFailure {
  sku: string;
  url: string;
  reason: string;
}

export interface GeneratedSellThroughWorkbook {
  blob: Blob;
  thumbnailFailures: ThumbnailFetchFailure[];
}

export function normalizeStockNumber(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase();
}

function isEmptyRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === "");
}

export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char === "\r") {
      if (next === "\n") continue;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);

  return rows.filter((parsedRow, index) => index === 0 || !isEmptyRow(parsedRow));
}

export function parseSellThroughCsv(text: string): ParsedSellThroughCsv {
  const parsedRows = parseCsvText(text.replace(/^\uFEFF/, ""));
  const headers = parsedRows[0]?.map((header) => header.trim()) ?? [];

  if (headers.length === 0 || isEmptyRow(headers)) {
    throw new Error("The CSV has no header row.");
  }

  const vendorStockNumberIndex = headers.findIndex(
    (header) => normalizeHeader(header) === normalizeHeader(VENDOR_STOCK_NUMBER_HEADER),
  );

  if (vendorStockNumberIndex < 0) {
    throw new Error(`Missing required column: ${VENDOR_STOCK_NUMBER_HEADER}`);
  }

  return {
    headers,
    rows: parsedRows.slice(1).filter((row) => !isEmptyRow(row)),
    vendorStockNumberIndex,
  };
}

export function createSellThroughPreviewRows(
  parsed: ParsedSellThroughCsv,
  matchesBySku: Map<string, StyleGroupImageMatch>,
): SellThroughRowPreview[] {
  return parsed.rows.map((row) => {
    const stockNumber = normalizeStockNumber(row[parsed.vendorStockNumberIndex]);
    return {
      originalRow: row,
      stockNumber,
      match: stockNumber ? matchesBySku.get(stockNumber) ?? null : null,
    };
  });
}

export function summarizeSellThroughRows(rows: SellThroughRowPreview[]): SellThroughSummary {
  const uniqueStockNumbers = new Set(rows.map((row) => row.stockNumber).filter(Boolean));
  const matchedSkus = new Set(rows.filter((row) => row.match).map((row) => row.stockNumber));

  return {
    totalDataRows: rows.length,
    uniqueStockNumbers: uniqueStockNumbers.size,
    matchedSkus: matchedSkus.size,
    unmatchedSkus: uniqueStockNumbers.size - matchedSkus.size,
    rowsMissingThumbnail: rows.filter((row) => row.match && !row.match.thumbnailUrl).length,
  };
}

function rowValue(row: string[], index: number): string {
  return row[index] ?? "";
}

function imageExtension(contentType: string, url: string): "jpeg" | "png" | "gif" {
  if (contentType.includes("png") || /\.png(?:$|\?)/i.test(url)) return "png";
  if (contentType.includes("gif") || /\.gif(?:$|\?)/i.test(url)) return "gif";
  return "jpeg";
}

async function fetchThumbnail(url: string): Promise<{ buffer: ArrayBuffer; extension: "jpeg" | "png" | "gif" }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();
  return {
    buffer: await blob.arrayBuffer(),
    extension: imageExtension(blob.type, url),
  };
}

export async function generateSellThroughWorkbook(
  headers: string[],
  rows: SellThroughRowPreview[],
): Promise<GeneratedSellThroughWorkbook> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  workbook.creator = "PopDAM";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Sell-through Images", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const outputHeaders = ["Image", "PopDAM Match", ...headers];
  sheet.addRow(outputHeaders);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle" };

  sheet.columns = outputHeaders.map((header, index) => ({
    key: `col_${index}`,
    width: index === 0 ? 16 : index === 1 ? 18 : Math.min(Math.max(header.length + 4, 12), 34),
  }));

  rows.forEach((previewRow) => {
    const matchLabel = previewRow.match
      ? previewRow.match.thumbnailUrl
        ? `Matched: ${previewRow.match.sku}`
        : `Matched, no thumbnail: ${previewRow.match.sku}`
      : previewRow.stockNumber
        ? "Unmatched"
        : "Blank stock number";

    const outputRow = sheet.addRow([
      "",
      matchLabel,
      ...headers.map((_, index) => rowValue(previewRow.originalRow, index)),
    ]);
    outputRow.height = previewRow.match?.thumbnailUrl ? 64 : 22;
    outputRow.alignment = { vertical: "middle", wrapText: true };
  });

  const thumbnailFailures: ThumbnailFetchFailure[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const previewRow = rows[i];
    if (!previewRow.match?.thumbnailUrl) continue;

    try {
      const thumbnail = await fetchThumbnail(previewRow.match.thumbnailUrl);
      const imageId = workbook.addImage({
        buffer: thumbnail.buffer,
        extension: thumbnail.extension,
      });

      sheet.addImage(imageId, {
        tl: { col: 0.15, row: i + 1.15 },
        ext: { width: 72, height: 72 },
      });
    } catch (error) {
      thumbnailFailures.push({
        sku: previewRow.match.sku,
        url: previewRow.match.thumbnailUrl,
        reason: error instanceof Error ? error.message : "Unknown fetch error",
      });
      sheet.getCell(i + 2, 1).value = "Image fetch failed";
    }
  }

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: outputHeaders.length },
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    thumbnailFailures,
  };
}
