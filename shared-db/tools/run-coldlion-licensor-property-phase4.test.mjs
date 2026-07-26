/**
 * Phase 4 ColdLion licensor/property link runner — deterministic local validation.
 *
 * No database, no credentials, no network. Proves the runner:
 *   - accepts ONLY the exact frozen approved set (hash 1230f5a12d0f2a3029f1d3df17fc5b5f,
 *     542 mappings, 271 distinct canonical UUIDs, approved_by Albert Hazan, preview target);
 *   - rejects tampering: flipped UUID, added NASA row, removed row, duplicate key,
 *     wrong target/hash/count/distinct/approver, bad mapping shape;
 *   - builds SQL calling public.sync_coldlion_licensors_properties(..., 'link_approved', ...)
 *     with the separately recomputed expected contract;
 *   - keeps the Phase 2 connection/target guards: dry-run default, production refused,
 *     connection strings never printed with credentials.
 *
 * Run: node --test tools/run-coldlion-licensor-property-phase4.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  APPROVED_BY,
  APPROVED_COUNT,
  APPROVED_DISTINCT,
  APPROVED_HASH,
  APPROVED_MAPPING_PATH,
  APPROVED_SCHEMA,
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertPreviewApplyTarget,
  buildExpectedContract,
  buildLinkInput,
  buildLinkSql,
  compositeKeyOf,
  computeMappingHash,
  describeTarget,
  encodeMappings,
  loadApprovedMapping,
  resolveRunMode,
  validateApprovedMapping,
} from "./run-coldlion-licensor-property-phase4.mjs";

const NASA_MAPPING = {
  entity_type: "licensor",
  company_code: "EDGEHOME",
  division_code: "CW001",
  mg_type_code: "05",
  mg_code: "NA",
  canonical_id: "9625fce2-25b4-471c-b9d9-0fdb9e07a338",
};

function loadDoc() {
  return JSON.parse(readFileSync(APPROVED_MAPPING_PATH, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test("exact frozen input validates and recomputes to the pinned approved set", () => {
  const doc = loadDoc();
  assert.equal(doc.schema, APPROVED_SCHEMA);
  assert.equal(doc.approved_by, "Albert Hazan");
  assert.ok(Array.isArray(doc.exclusions) && doc.exclusions.length > 0);
  assert.ok(JSON.stringify(doc.exclusions).includes("NASA"));

  const { input, expected } = validateApprovedMapping(doc);
  assert.deepEqual(expected, {
    hash: "1230f5a12d0f2a3029f1d3df17fc5b5f",
    count: 542,
    distinct_canonical: 271,
  });
  assert.equal(input.mappings.length, 542);
  assert.equal(input.approved_by, "Albert Hazan");
  assert.equal(typeof input.approved_at_utc, "string");
  assert.deepEqual(Object.keys(input).sort(), ["approved_at_utc", "approved_by", "mappings"]);
  assert.equal(computeMappingHash(doc.mappings), APPROVED_HASH);
  assert.equal(new Set(doc.mappings.map((m) => m.canonical_id)).size, APPROVED_DISTINCT);
  assert.equal(doc.mapping_count, APPROVED_COUNT);
  assert.equal(doc.distinct_canonical, APPROVED_DISTINCT);
  assert.equal(doc.approved_mapping_hash, APPROVED_HASH);
  assert.equal(doc.target, PREVIEW_PROJECT_REF);
  assert.equal(doc.approved_by, APPROVED_BY);
  // File order is already the deterministic code-unit sort; re-encoding is stable.
  assert.equal(encodeMappings(doc.mappings), encodeMappings(clone(doc.mappings).reverse()));
});

test("loadApprovedMapping returns the DB-ready input and expected contract", () => {
  const { input, expected } = loadApprovedMapping();
  assert.equal(expected.hash, APPROVED_HASH);
  assert.equal(input.mappings[0].entity_type === "licensor" || input.mappings[0].entity_type === "property", true);
  const keys = input.mappings.map(compositeKeyOf);
  assert.equal(new Set(keys).size, 542);
});

test("tampered canonical_id is rejected by the pinned hash", () => {
  const doc = loadDoc();
  // Swap two canonical UUIDs: the distinct set is unchanged, so only the hash can catch it.
  const first = doc.mappings[0].canonical_id;
  doc.mappings[0].canonical_id = doc.mappings[1].canonical_id;
  doc.mappings[1].canonical_id = first;
  assert.throws(() => validateApprovedMapping(doc), /hash does not match the pinned approved Phase 4 set/);
});

test("tampered mg_code is rejected by the pinned hash", () => {
  const doc = loadDoc();
  doc.mappings[0].mg_code = `${doc.mappings[0].mg_code}X`;
  assert.throws(() => validateApprovedMapping(doc), /hash does not match the pinned approved Phase 4 set/);
});

test("adding the excluded NASA row is rejected (count pin)", () => {
  const doc = loadDoc();
  doc.mappings.push(clone(NASA_MAPPING));
  doc.mapping_count = 543;
  assert.throws(() => validateApprovedMapping(doc), /count does not match the pinned approved Phase 4 set/);
});

test("removing a row is rejected (count pin)", () => {
  const doc = loadDoc();
  doc.mappings.pop();
  doc.mapping_count = 541;
  assert.throws(() => validateApprovedMapping(doc), /count does not match the pinned approved Phase 4 set/);
});

test("duplicate composite key is rejected before any count check", () => {
  const doc = loadDoc();
  doc.mappings.push(clone(doc.mappings[0]));
  assert.throws(() => validateApprovedMapping(doc), /duplicate composite source key/);
});

test("declared field mismatches are rejected even with untampered mappings", () => {
  const byHash = loadDoc();
  byHash.approved_mapping_hash = "0".repeat(32);
  assert.throws(() => validateApprovedMapping(byHash), /hash does not match the pinned approved Phase 4 set/);

  const byCount = loadDoc();
  byCount.mapping_count = 541;
  assert.throws(() => validateApprovedMapping(byCount), /count does not match the pinned approved Phase 4 set/);

  const byDistinct = loadDoc();
  byDistinct.distinct_canonical = 270;
  assert.throws(() => validateApprovedMapping(byDistinct), /distinct canonical count does not match the pinned approved Phase 4 set/);
});

test("wrong target is rejected — production explicitly, anything else as non-preview", () => {
  const prod = loadDoc();
  prod.target = PRODUCTION_PROJECT_REF;
  assert.throws(() => validateApprovedMapping(prod), /production qsllyeztdwjgirsysgai; Phase 4 is preview-only/);

  const other = loadDoc();
  other.target = "aaaaaaaaaaaaaaaaaaaa";
  assert.throws(() => validateApprovedMapping(other), /must be preview rjyboqwcdzcocqgmsyel/);
});

test("wrong approver or missing approval timestamp is rejected", () => {
  const approver = loadDoc();
  approver.approved_by = "Someone Else";
  assert.throws(() => validateApprovedMapping(approver), /approved_by must be "Albert Hazan"/);

  const stamp = loadDoc();
  stamp.approved_at_utc = "";
  assert.throws(() => validateApprovedMapping(stamp), /approved_at_utc is required/);
});

test("invalid mapping shape is rejected", () => {
  const badEntity = loadDoc();
  badEntity.mappings[0].entity_type = "vendor";
  assert.throws(() => validateApprovedMapping(badEntity), /shape invalid/);

  const badType = loadDoc();
  badType.mappings[0].mg_type_code = "5";
  assert.throws(() => validateApprovedMapping(badType), /shape invalid/);

  const badUuid = loadDoc();
  badUuid.mappings[0].canonical_id = "not-a-uuid";
  assert.throws(() => validateApprovedMapping(badUuid), /shape invalid/);

  const blankCode = loadDoc();
  blankCode.mappings[0].mg_code = "  ";
  assert.throws(() => validateApprovedMapping(blankCode), /shape invalid/);
});

test("SQL calls public.sync_coldlion_licensors_properties in link_approved mode with the pinned expected contract", () => {
  const doc = loadDoc();
  const sql = buildLinkSql(buildLinkInput(doc), buildExpectedContract(doc.mappings));
  assert.ok(sql.includes("select * from public.sync_coldlion_licensors_properties("));
  assert.ok(sql.includes("'link_approved'"));
  assert.ok(sql.includes("$p4_input$"));
  assert.ok(sql.includes("$p4_expected$"));
  assert.ok(sql.includes("::jsonb"));
  assert.ok(sql.includes(APPROVED_HASH));
  assert.ok(sql.includes('"approved_by":"Albert Hazan"'));
  // Exactly one call, one mode; never mirror_only, never a Phase 5 mode.
  assert.equal(sql.match(/sync_coldlion_licensors_properties\(/g).length, 1);
  assert.ok(!sql.includes("mirror_only"));
  assert.ok(!sql.includes("promote_approved"));
  // The expected contract literal is exactly {hash,count,distinct_canonical}.
  assert.ok(sql.includes(`"hash":"${APPROVED_HASH}"`));
  assert.ok(sql.includes('"count":542'));
  assert.ok(sql.includes('"distinct_canonical":271'));
});

test("run mode: dry-run default writes nothing; --apply requires a target", () => {
  const dry = resolveRunMode([], {});
  assert.equal(dry.apply, false);
  assert.equal(dry.willWriteDb, false);

  const apply = resolveRunMode(["--apply", "--linked"], {});
  assert.equal(apply.apply, true);
  assert.equal(apply.willWriteDb, true);

  // Dry-run never touches the target guard.
  assertPreviewApplyTarget({ apply: false, linked: false, connString: null });
  // Apply refuses missing target, production URL, and non-preview linked ref.
  assert.throws(
    () => assertPreviewApplyTarget({ apply: true, linked: false, connString: null }),
    /Refusing --apply/,
  );
  assert.throws(
    () => assertPreviewApplyTarget({ apply: true, linked: false, connString: `postgres://postgres.${PRODUCTION_PROJECT_REF}:x@aws-1-us-east-1.pooler.supabase.com:6543/postgres` }),
    /production/,
  );
  assert.throws(
    () => assertPreviewApplyTarget({ apply: true, linked: true, connString: null, linkedProjectRef: PRODUCTION_PROJECT_REF }),
    /not required preview/,
  );
  assertPreviewApplyTarget({ apply: true, linked: true, connString: null, linkedProjectRef: PREVIEW_PROJECT_REF });
});

test("target reporting never prints credentials", () => {
  const label = describeTarget("postgres://someuser:supersecret@db.example.com:6543/postgres");
  assert.ok(!label.includes("supersecret"));
  assert.ok(!label.includes("someuser"));
  assert.ok(label.includes("db.example.com"));
});
