import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const privateDir = "C:/repos/shared-db/.private/item-mg-reclassification-20260814";
const rows = JSON.parse(await fs.readFile(path.join(privateDir, "item_description_chunks.json"), "utf8"));
const summary = JSON.parse(await fs.readFile(path.join(privateDir, "item_description_chunks_summary.json"), "utf8"));
const reviewRows = rows.filter(row => row["Extraction Confidence"] !== "High");
const headers = Object.keys(rows[0]);

const workbook = Workbook.create();
const summarySheet = workbook.worksheets.add("Summary");
const reviewSheet = workbook.worksheets.add("Review Needed");
const allSheet = workbook.worksheets.add("All Items");

function writeRows(sheet, data) {
  sheet.getRangeByIndexes(0, 0, data.length + 1, headers.length).values = [
    headers,
    ...data.map(row => headers.map(header => row[header] ?? "")),
  ];
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(5);
  const lastRow = data.length + 1;
  sheet.tables.add(`A1:R${lastRow}`, true, sheet.name === "All Items" ? "AllChunksTable" : "ReviewChunksTable").style = "TableStyleMedium2";
  sheet.getRange("A1:R1").format = { fill: "#17365D", font: { bold: true, color: "#FFFFFF" }, wrapText: true, rowHeight: 34 };
  sheet.getRange("A:A").format.columnWidth = 13;
  sheet.getRange("B:B").format.columnWidth = 17;
  sheet.getRange("C:D").format.columnWidth = 14;
  sheet.getRange("E:E").format.columnWidth = 58;
  sheet.getRange("F:F").format.columnWidth = 34;
  sheet.getRange("G:G").format.columnWidth = 13;
  sheet.getRange("H:I").format.columnWidth = 22;
  sheet.getRange("J:J").format.columnWidth = 48;
  sheet.getRange("K:K").format.columnWidth = 18;
  sheet.getRange("L:L").format.columnWidth = 42;
  sheet.getRange("M:R").format.columnWidth = 10;
}

writeRows(reviewSheet, reviewRows);
writeRows(allSheet, rows);

summarySheet.showGridLines = false;
summarySheet.getRange("A1:F1").merge();
summarySheet.getRange("A1").values = [["Item Description Chunk Review"]];
summarySheet.getRange("A1:F1").format = { fill: "#17365D", font: { bold: true, color: "#FFFFFF", size: 18 }, rowHeight: 30 };
summarySheet.getRange("A3:B11").values = [
  ["Measure", "Count"], ["All item descriptions", summary.rows], ["High confidence", summary.high],
  ["Medium confidence", summary.medium], ["Needs full review", summary.review],
  ["Item type found", summary.item_type_found], ["Size found", summary.size_found],
  ["Licensor found", summary.licensor_found], ["Property found", summary.property_found],
];
summarySheet.getRange("A3:B3").format = { fill: "#4472C4", font: { bold: true, color: "#FFFFFF" } };
summarySheet.getRange("A4:A11").format.font = { bold: true, color: "#17365D" };
summarySheet.getRange("B4:B11").format.numberFormat = "#,##0";
summarySheet.getRange("D3:F3").merge();
summarySheet.getRange("D3").values = [["Review order"]];
summarySheet.getRange("D3:F3").format = { fill: "#4472C4", font: { bold: true, color: "#FFFFFF" } };
summarySheet.getRange("D4:F11").merge();
summarySheet.getRange("D4").values = [[
  "Start on Review Needed. Filter Review Notes to correct missing or uncertain chunks. All Items contains every source row. The five requested chunks are Item Type, Item Size, Licensor, Property and Artwork Description. MG columns are included only as reference. Nothing in the source CSV or database was changed."
]];
summarySheet.getRange("D4:F11").format = { wrapText: true, verticalAlignment: "top", fill: "#EAF2F8" };
summarySheet.getRange("A13:F16").merge();
summarySheet.getRange("A13").values = [[
  "Licensor and property labels use the existing ColdLion code-to-name reference, then retain only the wording actually present in the item description. Example: LILO AND STITCH becomes Stitch when the description contains Stitch but not Lilo."
]];
summarySheet.getRange("A13:F16").format = { wrapText: true, verticalAlignment: "top", fill: "#D9EAD3" };
summarySheet.getRange("A:A").format.columnWidth = 34;
summarySheet.getRange("B:B").format.columnWidth = 16;
summarySheet.getRange("C:C").format.columnWidth = 4;
summarySheet.getRange("D:F").format.columnWidth = 20;

const outputPath = path.join(privateDir, "item_description_chunks_review.xlsx");
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

for (const spec of [
  ["Summary", "A1:F16", "chunks-preview-summary.png"],
  ["Review Needed", "A1:R12", "chunks-preview-review.png"],
  ["All Items", "A1:R12", "chunks-preview-all.png"],
]) {
  const preview = await workbook.render({ sheetName: spec[0], range: spec[1], scale: 1, format: "png" });
  await fs.writeFile(path.join(privateDir, spec[2]), new Uint8Array(await preview.arrayBuffer()));
}

console.log((await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 3000 })).ndjson);
console.log((await workbook.inspect({ kind: "table", sheetId: "All Items", range: "A1:R8", tableMaxRows: 8, tableMaxCols: 18, maxChars: 5000 })).ndjson);
console.log((await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 50 }, maxChars: 2000 })).ndjson);
console.log(outputPath);
