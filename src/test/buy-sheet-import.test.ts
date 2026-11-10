import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { exFactoryDate, parseBuySheetGrid, readBuySheetGrid, type BuySheetParse } from "@/lib/buy-sheet-import";

const FIXTURE = resolve(__dirname, "fixtures/burlington-buy-sheet-2026-10-20.xlsx");
const REFERENCE = new Date(2026, 10, 10); // 2026-11-10, the day of the first import

let parsed: BuySheetParse;
let grid: Awaited<ReturnType<typeof readBuySheetGrid>>;

beforeAll(async () => {
  const bytes = readFileSync(FIXTURE);
  grid = await readBuySheetGrid(new Uint8Array(bytes));
  parsed = parseBuySheetGrid(grid.grid, REFERENCE);
});

const line = (sku: string, date: string) => parsed.lines.find((l) => l.sku === sku && l.delivery_date === date);

describe("Burlington buy sheet (sample 10-20-26)", () => {
  it("reads the one sheet and its 44 item rows (rows 12-55), not the junk row 224", () => {
    expect(grid.sheetName).toBe("Multi-Ship Dates");
    expect(parsed.itemRowCount).toBe(44);
    expect(Math.min(...parsed.lines.map((l) => l.sheet_row))).toBe(12);
    expect(Math.max(...parsed.lines.map((l) => l.sheet_row))).toBe(55);
  });

  it("maps columns by content, not the shifted header text", () => {
    expect(parsed.columns).toEqual({ pack: "B", style: "H", fob: "BO" });
    expect(line("GFZ52MCBP", "2026-12-20")).toMatchObject({ burl_style: "GFZ52MCBP", label: "BLACK PANTHER", season: "5-SPRING 2027", fob_price: 6.3 });
    expect(line("BGX62MVMG01", "2026-12-20")).toMatchObject({ burl_style: "NEW", description: "15X20 GLS COMIC" });
  });

  it("reads the three deliveries' ex-factory dates", () => {
    expect(parsed.deliveries.map((d) => [d.index, d.date])).toEqual([
      [1, "2026-12-20"], [2, "2026-12-30"], [3, "2026-12-10"],
    ]);
    expect(parsed.headerFields["PO Buy Type"]).toBe("UP-FRONT PRODUCTION");
  });

  it("reproduces the delivery unit totals 14,400 / 11,400 / 4,800", () => {
    expect(parsed.totalsByDelivery).toEqual({ "2026-12-20": 14400, "2026-12-30": 11400, "2026-12-10": 4800 });
    const sum = (d: string) => parsed.lines.filter((l) => l.delivery_date === d).reduce((s, l) => s + l.quantity, 0);
    expect([sum("2026-12-20"), sum("2026-12-30"), sum("2026-12-10")]).toEqual([14400, 11400, 4800]);
  });

  it("re-applies the sheet's formulas: prepacks carry down a complex pack, units = prepacks x qty", () => {
    expect(line("AAQ14SSSS03", "2026-12-10")).toMatchObject({ quantity: 200, prepacks: 100, qty_per_prepack: 2, case_pack: 4 });
    expect(line("AAQ14DYWP01", "2026-12-10")).toMatchObject({ quantity: 100, case_pack: 4 });
    // zero in each prepack: no quantity, so no line
    expect(line("AAW14VMAT01", "2026-12-10")).toMatchObject({ quantity: 0 });
    expect(line("AAW14VMAT01", "2026-12-30")).toMatchObject({ quantity: 600 });
    expect(line("3FZ93MVSP22", "2026-12-10")).toMatchObject({ quantity: 600, case_pack: 4 });
    // pack 5 ships only on 12/20
    expect(parsed.lines.filter((l) => l.pack === "5").map((l) => l.delivery_date)).toEqual(["2026-12-20", "2026-12-20", "2026-12-20", "2026-12-20"]);
  });

  it("emits one line per style per delivery, never twice", () => {
    const keys = parsed.lines.map((l) => `${l.sku}|${l.delivery_date}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(parsed.lines.filter((l) => l.quantity > 0)).toHaveLength(54);
    expect(parsed.lines).toHaveLength(56);
    expect(parsed.lines.every((l) => l.group === `${l.delivery_date}|${l.pack}`)).toBe(true);
  });

  it("matches the existing Burlington OrderList orders' styles and dates", () => {
    // D3722 (12/10): pack 3; D3730 (12/20): packs 2, 5 and 8
    expect(parsed.lines.filter((l) => l.pack === "3" && l.delivery_date === "2026-12-10" && l.quantity > 0).map((l) => l.sku).sort())
      .toEqual(["AAQ14DYWP01", "AAQ14SSSS03", "AAW14SESC01"]);
    expect(parsed.lines.filter((l) => ["2", "5", "8"].includes(l.pack) && l.delivery_date === "2026-12-20").length).toBe(12);
  });
});

describe("ex-factory dates", () => {
  it("rolls into next year only when the date is long past", () => {
    expect(exFactoryDate("12/20 X FACT", REFERENCE)).toBe("2026-12-20");
    expect(exFactoryDate("1/15 X FACT", REFERENCE)).toBe("2027-01-15");
    expect(exFactoryDate("10/01 X FACT", REFERENCE)).toBe("2026-10-01");
    expect(exFactoryDate("no date", REFERENCE)).toBeNull();
  });
});

describe("rejects other spreadsheets", () => {
  it("needs a Complex Pack ID header", () => {
    expect(() => parseBuySheetGrid([["a", "b"], [1, 2]])).toThrow(/Complex Pack ID/);
  });
});
