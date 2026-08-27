import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const [payloadPath, outputPath, previewDir] = process.argv.slice(2);
if (!payloadPath || !outputPath || !previewDir) throw new Error("Usage: node build_final_workbook.mjs <payload.json> <output.xlsx> <preview-dir>");
const data = JSON.parse(await fs.readFile(payloadPath, "utf8"));
const workbook = Workbook.create();
const colors = { navy: "#17365D", blue: "#4472C4", pale: "#D9EAF7", green: "#D9EAD3", amber: "#FFF2CC" };

function addRows(name, rows) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  const headers = rows.length ? Object.keys(rows[0]) : ["No records"];
  const values = rows.length ? [headers, ...rows.map(r => headers.map(h => r[h] ?? ""))] : [headers];
  sheet.getRangeByIndexes(0, 0, values.length, headers.length).values = values;
  sheet.getRangeByIndexes(0, 0, 1, headers.length).format = { fill: colors.navy, font: { bold: true, color: "#FFFFFF" }, wrapText: true, rowHeight: 32 };
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(Math.min(2, headers.length));
  if (rows.length) sheet.tables.add(`A1:${columnName(headers.length)}${values.length}`, true, `${name.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}Table`).style = "TableStyleMedium2";
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c].toLowerCase();
    sheet.getRangeByIndexes(0, c, values.length, 1).format.columnWidth = h.includes("desc") || h.includes("decision") || h.includes("example") || h.includes("distribution") ? 48 : 18;
  }
  return sheet;
}
function columnName(n) { let s = ""; while (n) { n--; s = String.fromCharCode(65 + n % 26) + s; n = Math.floor(n / 26); } return s; }

const summary = workbook.worksheets.add("Summary");
summary.showGridLines = false;
summary.getRange("A1:F1").merge();
summary.getRange("A1").values = [["Historical Merchandise Group Repair — Final"]];
summary.getRange("A1:F1").format = { fill: colors.navy, font: { bold: true, color: "#FFFFFF", size: 18 }, rowHeight: 30 };
const s = data.summary;
summary.getRange("A3:B11").values = [["Outcome", "Rows"], ["Historical source rows", s.historical_rows], ["Full three-axis match", s.historical_matched_to_mg01_mg02_mg03], ["Form + subtype match", s.historical_matched_to_mg01_mg02], ["Form-only match", s.historical_matched_to_mg01], ["No reliable match", s.historical_unmatched_to_mg01], ["Invalid newer full codes excluded", s.post_change_invalid_full_code_rows], ["Invalid full codes with valid parent retained", s.post_change_invalid_full_valid_pair_rows], ["Total accounted for", s.historical_matched_to_mg01_mg02_mg03 + s.historical_matched_to_mg01_mg02 + s.historical_matched_to_mg01 + s.historical_unmatched_to_mg01]];
summary.getRange("A3:B3").format = { fill: colors.blue, font: { bold: true, color: "#FFFFFF" } };
summary.getRange("A4:A11").format.font = { bold: true, color: colors.navy };
summary.getRange("B4:B11").format.numberFormat = "#,##0";
summary.getRange("D3:F3").merge(); summary.getRange("D3").values = [["Reading the recommendations"]]; summary.getRange("D3:F3").format = { fill: colors.blue, font: { bold: true, color: "#FFFFFF" } };
summary.getRange("D4:F11").merge(); summary.getRange("D4").values = [["The matcher works independently from broad to narrow: physical form (MG01), family-specific subtype or material (MG02), then explicit embellishment (MG03). Missing or unreadable embellishment never becomes a fabricated full match. Invalid newer codes are excluded only at the level where they fail, so valid parent evidence is preserved."]]; summary.getRange("D4:F11").format = { wrapText: true, verticalAlignment: "top", fill: colors.pale };
summary.getRange("A13:F13").merge(); summary.getRange("A13").values = [["Precision holdout"]]; summary.getRange("A13:F13").format = { fill: colors.green, font: { bold: true, color: "#274E13" } };
const precisionRows = data.precision.by_level.filter(x => x.level > 0).map(x => [`Level ${x.level}`, x.tested, x.correct, x.precision]);
summary.getRangeByIndexes(14, 0, precisionRows.length + 1, 4).values = [["Level", "Tested", "Correct", "Precision"], ...precisionRows];
summary.getRange("A15:D15").format = { fill: colors.blue, font: { bold: true, color: "#FFFFFF" } }; summary.getRange("D16:D18").format.numberFormat = "0.0%";
summary.getRange("A:A").format.columnWidth = 40; summary.getRange("B:B").format.columnWidth = 16; summary.getRange("C:C").format.columnWidth = 16; summary.getRange("D:F").format.columnWidth = 22;
summary.freezePanes.freezeRows(1);

addRows("MG01 Associations", data.combinations["1"]);
addRows("MG01-MG02 Associations", data.combinations["2"]);
addRows("Full Associations", data.combinations["3"]);
addRows("Historical Recommendations", data.historical);
addRows("Dictionary Ledger", data.dictionary);
addRows("Residual Review", data.residual);
addRows("Precision Review", data.precision.errors);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.mkdir(previewDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook); await output.save(outputPath);
for (const spec of [{sheetName:"Summary", range:"A1:F18", file:"summary.png"},{sheetName:"Historical Recommendations", range:"A1:Z12", file:"recommendations.png"},{sheetName:"Residual Review", range:"A1:M12", file:"residual.png"}]) {
  const img = await workbook.render({ sheetName: spec.sheetName, range: spec.range, scale: 1, format: "png" });
  await fs.writeFile(path.join(previewDir, spec.file), new Uint8Array(await img.arrayBuffer()));
}
console.log((await workbook.inspect({ kind: "sheet", include: "id,name", maxChars: 4000 })).ndjson);
console.log((await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A", options: { useRegex: true, maxResults: 50 }, maxChars: 3000 })).ndjson);
console.log(outputPath);
