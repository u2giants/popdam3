import assert from "node:assert/strict";
import test from "node:test";
import { safeFilesystemModifiedAt } from "./file-date-validation.js";

const NOW = Date.parse("2026-08-02T12:00:00Z");

test("keeps a plausible filesystem modification date", () => {
  assert.equal(
    safeFilesystemModifiedAt(new Date("2026-08-01T12:00:00Z"), NOW),
    "2026-08-01T12:00:00.000Z",
  );
});

test("allows up to one day of clock drift", () => {
  assert.equal(
    safeFilesystemModifiedAt(new Date("2026-08-03T12:00:00Z"), NOW),
    "2026-08-03T12:00:00.000Z",
  );
});

test("quarantines a date more than one day in the future", () => {
  assert.equal(
    safeFilesystemModifiedAt(new Date("2049-01-01T04:00:00Z"), NOW),
    null,
  );
});

test("quarantines an invalid date", () => {
  assert.equal(safeFilesystemModifiedAt(new Date("invalid"), NOW), null);
});
