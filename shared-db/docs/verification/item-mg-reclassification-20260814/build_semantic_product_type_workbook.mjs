import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const dir = "C:/repos/shared-db/.private/item-mg-reclassification-20260814";
const groups = JSON.parse(await fs.readFile(path.join(dir, "mg_key_groups.json"), "utf8"));
const postRows = JSON.parse(await fs.readFile(path.join(dir, "mg_post_change_rows.json"), "utf8"));
const preRows = JSON.parse(await fs.readFile(path.join(dir, "mg_pre_change_rows.json"), "utf8"));
const evidenceGroups = JSON.parse(await fs.readFile(path.join(dir, "mg_semantic_evidence_groups.json"), "utf8"));
const summary = JSON.parse(await fs.readFile(path.join(dir, "mg_keyed_summary.json"), "utf8"));
const needsReview = postRows.filter(row => row["Review Status"] !== "Resolved");
const wb = Workbook.create();

function columnName(index) {
  let value = index + 1, result = "";
  while (value) { value--; result = String.fromCharCode(65 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}

function table(sheet, data, name, widths = {}, freezeColumns = 1) {
  if (!data.length) data = [{ Message: "No rows" }];
  const headers = Object.keys(data[0]);
  sheet.getRangeByIndexes(0, 0, data.length + 1, headers.length).values = [headers, ...data.map(row => headers.map(header => row[header] ?? ""))];
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(freezeColumns);
  const end = columnName(headers.length - 1);
  sheet.tables.add(`A1:${end}${data.length + 1}`, true, name).style = "TableStyleMedium2";
  sheet.getRange(`A1:${end}1`).format = { fill: "#17365D", font: { bold: true, color: "#FFFFFF" }, wrapText: true, rowHeight: 38 };
  headers.forEach((header, index) => sheet.getRangeByIndexes(0, index, data.length + 1, 1).format.columnWidth = widths[header] || 18);
}

const s = wb.worksheets.add("Summary");
s.showGridLines = false;
s.getRange("A1:F1").merge(); s.getRange("A1").values = [["MG Product Description Dictionary"]];
s.getRange("A1:F1").format = { fill: "#17365D", font: { bold: true, color: "#FFFFFF", size: 18 }, rowHeight: 32 };
s.getRange("A3:B18").values = [
  ["Measure", "Count"], ["Post-change items", summary.post_change_items], ["Items with complete MG keys", summary.complete_key_items],
  ["Items with incomplete MG keys", summary.incomplete_key_items], ["Distinct three-part MG keys", summary.mg_primary_keys],
  ["Keys mapped to rework definitions", summary.mapped_rework_keys], ["Keys not found in rework definitions", summary.unmapped_rework_keys],
  ["Post-change items with product wording", summary.resolved_product_wording_items], ["Post-change items needing wording", summary.unresolved_product_wording_items],
  ["Pre-change items", summary.pre_change_items], ["Pre-change items with product wording", summary.pre_change_product_wording_resolved],
  ["Pre-change items needing product wording", summary.pre_change_product_wording_unresolved],
  ["Historical semantic signatures", summary.historical_semantic_signatures],
  ["Pre-change high-confidence MG assignments", summary.pre_change_high_confidence_mg_assignments],
  ["Pre-change partial MG assignments", summary.pre_change_partial_mg_assignments],
  ["Pre-change high-confidence MG changes", summary.pre_change_high_confidence_mg_changes],
];
s.getRange("A3:B3").format = { fill: "#4472C4", font: { bold: true, color: "#FFFFFF" } };
s.getRange("B4:B18").format.numberFormat = "#,##0"; s.getRange("A:A").format.columnWidth = 42; s.getRange("B:B").format.columnWidth = 18;
s.getRange("D3:F3").merge(); s.getRange("D3").values = [["Controlling interpretation"]]; s.getRange("D3:F3").format = { fill: "#4472C4", font: { bold: true, color: "#FFFFFF" } };
const notes = [
  "MG01 + MG02 + MG03 together roughly describe the product.",
  "Classification uses the physical product + construction/shape + treatment.",
  "Licensor, property, artwork, slogan, color, character and size orientation have zero classification weight.",
  "Later full-key distributions decide whether all three MG parts are supported or MG03 must remain blank.",
];
notes.forEach((note, index) => { s.getRange(`D${4+index}:F${4+index}`).merge(); s.getRange(`D${4+index}`).values = [[note]]; });
s.getRange("D4:F7").format = { wrapText: true, fill: "#EAF2F8" }; s.getRange("D:F").format.columnWidth = 22;

const d = wb.worksheets.add("MG Product Dictionary");
table(d, groups, "MGProductDictionary", {
  "MG Primary Key":18,"MG01 Meaning":24,"MG02 Meaning":28,"MG03 Meaning":30,"Combined Product Meaning":55,
  "Rework Definition Options":75,"Definition Status":30,"Item Count":12,"Resolved Item Count":14,"Unresolved Item Count":14,
  "Distinct Product Wording Count":16,"Associated Product Wordings":70,"Observed Wording Variants":70,
  "Example Item Description 1":65,"Example Item Description 2":65,"Example Item Description 3":65,
  "Example Item Description 4":65,"Example Item Description 5":65,"Reviewer Decision":18,"Reviewer Notes":35,
}, 4);

const e = wb.worksheets.add("Classification Evidence");
table(e, evidenceGroups, "ClassificationEvidence", {
  "Physical Product":30,"Construction / Shape":25,"Treatment":22,"Historical Item Count":16,
  "Decision Level":20,"Proposed MG Key":20,"Later Full-Key Distribution":80,"Evidence Consensus %":18,
  "Selected Rework Meaning":50,"Decision Trace":90,"Artwork Used in Decision":20,
  "Example Historical Description":75,"Example Supporting Later Item":75,"Reviewer Decision":18,"Reviewer Notes":35,
}, 3);

const p = wb.worksheets.add("Post-Change Evidence");
table(p, postRows, "PostChangeEvidence", {"Original Item Desc":75,"Canonical Product Wording":36,"Observed Product Wording":36,"MG Key":18,"Created Date":18,"Item #":18,"Previous Extracted Product Type":34,"Review Status":24}, 5);

const h = wb.worksheets.add("Pre-Change Product Types");
table(h, preRows, "PreChangeProductTypes", {"Original Item Desc":75,"Extracted Product Wording":36,"Created Date":18,"Item #":18,"Classification Product":28,"Construction Profile":24,"Treatment Profile":24,"MG Assignment Status":44,"Proposed MG01":14,"Proposed MG02":14,"Proposed MG03":14,"Matched Later Item #":20,"Matched Later Item Desc":75,"Matched Later Date":18,"Matched Later MG Key":20,"Later MG Key Distribution":80,"Evidence Consensus %":18,"MG Evidence":90}, 5);

const n = wb.worksheets.add("Post-Change Needs Review");
table(n, needsReview, "PostChangeNeedsReview", {"Original Item Desc":75,"Canonical Product Wording":36,"Observed Product Wording":36,"MG Key":18,"Created Date":18,"Item #":18,"Review Status":24}, 5);

const out = path.join(dir, "mg_product_description_dictionary_review.xlsx");
await (await SpreadsheetFile.exportXlsx(wb)).save(out);
for (const [sheetName, range, file] of [
  ["Summary","A1:F19","mg2-summary.png"], ["MG Product Dictionary","A1:W15","mg2-dictionary.png"],
  ["Classification Evidence","A1:O15","mg2-classification-evidence.png"],
  ["Post-Change Evidence","A1:O15","mg2-post.png"], ["Pre-Change Product Types","A1:Z15","mg2-pre.png"],
  ["Post-Change Needs Review","A1:O15","mg2-needs.png"],
]) {
  const image = await wb.render({ sheetName, range, scale: 1, format: "png" });
  await fs.writeFile(path.join(dir, file), new Uint8Array(await image.arrayBuffer()));
}
console.log((await wb.inspect({kind:"sheet",include:"id,name",maxChars:3000})).ndjson);
console.log((await wb.inspect({kind:"table",sheetId:"MG Product Dictionary",range:"A1:W12",tableMaxRows:12,tableMaxCols:23,maxChars:8000})).ndjson);
console.log((await wb.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:50},maxChars:2000})).ndjson);
console.log(out);
