import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const repo = "C:/repos/shared-db";
const privateDir = path.join(repo, ".private/item-mg-reclassification-20260814");
const summary = JSON.parse(await fs.readFile(path.join(privateDir, "summary.json"), "utf8"));
const allRows = JSON.parse(await fs.readFile(path.join(privateDir, "pre_cutoff_item_mg_audit.json"), "utf8"));
const changeRows = JSON.parse(await fs.readFile(path.join(privateDir, "high_confidence_changes.json"), "utf8"));
const headers = Object.keys(allRows[0]);

const workbook = Workbook.create();
const summarySheet = workbook.worksheets.add("Summary");
const changesSheet = workbook.worksheets.add("High Confidence Changes");
const allSheet = workbook.worksheets.add("All Pre-Cutoff Items");
changesSheet.getRangeByIndexes(0, 0, changeRows.length + 1, headers.length).values = [headers, ...changeRows.map(row => headers.map(h => row[h] ?? ""))];
allSheet.getRangeByIndexes(0, 0, allRows.length + 1, headers.length).values = [headers, ...allRows.map(row => headers.map(h => row[h] ?? ""))];

summarySheet.showGridLines = false;
summarySheet.getRange("A1:F1").merge();
summarySheet.getRange("A1").values = [["Historical Item MG01-MG04 Audit"]];
summarySheet.getRange("A1:F1").format = {
  fill: "#17365D", font: { bold: true, color: "#FFFFFF", size: 18 },
  rowHeight: 30, verticalAlignment: "center",
};
summarySheet.getRange("A3:B9").values = [
  ["Measure", "Count"],
  ["All items in source", summary.total_items],
  ["Items through May 13, 2025", summary.old_items],
  ["Items starting May 14, 2025", summary.new_items],
  ["High-confidence comparisons", summary.high_confidence_total],
  ["High-confidence changes needed", summary.change_needed],
  ["High-confidence codes already correct", summary.correct],
];
summarySheet.getRange("A3:B3").format = { fill: "#4472C4", font: { bold: true, color: "#FFFFFF" } };
summarySheet.getRange("A4:A9").format.font = { bold: true, color: "#17365D" };
summarySheet.getRange("B4:B9").format.numberFormat = "#,##0";
summarySheet.getRange("D3:F3").merge();
summarySheet.getRange("D3").values = [["How to use this file"]];
summarySheet.getRange("D3:F3").format = { fill: "#4472C4", font: { bold: true, color: "#FFFFFF" } };
summarySheet.getRange("D4:F9").merge();
summarySheet.getRange("D4").values = [[
  "Start with High Confidence Changes. Each suggestion is supported by a post-change item with the same or near-identical description and the same main dimensions. All Pre-Cutoff Items preserves every historical item, including unresolved records. Unresolved means the evidence was not strong enough to recommend a change."
]];
summarySheet.getRange("D4:F9").format = { wrapText: true, verticalAlignment: "top", fill: "#EAF2F8" };
summarySheet.getRange("A11:F11").merge();
summarySheet.getRange("A11").values = [["Confidence safeguards"]];
summarySheet.getRange("A11:F11").format = { fill: "#D9EAD3", font: { bold: true, color: "#274E13" } };
summarySheet.getRange("A12:F16").merge();
summarySheet.getRange("A12").values = [[
  "Exact descriptions pass only when every newer example agrees on MG01-MG04. Near matches require at least 95% description similarity, a clear lead over the runner-up, matching main dimensions, and unanimous newer codes. Generic labels such as TEST are excluded. No database rows were changed."
]];
summarySheet.getRange("A12:F16").format = { wrapText: true, verticalAlignment: "top" };
summarySheet.getRange("A18:F20").merge();
summarySheet.getRange("A18").values = [[
  `Sources: full_item_master.csv; MerchGroup_Rework.xlsx. Cutoff: ${summary.cutoff_rule}. Generated ${summary.generated_utc}.`
]];
summarySheet.getRange("A18:F20").format = { wrapText: true, font: { italic: true, color: "#666666" } };
summarySheet.getRange("A1:F20").format.font.name = "Aptos";
summarySheet.getRange("A:A").format.columnWidth = 38;
summarySheet.getRange("B:B").format.columnWidth = 16;
summarySheet.getRange("C:C").format.columnWidth = 4;
summarySheet.getRange("D:F").format.columnWidth = 20;
summarySheet.freezePanes.freezeRows(1);

for (const name of ["High Confidence Changes", "All Pre-Cutoff Items"]) {
  const sheet = workbook.worksheets.getItem(name);
  sheet.showGridLines = false;
  const used = sheet.getUsedRange();
  const rows = used.rowCount;
  const cols = used.columnCount;
  const header = sheet.getRangeByIndexes(0, 0, 1, cols);
  header.format = { fill: "#17365D", font: { bold: true, color: "#FFFFFF" }, wrapText: true, rowHeight: 34 };
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(2);
  sheet.tables.add(`A1:W${rows}`, true, name === "High Confidence Changes" ? "ChangesTable" : "AuditTable").style = "TableStyleMedium2";
  sheet.getRange(`A2:A${rows}`).format.numberFormat = "#,##0";
  sheet.getRange(`P2:Q${rows}`).format.numberFormat = "0.0";
  sheet.getRange("A:A").format.columnWidth = 14;
  sheet.getRange("B:B").format.columnWidth = 17;
  sheet.getRange("C:C").format.columnWidth = 58;
  sheet.getRange("D:E").format.columnWidth = 14;
  sheet.getRange("F:M").format.columnWidth = 13;
  sheet.getRange("N:O").format.columnWidth = 24;
  sheet.getRange("P:S").format.columnWidth = 16;
  sheet.getRange("T:T").format.columnWidth = 18;
  sheet.getRange("U:U").format.columnWidth = 58;
  sheet.getRange("V:W").format.columnWidth = 16;
}

const outputPath = path.join(privateDir, "historical_item_mg_audit.xlsx");
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);

for (const spec of [
  { sheetName: "Summary", range: "A1:F20", file: "preview-summary.png" },
  { sheetName: "High Confidence Changes", range: `A1:W${Math.min(summary.change_needed + 1, 20)}`, file: "preview-changes.png" },
  { sheetName: "All Pre-Cutoff Items", range: "A1:W12", file: "preview-all-items.png" },
]) {
  const preview = await workbook.render({ sheetName: spec.sheetName, range: spec.range, scale: 1, format: "png" });
  await fs.writeFile(path.join(privateDir, spec.file), new Uint8Array(await preview.arrayBuffer()));
}

console.log((await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 3000 })).ndjson);
console.log((await workbook.inspect({ kind: "table", sheetId: "High Confidence Changes", range: `A1:W${summary.change_needed + 1}`, tableMaxRows: 8, tableMaxCols: 23, maxChars: 5000 })).ndjson);
console.log((await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 50 }, maxChars: 2000 })).ndjson);
console.log(outputPath);
