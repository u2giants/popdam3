// Offline contract tests for the guarded ColdLion MG04 Size importer.
// No network, no database, no secrets — see .github/workflows/tools-offline-tests.yml.

import test from "node:test";
import assert from "node:assert/strict";

import {
  COMPANY_CODE,
  EXCLUDED_DIVISIONS,
  ImportRefusal,
  MG_TYPE_CODE_SIZE,
  SIZE_DIVISIONS,
  assertLandingSetIsSane,
  collectPages,
  normalizeDetailRow,
  parseArgs,
  selectSizeDivisions,
} from "./import-coldlion-product-size.mjs";

const sizeHeaders = [
  { divisionCode: "CW001", mgTypeCode: "04", mgTypeDesc: "Size" },
  { divisionCode: "EH001", mgTypeCode: "04", mgTypeDesc: "Size" },
  { divisionCode: "SP001", mgTypeCode: "04", mgTypeDesc: "Size" },
  { divisionCode: "EP001", mgTypeCode: "04", mgTypeDesc: "Pages" },
  { divisionCode: "CW001", mgTypeCode: "05", mgTypeDesc: "Licensor" },
];

const rowsFor = (division, count, prefix = "C") =>
  Array.from({ length: count }, (_, i) => ({
    companyCode: COMPANY_CODE,
    divisionCode: division,
    mgTypeCode: MG_TYPE_CODE_SIZE,
    code: `${prefix}${i}`,
    label: `${division} label ${i}`,
    raw: {},
  }));

const balancedSet = () => [
  ...rowsFor("CW001", 187, "A"),
  ...rowsFor("EH001", 156, "B"),
  ...rowsFor("SP001", 187, "C"),
];

test("dry run is the default and --apply is required to write", () => {
  assert.equal(parseArgs([]).apply, false);
  assert.equal(parseArgs(["--dry-run"]).apply, false);
  assert.equal(parseArgs(["--apply"]).apply, true);
});

test("an unrecognised flag is refused rather than ignored", () => {
  assert.throws(() => parseArgs(["--force"]), ImportRefusal);
  // --create must never exist on this tool; a silently ignored flag reads to the
  // operator as though the tool did what they asked.
  assert.throws(() => parseArgs(["--create"]), /--create is not a supported flag/);
});

test("guard thresholds must be sane integers", () => {
  assert.throws(() => parseArgs(["--min-rows=abc"]), ImportRefusal);
  assert.throws(() => parseArgs(["--min-rows=900", "--max-rows=700"]), ImportRefusal);
  assert.equal(parseArgs(["--max-retirements=0"]).maxRetirements, 0);
});

test("EP001 is excluded from the Size divisions", () => {
  assert.deepEqual(selectSizeDivisions(sizeHeaders), ["CW001", "EH001", "SP001"]);
  assert.ok(EXCLUDED_DIVISIONS.includes("EP001"));
});

test("a missing Size division is a refusal, never a smaller import", () => {
  const missingEh = sizeHeaders.filter((h) => h.divisionCode !== "EH001");
  assert.throws(() => selectSizeDivisions(missingEh), /EH001/);
});

test("normalizeDetailRow carries the whole identity tuple, never the code alone", () => {
  const row = normalizeDetailRow({ mgCode: " 5B ", mgDesc: ' 15X30" ' }, "CW001");
  assert.deepEqual(
    { ...row, raw: undefined },
    {
      companyCode: "EDGEHOME",
      divisionCode: "CW001",
      mgTypeCode: "04",
      code: "5B",
      label: '15X30"',
      raw: undefined,
    },
  );
});

test("blank codes and labels are refused", () => {
  assert.throws(() => normalizeDetailRow({ mgCode: "", mgDesc: "x" }, "CW001"), /blank mgCode/);
  assert.throws(() => normalizeDetailRow({ mgCode: "5B", mgDesc: " " }, "CW001"), /blank label/);
});

test("an EP001 row cannot be normalized into a Size at all", () => {
  assert.throws(
    () => normalizeDetailRow({ mgCode: "114", mgDesc: "114" }, "EP001"),
    /Pages, not Size/,
  );
});

test("collectPages walks every page of a Spring envelope", async () => {
  const pages = [
    { content: [1, 2], totalPages: 3, last: false },
    { content: [3, 4], totalPages: 3, last: false },
    { content: [5], totalPages: 3, last: true },
  ];
  const out = await collectPages(async (p) => pages[p]);
  assert.deepEqual(out.rows, [1, 2, 3, 4, 5]);
  assert.equal(out.pagesRead, 3);
});

test("collectPages accepts the plain array that /merchGroupDetails returns", async () => {
  const out = await collectPages(async () => [{ mgCode: "5B" }]);
  assert.equal(out.rows.length, 1);
  assert.equal(out.pagesRead, 1);
});

test("a feed that claims more pages than it delivers is refused", async () => {
  await assert.rejects(
    collectPages(async () => ({ content: [1], totalPages: 4, last: true })),
    /claimed 4 pages but delivered 1/,
  );
});

test("collectPages cannot loop forever", async () => {
  await assert.rejects(
    collectPages(async () => ({ content: [1], totalPages: 9999, last: false }), { maxPages: 5 }),
    /page ceiling/,
  );
});

test("a malformed page shape is refused, not skipped", async () => {
  await assert.rejects(collectPages(async () => ({ nope: true })), /neither an array nor a paged envelope/);
});

test("the balanced 530-row set passes every landing check", () => {
  const shape = assertLandingSetIsSane(balancedSet());
  assert.equal(shape.rowCount, 530);
  assert.deepEqual(shape.divisions, SIZE_DIVISIONS.slice().sort());
});

test("a truncated feed is refused by the count band", () => {
  assert.throws(() => assertLandingSetIsSane(rowsFor("CW001", 12)), /outside the accepted band/);
});

test("an empty fetch is refused rather than landed", () => {
  assert.throws(() => assertLandingSetIsSane([]), /refusing to land an empty set/);
});

test("a whole missing division is refused even when the row count looks fine", () => {
  const noSp = [...rowsFor("CW001", 300, "A"), ...rowsFor("EH001", 230, "B")];
  assert.equal(noSp.length, 530);
  assert.throws(() => assertLandingSetIsSane(noSp), /no rows fetched for division SP001/);
});

test("duplicate identities in one run are refused, not silently collapsed", () => {
  const dup = balancedSet();
  dup[0] = { ...dup[1] };
  assert.throws(() => assertLandingSetIsSane(dup), /duplicate identity in one run/);
});

test("an EP001 row that reaches the landing set is refused", () => {
  const leaky = balancedSet();
  leaky[0] = { ...leaky[0], divisionCode: "EP001" };
  assert.throws(() => assertLandingSetIsSane(leaky), /EP001 row reached the landing set/);
});
