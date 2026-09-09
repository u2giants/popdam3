import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(`${process.cwd()}/src/pages/StylesPage.tsx`, "utf8");
const importer = readFileSync(`${process.cwd()}/scripts/import-style-tracker-xlsx.py`, "utf8");

describe("Master Data source column contract", () => {
  it("keeps the Generic columns after UPC Code aligned with Google", () => {
    expect(importer).toContain('"U": "upc_code", "V": "sample_received"');
    expect(importer).toContain('"AB": "ordered_proff_photos", "AC": "ordered_test_report", "AD": "professional_photos"');
    expect(page).toContain('{ letter: "AB", header: "Ordered Proff Photos"');
    expect(page).toContain('{ letter: "AD", header: "Professional Photos"');
  });

  it("uses the same Yes/No behavior for Professional Photos in both tabs", () => {
    expect(page.match(/header: "Professional Photos"[^\n]+yesNo: true/g)).toHaveLength(2);
    expect(page).toContain('column.yesNo');
    expect(page).toContain('values: ["Yes", "No"]');
  });

  it("refuses an import when the workbook headers drift again", () => {
    expect(importer).toContain("validate_headers(sheet_name, worksheet)");
    expect(importer).toContain("refusing a shifted import");
  });
});
