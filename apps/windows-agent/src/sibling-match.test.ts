import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSiblingPdf } from "./sibling-match";

test("exact name wins", () => {
  assert.equal(pickSiblingPdf("Art.ai", ["art.PDF", "Art_other.pdf"]), "art.PDF");
});
test("SKU prefix match", () => {
  assert.equal(
    pickSiblingPdf("CRM62SWDV01_ART.ai", ["CRM62SWDV01_ART.ai", "CRM62SWDV01_LICENSING SHEET.pdf"]),
    "CRM62SWDV01_LICENSING SHEET.pdf",
  );
});
test("shortest prefix match wins", () => {
  assert.equal(
    pickSiblingPdf("PTE66MVSP02 packaging.ai", ["PTE66MVSP02 tech pack_102423.pdf", "PTE66MVSP02 tech pack.pdf"]),
    "PTE66MVSP02 tech pack.pdf",
  );
});
test("equal-length tie returns null", () => {
  assert.equal(pickSiblingPdf("CRM62SWDV01_ART.ai", ["CRM62SWDV01_a.pdf", "CRM62SWDV01_b.pdf"]), null);
});
test("short token does not fuzzy match", () => {
  assert.equal(pickSiblingPdf("it.ai", ["it_sheet.pdf"]), null);
});
test("no pdf returns null", () => {
  assert.equal(pickSiblingPdf("cars.ai", ["cars.png", "notes.txt"]), null);
});
