import { describe, expect, it } from "vitest";
import { parsePdfSheetFields, skuFromFilename } from "./pdf-sheet-fields";

const V1 = `MOCKUP
10" X 20" SAMPLE CANVAS
QUICK REFERENCE
STYLE#: VSZ7OABCD01
CORE/STYLE GUIDE USED: Sample Guide
FILES USED: AB_0010 P1, AB 0029.psd
Date: 04/05/2022
Manager: Pat Manager
Designer: Sam Designer
License: Acme
Style#/SKU: VSZ70ABCD01
Description
10" X 20" SAMPLE CANVAS
C Artwork Approved`;

const V2 = `SKU # AAA66ABCD01
CREATIVE DESIGNER
PRODUCT EXAMPLE PHOTO
PRODUCT DESIGN
ROBIN
TECHNICAL DESIGNER
KIM
RETAILER & ON-SHELF
SAMPLE STORE FW26
PRODUCTTYPE
GREYBOARD STORAGE CHEST
WITH MAGNETIC CLOSURE
PRODUCT SIZE
W: 16”X H: 16" X D: 1”
ASSET/STYLE GUIDE
ASSETS: CC100001,
CC100002,
•AB_GE4_0029
out
PACKAGING TYPE
CARDBOARD CORNERS
AND STICKERS
CONSTRUCTION / MATERIALS
190 GSM FABRIC
PACKAGING DESIGN`;

describe("parsePdfSheetFields", () => {
  it("reads the older same-line form and prefers the filename SKU", () => {
    const f = parsePdfSheetFields(V1, "VSZ70ABCD01 tech pack.pdf");
    expect(f).toMatchObject({
      layout: "v1",
      sku: "VSZ70ABCD01",
      sku_source: "filename",
      creative_designer: "Sam Designer",
      manager: "Pat Manager",
      licensor: "Acme",
      style_guide: "Sample Guide",
      description: '10" X 20" SAMPLE CANVAS',
      files_used: ["AB_0010 P1", "AB 0029.psd"],
    });
  });

  it("keeps older-form blanks blank", () => {
    const f = parsePdfSheetFields("CORE/STYLE GUIDE USED:\nFILES USED:\nDimensions\nDesigner:\nLicense: Acme\nDescription\nC Artwork Approved", "x.pdf");
    expect(f.files_used).toEqual([]);
    expect(f.creative_designer).toBeNull();
    expect(f.style_guide).toBeNull();
    expect(f.description).toBeNull();
  });

  it("reads the newer form, skipping non-field headings between title and value", () => {
    const f = parsePdfSheetFields(V2, "AAA66ABCD01_LICENSING SHEET.pdf");
    expect(f).toMatchObject({
      layout: "v2",
      creative_designer: "ROBIN",
      technical_designer: "KIM",
      retailer: "SAMPLE STORE FW26",
      product_type: "GREYBOARD STORAGE CHEST WITH MAGNETIC CLOSURE",
      product_size: 'W: 16”X H: 16" X D: 1”',
      packaging_type: "CARDBOARD CORNERS AND STICKERS",
      materials: "190 GSM FABRIC",
      files_used: ["CC100001", "CC100002", "AB_GE4_0029"],
    });
  });

  it("never takes the next heading as a blank field's value", () => {
    const f = parsePdfSheetFields("CREATIVE DESIGNER\nPRODUCT DESIGN\nTECHNICAL DESIGNER\nKIM\nRETAILER\nPRODUCT TYPE\nCANVAS", "x.pdf");
    expect(f.creative_designer).toBeNull();
    expect(f.technical_designer).toBe("KIM");
    expect(f.retailer).toBeNull();
    expect(f.product_type).toBe("CANVAS");
  });

  it("reads a licensor from either heading and strips the copyright mark", () => {
    expect(parsePdfSheetFields("RETAILER\nX\nLICENSE / LEGAL LINE\n©ACME", "x.pdf").licensor).toBe("ACME");
    expect(parsePdfSheetFields("RETAILER\nX\nLICENSE\nAcme - Sub", "x.pdf").licensor).toBe("Acme - Sub");
  });

  it("returns no fields for ordinary documents", () => {
    const f = parsePdfSheetFields("Invoice 123\nTotal due", "invoice.pdf");
    expect(f.layout).toBeNull();
    expect(f.creative_designer).toBeNull();
    expect(f.files_used).toEqual([]);
  });

  it("rejects form text sitting where a value belongs", () => {
    const f = parsePdfSheetFields(
      "CREATIVE DESIGNER\nFACTORY: SEE PAGE 2 FOR CONSTRUCTION DETAILS\nTECHNICAL DESIGNER\n12\n())\nRETAILER\n10\nPRODUCT TYPE\nCANVAS\nPACKAGING TYPE\n©Acme\nAges 4+\nASSET/STYLE GUIDE\nASSETS: AB_0010.ai\nProp 65 Label\n7pt type\n5Warnings.ca.gov",
      "x.pdf",
    );
    expect(f.creative_designer).toBeNull();
    expect(f.technical_designer).toBeNull();
    expect(f.retailer).toBeNull();
    expect(f.packaging_type).toBeNull();
    expect(f.files_used).toEqual(["AB_0010.ai"]);
  });

  it("treats tick-box labels after Description as blank", () => {
    for (const label of ["_] New Submission", "Packaging", "_) Packaging"]) {
      expect(parsePdfSheetFields(`Designer: X Y\nDescription\n${label}`, "x.pdf").description).toBeNull();
    }
  });

  it("reads assets that follow a legal-line heading", () => {
    const f = parsePdfSheetFields("RETAILER\nX\nASSET/STYLE GUIDE\nLEGAL LINE\nPRODUCT:\nAB_0010.ai", "x.pdf");
    expect(f.files_used).toEqual(["AB_0010.ai"]);
  });

  it("assigns two names read after both designer headings, in order", () => {
    const f = parsePdfSheetFields("CREATIVE DESIGNER\n3/4 View\nTECHNICAL DESIGNER\nROBIN\nKIM\nRETAILER\nX", "x.pdf");
    expect(f.creative_designer).toBe("ROBIN");
    expect(f.technical_designer).toBe("KIM");
  });

  it("rejects a text SKU that is not SKU-shaped", () => {
    const f = parsePdfSheetFields("Designer: X\nStyle#/SKU: N/A", "x.pdf");
    expect(f.sku).toBeNull();
    expect(f.sku_source).toBeNull();
  });

  it("finds the SKU in filenames", () => {
    expect(skuFromFilename("VS162ABCD02 tech pack 090524.pdf")).toBe("VS162ABCD02");
    expect(skuFromFilename("15x20x1.25Glass_techpack copy.pdf")).toBeNull();
  });
});
