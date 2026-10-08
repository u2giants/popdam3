// Offline tests for the SQL literal emitters in tools/coldlion-landing/lib/values.mjs.
//
// An untyped NULL in a VALUES list is inferred as text by PostgreSQL, so a
// window whose numeric/bool/date/ts column is entirely null fails the INSERT
// against the real typed column. Scheduled run 37748611709 failed live on
// exactly that ("column \"line_price\" is of type numeric but expression is of
// type text"). Every null must be emitted with its target type.

import test from "node:test";
import assert from "node:assert/strict";

import { sqlBool, sqlDate, sqlNumber, sqlText, sqlTimestamp } from "./coldlion-landing/lib/values.mjs";

test("sqlNumber emits null::numeric for null/undefined, never a bare NULL", () => {
  assert.equal(sqlNumber(null), "null::numeric");
  assert.equal(sqlNumber(undefined), "null::numeric");
  assert.equal(sqlNumber(12.5), "12.5");
  assert.equal(sqlNumber(0), "0");
});

test("sqlBool emits null::boolean for null/undefined", () => {
  assert.equal(sqlBool(null), "null::boolean");
  assert.equal(sqlBool(undefined), "null::boolean");
  assert.equal(sqlBool(true), "true");
  assert.equal(sqlBool(false), "false");
});

test("sqlDate emits null::date for null/undefined", () => {
  assert.equal(sqlDate(null), "null::date");
  assert.equal(sqlDate(undefined), "null::date");
  assert.equal(sqlDate("2026-10-08"), "date '2026-10-08'");
});

test("sqlTimestamp emits null::timestamptz for null/undefined", () => {
  assert.equal(sqlTimestamp(null), "null::timestamptz");
  assert.equal(sqlTimestamp(undefined), "null::timestamptz");
  assert.equal(sqlTimestamp("2026-10-08T12:00:00.000Z"), "timestamptz '2026-10-08T12:00:00.000Z'");
});

test("sqlText emits a bare NULL — text is the VALUES default and matches text columns", () => {
  assert.equal(sqlText(null), "null");
  assert.equal(sqlText(undefined), "null");
  assert.equal(sqlText("POP"), "'POP'");
});
