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

export interface ThumbnailBytes {
  buffer: ArrayBuffer;
  contentType: string;
}

export type ThumbnailFetcher = (url: string) => Promise<ThumbnailBytes>;

type SellThroughColumnType = "text" | "number" | "currency" | "percent" | "date";

interface SellThroughColumnFormat {
  type: SellThroughColumnType;
  numFmt?: string;
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

const IDENTIFIER_HEADER_PATTERN = /(?:^|\b)(?:id|sku|upc|ean|barcode|stock(?:\s+number)?|item(?:\s+number)?|style(?:\s+number)?|model(?:\s+number)?|zip|postal)(?:\b|$)/i;
const CURRENCY_HEADER_PATTERN = /(?:\$|\b(?:price|cost|amount|revenue|dollars?|currency|retail|wholesale|msrp|aurr?|sales\s+value|net\s+sales|gross\s+sales)\b)/i;
const PERCENT_HEADER_PATTERN = /(?:%|\b(?:percent(?:age)?|sell[ -]?thru|sell[ -]?through|margin|rate)\b)/i;
const DATE_HEADER_PATTERN = /\b(?:date|week\s+ending|month\s+ending|period\s+ending)\b/i;

function parseNumericCell(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const negative = /^\(.*\)$/.test(trimmed);
  const normalized = trimmed.replace(/^\(|\)$/g, "").replace(/[$,\s]/g, "");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) return null;

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? (negative ? -Math.abs(parsed) : parsed) : null;
}

function parseDateCell(value: string): Date | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,4})[/-](\d{1,2})[/-](\d{1,4})$/);
  if (!match) return null;

  const [, first, second, third] = match;
  const year = first.length === 4 ? Number(first) : Number(third.length === 2 ? `20${third}` : third);
  const month = Number(first.length === 4 ? second : first);
  const day = Number(first.length === 4 ? third : second);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function inferColumnFormat(header: string, values: string[]): SellThroughColumnFormat {
  if (IDENTIFIER_HEADER_PATTERN.test(header)) return { type: "text" };

  const nonEmptyValues = values.filter((value) => value.trim() !== "");
  if (nonEmptyValues.length === 0) return { type: "text" };

  if (DATE_HEADER_PATTERN.test(header) && nonEmptyValues.every((value) => parseDateCell(value))) {
    return { type: "date", numFmt: "mm/dd/yyyy" };
  }

  if (PERCENT_HEADER_PATTERN.test(header)) {
    const allPercentValues = nonEmptyValues.every((value) => parseNumericCell(value.replace(/%$/, "")) !== null);
    if (allPercentValues) return { type: "percent", numFmt: "0.0%" };
  }

  const allNumeric = nonEmptyValues.every((value) => parseNumericCell(value) !== null);
  if (!allNumeric) return { type: "text" };

  if (CURRENCY_HEADER_PATTERN.test(header)) return { type: "currency", numFmt: "$#,##0.00;[Red]-$#,##0.00" };

  const hasLeadingZero = nonEmptyValues.some((value) => /^[-+]?0\d+/.test(value.trim()));
  if (hasLeadingZero) return { type: "text" };

  const hasDecimal = nonEmptyValues.some((value) => {
    const parsed = parseNumericCell(value);
    return parsed !== null && !Number.isInteger(parsed);
  });
  return { type: "number", numFmt: hasDecimal ? "#,##0.00" : "#,##0" };
}

function formattedCellValue(value: string, format: SellThroughColumnFormat): string | number | Date {
  if (value.trim() === "") return "";
  if (format.type === "text") return value;
  if (format.type === "date") return parseDateCell(value) ?? value;

  if (format.type === "percent") {
    const hasPercentSign = /%\s*$/.test(value);
    const parsed = parseNumericCell(value.replace(/%\s*$/, ""));
    if (parsed === null) return value;
    return hasPercentSign || Math.abs(parsed) > 1 ? parsed / 100 : parsed;
  }

  return parseNumericCell(value) ?? value;
}

function imageExtension(contentType: string, url: string): "jpeg" | "png" | "gif" {
  if (contentType.includes("png") || /\.png(?:$|\?)/i.test(url)) return "png";
  if (contentType.includes("gif") || /\.gif(?:$|\?)/i.test(url)) return "gif";
  return "jpeg";
}

async function defaultThumbnailFetcher(url: string): Promise<ThumbnailBytes> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();
  return {
    buffer: await blob.arrayBuffer(),
    contentType: blob.type,
  };
}

export async function generateSellThroughWorkbook(
  headers: string[],
  rows: SellThroughRowPreview[],
  fetchThumbnail: ThumbnailFetcher = defaultThumbnailFetcher,
): Promise<GeneratedSellThroughWorkbook> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.default.Workbook();
  workbook.creator = "PopDAM";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Sell-through Images", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const outputHeaders = ["Image", "PopDAM Match", ...headers];
  const columnFormats = headers.map((header, index) =>
    inferColumnFormat(
      header,
      rows.map((row) => rowValue(row.originalRow, index)),
    ),
  );
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
      ...headers.map((_, index) => formattedCellValue(rowValue(previewRow.originalRow, index), columnFormats[index])),
    ]);
    outputRow.height = previewRow.match?.thumbnailUrl ? 64 : 22;
    outputRow.alignment = { vertical: "middle", wrapText: true };
  });

  columnFormats.forEach((format, index) => {
    if (format.numFmt) sheet.getColumn(index + 3).numFmt = format.numFmt;
  });

  const thumbnailFailures: ThumbnailFetchFailure[] = [];

  for (let i = 0; i < rows.length; i += 1) {
    const previewRow = rows[i];
    if (!previewRow.match?.thumbnailUrl) continue;

    try {
      const thumbnail = await fetchThumbnail(previewRow.match.thumbnailUrl);
      const imageId = workbook.addImage({
        buffer: thumbnail.buffer,
        extension: imageExtension(thumbnail.contentType, previewRow.match.thumbnailUrl),
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
