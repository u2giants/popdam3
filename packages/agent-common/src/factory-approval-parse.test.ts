import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  detectFactoryApprovalProgram,
  parseFamaForm,
  parseFormDate,
  parseNbcuLmsForm,
} from "./factory-approval-parse";

const FAMA = `FACILITY AND MERCHANDISE AUTHORIZATION
FAMA ID
1WSJUPOCR6TX
Issuance Date: 12/05/2025
LICENSEE/VENDOR NAME:
POP CREATIONS INC (VEN-000123)
FACILITY NAME:
ZHEJIANG MYART CULTURAL AND CREATIVE PRODUCTS CO., LTD (FAC-046111)
FACILITY ALIAS NAME(S):
Hangzhou Okay Home Products Co., Ltd.
OKAY HOME
FACILITY ADDRESS:
No. 1 Road, Hangzhou, China
`;

const LMS = `NBCUniversal
WAIVER APPROVAL
Manufacturer Name: Zhejiang Xianju Tianyuan Crafts Co Ltd
Manufacturer Code: L-12813
Issued Date: May 28, 2026
Approval Expiration Date: May 28, 2027
`;

test("FAMA fields (reading order)", () => {
  const f = parseFamaForm(FAMA);
  assert.equal(f.name, "ZHEJIANG MYART CULTURAL AND CREATIVE PRODUCTS CO., LTD");
  assert.equal(f.number, "FAC-046111");
  assert.equal(f.formReference, "1WSJUPOCR6TX");
  assert.equal(f.issuedOn, "2025-12-05");
  assert.equal(f.expiresOn, null);
  assert.deepEqual(f.aliases, ["Hangzhou Okay Home Products Co., Ltd.", "OKAY HOME"]);
  assert.equal(detectFactoryApprovalProgram(FAMA), "disney");
});

test("FAMA label and value on one line (layout text)", () => {
  const f = parseFamaForm("FAMA ID: 1WSJUPOCR6TX\nFACILITY NAME: ACME CO (FAC-000001)\nIssuance Date: 01/02/2026\n");
  assert.equal(f.name, "ACME CO");
  assert.equal(f.number, "FAC-000001");
  assert.equal(f.formReference, "1WSJUPOCR6TX");
  assert.equal(f.issuedOn, "2026-01-02");
});

test("NBCU LMS fields", () => {
  const f = parseNbcuLmsForm(LMS);
  assert.equal(f.name, "Zhejiang Xianju Tianyuan Crafts Co Ltd");
  assert.equal(f.number, "L-12813");
  assert.equal(f.issuedOn, "2026-05-28");
  assert.equal(f.expiresOn, "2027-05-28");
  assert.equal(detectFactoryApprovalProgram(LMS), "nbcu");
});

test("dates", () => {
  assert.equal(parseFormDate("28 May 2027"), "2027-05-28");
  assert.equal(parseFormDate("Sept. 3, 2026"), "2026-09-03");
  assert.equal(parseFormDate("2026-02-30"), null);
  assert.equal(parseFormDate("soon"), null);
});

// Real samples: text extracted from the PDFs, when present on this machine.
for (const [file, check] of [
  [process.env.FAMA_SAMPLE_TXT, (t: string) => {
    const f = parseFamaForm(t);
    assert.equal(f.name, "ZHEJIANG MYART CULTURAL AND CREATIVE PRODUCTS CO., LTD");
    assert.equal(f.number, "FAC-046111");
    assert.equal(f.formReference, "1WSJUPOCR6TX");
    assert.equal(f.issuedOn, "2025-12-05");
  }],
  [process.env.LMS_SAMPLE_TXT, (t: string) => {
    const f = parseNbcuLmsForm(t);
    assert.equal(f.name, "Zhejiang Xianju Tianyuan Crafts Co Ltd");
    assert.equal(f.number, "L-12813");
    assert.equal(f.issuedOn, "2026-05-28");
    assert.equal(f.expiresOn, "2027-05-28");
  }],
] as const) {
  test(`real sample ${file ?? "(not set)"}`, { skip: !file || !existsSync(file) }, () => check(readFileSync(file as string, "utf8")));
}
