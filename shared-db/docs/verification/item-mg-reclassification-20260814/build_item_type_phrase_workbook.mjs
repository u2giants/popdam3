import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const privateDir = "C:/repos/shared-db/.private/item-mg-reclassification-20260814";
const proposed = JSON.parse(await fs.readFile(path.join(privateDir, "proposed_item_type_phrase_list.json"), "utf8"));
const raw = JSON.parse(await fs.readFile(path.join(privateDir, "raw_item_type_phrase_candidates.json"), "utf8"));
const summary = JSON.parse(await fs.readFile(path.join(privateDir, "proposed_item_type_phrase_summary.json"), "utf8"));

const workbook = Workbook.create();
const summarySheet = workbook.worksheets.add("Summary");
const proposedSheet = workbook.worksheets.add("Proposed Phrase List");
const rawSheet = workbook.worksheets.add("Raw Candidates");

function writeTable(sheet, rows, tableName) {
  const headers = Object.keys(rows[0]);
  sheet.getRangeByIndexes(0, 0, rows.length + 1, headers.length).values = [headers, ...rows.map(row => headers.map(h => row[h] ?? ""))];
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(3);
  const lastCol = String.fromCharCode(64 + headers.length);
  sheet.tables.add(`A1:${lastCol}${rows.length + 1}`, true, tableName).style = "TableStyleMedium2";
  sheet.getRange(`A1:${lastCol}1`).format = { fill: "#17365D", font: { bold: true, color: "#FFFFFF" }, wrapText: true, rowHeight: 34 };
  sheet.getRange("A:A").format.columnWidth = 18;
  sheet.getRange("B:C").format.columnWidth = 34;
  sheet.getRange("D:E").format.columnWidth = 13;
  sheet.getRange("F:F").format.columnWidth = 20;
  sheet.getRange("G:I").format.columnWidth = 16;
  sheet.getRange("J:L").format.columnWidth = 64;
}

writeTable(proposedSheet, proposed, "ProposedPhrasesTable");
writeTable(rawSheet, raw, "RawPhrasesTable");

summarySheet.showGridLines = false;
summarySheet.getRange("A1:F1").merge();
summarySheet.getRange("A1").values = [["Proposed Item-Type Phrase Dictionary"]];
summarySheet.getRange("A1:F1").format = { fill: "#17365D", font: { bold: true, color: "#FFFFFF", size: 18 }, rowHeight: 30 };
summarySheet.getRange("A3:B6").values = [
  ["Measure", "Count"], ["Descriptions examined", summary.descriptions],
  ["Qualified phrase candidates", summary.raw_candidates], ["Proposed review phrases", summary.proposed_phrases],
];
summarySheet.getRange("A3:B3").format = { fill: "#4472C4", font: { bold: true, color: "#FFFFFF" } };
summarySheet.getRange("A4:A6").format.font = { bold: true, color: "#17365D" };
summarySheet.getRange("B4:B6").format.numberFormat = "#,##0";
summarySheet.getRange("D3:F3").merge();
summarySheet.getRange("D3").values = [["How this was built"]];
summarySheet.getRange("D3:F3").format = { fill: "#4472C4", font: { bold: true, color: "#FFFFFF" } };
const methodLines = [
  "Every description was normalized; size and known license wording were removed.",
  "Repeated two-to-seven-word phrases were measured across the full history.",
  "A phrase had to repeatedly point to the same MG01-MG03 family.",
  "Cross-license usage reduces the chance that artwork created the phrase.",
];
for (let i = 0; i < methodLines.length; i++) {
  summarySheet.getRange(`D${4 + i}:F${4 + i}`).merge();
  summarySheet.getRange(`D${4 + i}`).values = [[methodLines[i]]];
}
summarySheet.getRange("D4:F7").format = { wrapText: true, verticalAlignment: "top", fill: "#EAF2F8" };
summarySheet.getRange("A10:F10").merge();
summarySheet.getRange("A10").values = [["This is a proposed dictionary, not a final categorization rule."]];
summarySheet.getRange("A11:F11").merge();
summarySheet.getRange("A11").values = [["Approve, reject, shorten or merge phrases; Raw Candidates preserves broader evidence."]];
summarySheet.getRange("A10:F11").format = { wrapText: true, verticalAlignment: "top", fill: "#D9EAD3" };
summarySheet.getRange("A:A").format.columnWidth = 34;
summarySheet.getRange("B:B").format.columnWidth = 16;
summarySheet.getRange("C:C").format.columnWidth = 4;
summarySheet.getRange("D:F").format.columnWidth = 20;

const outputPath = path.join(privateDir, "proposed_item_type_phrase_dictionary.xlsx");
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

for (const spec of [
  ["Summary", "A1:F13", "phrases-preview-summary.png"],
  ["Proposed Phrase List", "A1:L14", "phrases-preview-proposed.png"],
  ["Raw Candidates", "A1:J14", "phrases-preview-raw.png"],
]) {
  const preview = await workbook.render({ sheetName: spec[0], range: spec[1], scale: 1, format: "png" });
  await fs.writeFile(path.join(privateDir, spec[2]), new Uint8Array(await preview.arrayBuffer()));
}

console.log((await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 3000 })).ndjson);
console.log((await workbook.inspect({ kind: "table", sheetId: "Proposed Phrase List", range: "A1:L10", tableMaxRows: 10, tableMaxCols: 12, maxChars: 6000 })).ndjson);
console.log((await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 50 }, maxChars: 2000 })).ndjson);
console.log(outputPath);
