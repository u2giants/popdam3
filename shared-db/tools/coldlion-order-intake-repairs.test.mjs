// Offline tests for the one-time ColdLion repair runner and its place in the
// intake workflow (SO 7128092 incident, 2026-10-27).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

import { repairStep } from "./coldlion-landing/apply-repairs.mjs";

const DIR = new URL("./coldlion-landing/repairs/", import.meta.url);

test("every committed repair is one transaction that records its own step", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));
  assert.ok(files.length >= 1);
  for (const file of files) {
    const sql = readFileSync(new URL(file, DIR), "utf8");
    assert.equal(repairStep(file, sql), file.replace(/\.sql$/, ""));
    assert.match(sql, /insert into coldlion\.sync_run[\s\S]*'preimage'/, `${file} captures a preimage`);
  }
});

test("the runner refuses a misnamed, unrecorded or non-transactional repair", () => {
  const ok = "begin;\nselect '20990101-x';\ncommit;\n";
  assert.equal(repairStep("20990101-x.sql", ok), "20990101-x");
  assert.throws(() => repairStep("x.sql", ok), /not named/);
  assert.throws(() => repairStep("20990101-x.sql", "begin;\ncommit;\n"), /never records/);
  assert.throws(() => repairStep("20990101-x.sql", "select '20990101-x';\n"), /one transaction/);
  assert.throws(() => repairStep("20990101-x.sql", "begin;\nselect '20990101-x';\nrollback;\n"), /one transaction/);
});

test("the component-identity repair never stores a null identity", () => {
  const sql = readFileSync(new URL("20261027-component-identity.sql", DIR), "utf8");
  assert.match(sql, /metadata ->> 'master_item_no' is null\) then\s*raise exception/);
});

test("the workflow applies repairs before the writer, skips them on dry-run/claim-only, and holds the writer when a repair fails", () => {
  const yml = readFileSync(new URL("../.github/workflows/coldlion-order-intake.yml", import.meta.url), "utf8");
  const repairs = yml.indexOf("name: Apply one-time ColdLion data repairs");
  const writer = yml.indexOf("name: Write canonical placeholder orders");
  assert.ok(repairs > 0 && writer > repairs);
  assert.match(yml.slice(repairs, writer), /dry_run != 'true' && github\.event\.inputs\.claim_only != 'true'/);
  assert.match(yml.slice(repairs, writer), /set -euo pipefail\s*node tools\/coldlion-landing\/apply-repairs\.mjs/);
  const writerIf = yml.slice(writer).match(/\n\s+if: (.*)/)[1];
  assert.doesNotMatch(writerIf, /always\(\)|cancelled\(\)|failure\(\)/);
});

test("the PostgreSQL 17 behavioural test is registered in CI", () => {
  const yml = readFileSync(new URL("../.github/workflows/tools-offline-tests.yml", import.meta.url), "utf8");
  assert.match(yml, /COLDLION_WRITER_TEST_CONTAINER="\$container" node --test tools\/coldlion-order-intake-identity-pg\.test\.mjs/);
});
