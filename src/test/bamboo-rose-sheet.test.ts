import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { BAMBOO_ROSE_COLUMNS, buildBambooRoseRows, fillBambooRoseTemplate, type OrderListFact } from "@/lib/bamboo-rose-sheet";
import { parseBuySheetGrid, readBuySheetGrid, type BuySheetParse } from "@/lib/buy-sheet-import";

const HFC = resolve(__dirname, "fixtures/burlington-buy-sheet-2026-10-20.xlsx");
// Fabi's hand-made Bamboo Rose sheet for the same buy, reduced to the compared columns:
// style|description|pack name|parent/child|label|cost|units|master ctn|new/carryover|multi HTS|HTS|factory|port|date
const EXPECTED: string[] = JSON.parse(readFileSync(resolve(__dirname, "fixtures/burlington-bamboo-rose-2026-10-20.expected.json"), "utf8"));

// OrderList on 2026-11-10 (D3722–D3736): assortment and vendor per pack and date.
const PACKS: Array<[string, string, string, string]> = [
  ["AA02A02", "Aggie Chen", "2026-12-10", "AA12AMSSPT01,VSQ2ADYPN05,AA02AMSREG01,VSZ41MVSP01"],
  ["AAG4A01", "Rita Okay Home", "2026-12-10", "VSV4AMVMV02,AAG4AMSSPT01,AAG4AMSSPT02,VSV4ADYPN01"],
  ["AAQ1403", "Aggie Chen", "2026-12-10", "AAQ14DYWP01,AAW14SESC01,AAQ14SSSS03"],
  ["B3M9306", "Jerome Chen", "2026-12-10", "B3M93MVVN01,B3M93DCBM01,3FZ93MVSP22"],
  ["AAA2G02", "Aggie Chen", "2026-12-20", "VSZ2GMVVN01,AA02GMVSP02,VSZ2GTSPR01,AA02GMVSP01"],
  ["AAA5102", "Aggie Chen", "2026-12-20", "AA051MVSP02,VSZ51MVSP01,VSZ851DATS,VSZ851WAJG"],
  ["AAW9303", "Aggie Chen", "2026-12-20", "AAW93MSREG01,AA093MVSP01,AA093MVSP02,AAW93MSSPT01"],
  ["BGX1404", "Jojo Xu", "2026-12-20", "BGX14DYCR01,BGX14MVSP02,BGX14MVVN01,BGX14SESC01"],
  ["BGX2501", "Lucy Wang", "2026-12-20", "PFX25MVSP09,MBX25DCPN,XA12SP,BGXTFMVSP01"],
  ["BGX6207", "Jerome Chen", "2026-12-20", "BGX62MVMG01,GFZ52MCBP,BGX62MVMG02,BGX62MVSP03"],
  ["AAG4A01", "Rita Okay Home", "2026-12-30", "VSV4AMVMV02,AAG4AMSSPT01,AAG4AMSSPT02,VSV4ADYPN01"],
  ["AAQ1404", "Aggie Chen", "2026-12-30", "AAQ14SSSS03,AAW14SESC01,AAW14VMAT01,AAQ14DYWP01"],
  ["B3M9305", "Jerome Chen", "2026-12-30", "3FZ93MVSP22,B3M93MVSP02,B3M93DCBM01,B3M93MVVN01"],
  ["BGX9301", "Lucy Wang", "2026-12-30", "BGX93MVSP02,BGX93MVAV01,BGX93MVMG01,BGX93MVSP03"],
];
const FACTS: OrderListFact[] = PACKS.flatMap(([assortment_id, vendor_name, start_ship_date, skus]) =>
  skus.split(",").map((sku) => ({ sku, start_ship_date, assortment_id, vendor_name, ship_to: "NINGBO" })));

let parsed: BuySheetParse;
beforeAll(async () => {
  parsed = parseBuySheetGrid((await readBuySheetGrid(new Uint8Array(readFileSync(HFC)))).grid, new Date(2026, 10, 10));
});

const build = () => buildBambooRoseRows(parsed, FACTS, { buyer: "BUYER", vendorEmail: "sales@example.com", packSuffix: "V2" });

describe("Bamboo Rose sheet from the 10-20-26 HFC", () => {
  it("matches Fabi's hand-made sheet on every row (descriptions ignoring case)", () => {
    const got = build().rows.map((r) =>
      [r["Catalog Style Name/Number"], r.Description, r["Complex Pack Name"], r["Complex Parent / Child"], r["Label from Vendor"],
        r["First Cost"], r["Total Units"], r["Qty in Master Ctn"], r["New / Carryover"], r["Multi HTS?"], r["HTS Code"],
        r["Factory #"], r["Port of Origin"], r["Earliest Ship / X Factory Date"]].map((v) => String(v ?? "")).join("|").toUpperCase());
    const want = EXPECTED.map((s) => s.toUpperCase());
    expect(got.length).toBe(want.length);
    expect([...got].sort()).toEqual([...want].sort());
  });

  it("fills the fixed fields and lists only HTS guesses to check", () => {
    const { rows, checks } = build();
    expect(rows[0]).toMatchObject({ Buyer: "BUYER", "Pack Method": "COMPLEX", "Vendor #": "90001808", "Terms Set/Inco": "DI FOB CY", "Size Range": "ITEM NOT SIZED" });
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatch(/Yuchen to confirm/);
  });

  it("writes into a template, keeping other sheets and later-row formulas", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("quote_excel.xml");
    ws.getRow(1).values = [...BAMBOO_ROSE_COLUMNS];
    ws.getCell("A2").value = "OLD";
    ws.getCell("A200").value = { formula: 'IF(AX200<>"","x","")' } as any;
    wb.addWorksheet("Sheet1").getCell("A1").value = "lookup";
    const out = await fillBambooRoseTemplate(new Uint8Array(await wb.xlsx.writeBuffer() as ArrayBuffer), build().rows);
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(out as any);
    const sheet = back.worksheets[0];
    expect(sheet.getCell("B2").value).toBeTruthy();
    expect(sheet.getCell("A2").value).toBe("BUYER");
    expect((sheet.getCell("A200").value as any).formula).toContain("AX200");
    expect(back.getWorksheet("Sheet1")?.getCell("A1").value).toBe("lookup");
  });
});
