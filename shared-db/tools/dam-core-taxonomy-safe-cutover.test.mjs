// Unit tests for the safe DAM core licensor/property cutover tool + bridge migrations.
// Run with: node --test tools/dam-core-taxonomy-safe-cutover.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_BATCH_SIZE,
  TARGET_FK_SPECS,
  FORBIDDEN_APPLY_DDL_PHASES,
  BRIDGE_MIGRATION_VERSIONS,
  UNSAFE_MIGRATION_VERSION,
  ADVISORY_LOCK_KEY1,
  ADVISORY_LOCK_KEY2,
  STATUS_END_STATE_COMPLETE,
  STATUS_DML_COMPLETE_SCHEMA_INCOMPLETE,
  normalizeLegacyLicensorCode,
  normalizeName,
  matchLegacyLicensorToCore,
  matchPropertyByCode,
  matchPropertyByName,
  resolveCanonicalLicensorId,
  resolveTaxonomyRow,
  rowsNeedingRewrite,
  selectNextBatch,
  evaluatePreflight,
  evaluateFinalValidation,
  evaluateForwardProgress,
  evaluateBackfillGate,
  evaluateLedgerBarrier,
  formatProgressEvidence,
  buildPreflightSql,
  buildAssetBatchSql,
  buildStyleGroupsBackfillSql,
  buildBakeoffBackfillSql,
  buildFinalValidationSql,
  buildSessionTimeoutsSql,
  buildAdvisoryLockSql,
  buildAdvisoryUnlockSql,
  buildPhasePlan,
  assertApplyPlanIsDmlOnly,
  listBridgeMigrationFilenames,
  describeDbPushWorkflow,
} from "./dam-core-taxonomy-safe-cutover.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

const CORE_LICENSORS = [
  { id: "c-dy", code: "DY", name: "Disney" },
  { id: "c-ww", code: "WW", name: "WWE" },
  { id: "c-nk", code: "NK", name: "Nickelodeon" },
  // Ambiguous name pair (no unique name match)
  { id: "c-dup-a", code: "X1", name: "Duplicate Name Co" },
  { id: "c-dup-b", code: "X2", name: "Duplicate Name Co" },
];

const CORE_PROPERTIES = [
  { id: "p-1", licensor_id: "c-dy", code: "FRZN", name: "Frozen" },
  { id: "p-2", licensor_id: "c-dy", code: "MICK", name: "Mickey" },
  { id: "p-3a", licensor_id: "c-nk", code: "A1", name: "SpongeBob" },
  { id: "p-3b", licensor_id: "c-nk", code: "A2", name: "SpongeBob" },
  { id: "p-4", licensor_id: "c-ww", code: "FRZN", name: "Frozen WWE collides code only" },
];

const CORE_LIC_IDS = new Set(CORE_LICENSORS.map((c) => c.id));
const CORE_PROP_IDS = new Set(CORE_PROPERTIES.map((p) => p.id));

test("normalizeLegacyLicensorCode applies DS→DY and WWE→WW only", () => {
  assert.equal(normalizeLegacyLicensorCode("DS"), "DY");
  assert.equal(normalizeLegacyLicensorCode("WWE"), "WW");
  assert.equal(normalizeLegacyLicensorCode("NK"), "NK");
  assert.equal(normalizeLegacyLicensorCode(null), null);
});

test("matchLegacyLicensorToCore prefers code; hard-fails ambiguous name", () => {
  const byCode = matchLegacyLicensorToCore(
    { id: "L1", external_id: "DS", name: "Something Else" },
    CORE_LICENSORS,
  );
  assert.equal(byCode.coreId, "c-dy");
  assert.equal(byCode.via, "code");
  assert.equal(byCode.ambiguous, false);

  const byName = matchLegacyLicensorToCore(
    { id: "L2", external_id: "NOPE", name: "  nickelodeon " },
    CORE_LICENSORS,
  );
  assert.equal(byName.coreId, "c-nk");
  assert.equal(byName.via, "name");

  const miss = matchLegacyLicensorToCore(
    { id: "L3", external_id: "ZZ", name: "Missing" },
    CORE_LICENSORS,
  );
  assert.equal(miss.coreId, null);
  assert.equal(miss.ambiguous, false);

  const amb = matchLegacyLicensorToCore(
    { id: "L4", external_id: "NOPE", name: "Duplicate Name Co" },
    CORE_LICENSORS,
  );
  assert.equal(amb.coreId, null);
  assert.equal(amb.ambiguous, true);
});

test("property match is code-first, unique, scoped to licensor; never guesses", () => {
  assert.equal(matchPropertyByCode("c-dy", "frzn", CORE_PROPERTIES), "p-1");
  assert.equal(matchPropertyByCode("c-ww", "FRZN", CORE_PROPERTIES), "p-4");
  assert.equal(matchPropertyByCode("c-dy", "NOPE", CORE_PROPERTIES), null);
  assert.equal(matchPropertyByName("c-nk", "SpongeBob", CORE_PROPERTIES), null);
  assert.equal(matchPropertyByName("c-dy", " Mickey ", CORE_PROPERTIES), "p-2");
});

test("partial-resume: COALESCE preserves valid core licensor when property still legacy", () => {
  const map = new Map([["legacy-dy", "c-dy"]]);

  // Bug case: licensor already core UUID; property still legacy.
  // Legacy map join on licensor_id misses → must NOT null the licensor.
  const partial = resolveTaxonomyRow(
    {
      id: "a-partial",
      licensor_id: "c-dy",
      property_id: "legacy-prop-uuid",
      property_code: "FRZN",
      property_name: "Frozen",
    },
    map,
    CORE_PROPERTIES,
    CORE_LIC_IDS,
    CORE_PROP_IDS,
  );
  assert.equal(partial.licensor_id, "c-dy");
  assert.equal(partial.property_id, "p-1");

  // resolveCanonicalLicensorId unit
  assert.equal(
    resolveCanonicalLicensorId(
      { licensor_id: "c-dy" },
      map,
      CORE_LIC_IDS,
    ),
    "c-dy",
  );
  assert.equal(
    resolveCanonicalLicensorId(
      { licensor_id: "legacy-dy" },
      map,
      CORE_LIC_IDS,
    ),
    "c-dy",
  );
  assert.equal(
    resolveCanonicalLicensorId(
      { licensor_id: "unknown" },
      map,
      CORE_LIC_IDS,
    ),
    null,
  );

  // Existing valid core property preserved even if code/name missing
  const keepProp = resolveTaxonomyRow(
    {
      id: "a-keep-prop",
      licensor_id: "c-dy",
      property_id: "p-2",
      property_code: null,
      property_name: null,
    },
    map,
    CORE_PROPERTIES,
    CORE_LIC_IDS,
    CORE_PROP_IDS,
  );
  assert.equal(keepProp.licensor_id, "c-dy");
  assert.equal(keepProp.property_id, "p-2");
});

test("resolveTaxonomyRow: code wins; missing/ambiguous property → null; text preserved", () => {
  const map = new Map([
    ["legacy-dy", "c-dy"],
    ["legacy-nk", "c-nk"],
  ]);

  const byCode = resolveTaxonomyRow(
    {
      id: "a1",
      licensor_id: "legacy-dy",
      property_id: "legacy-prop",
      property_code: "FRZN",
      property_name: "Mickey",
    },
    map,
    CORE_PROPERTIES,
    CORE_LIC_IDS,
    CORE_PROP_IDS,
  );
  assert.equal(byCode.licensor_id, "c-dy");
  assert.equal(byCode.property_id, "p-1");
  assert.equal(byCode.preserved_property_code, "FRZN");
  assert.equal(byCode.preserved_property_name, "Mickey");

  const ambiguous = resolveTaxonomyRow(
    {
      id: "a3",
      licensor_id: "legacy-nk",
      property_code: null,
      property_name: "SpongeBob",
    },
    map,
    CORE_PROPERTIES,
    CORE_LIC_IDS,
    CORE_PROP_IDS,
  );
  assert.equal(ambiguous.licensor_id, "c-nk");
  assert.equal(ambiguous.property_id, null);

  const unmappedLicensor = resolveTaxonomyRow(
    {
      id: "a4",
      licensor_id: "unknown-legacy",
      property_code: "FRZN",
      property_name: "Frozen",
    },
    map,
    CORE_PROPERTIES,
    CORE_LIC_IDS,
    CORE_PROP_IDS,
  );
  assert.equal(unmappedLicensor.licensor_id, null);
  assert.equal(unmappedLicensor.property_id, null);
});

test("rowsNeedingRewrite + selectNextBatch support resume semantics", () => {
  const rows = [
    { id: "u3", licensor_id: "legacy", property_id: null },
    { id: "u1", licensor_id: "c-dy", property_id: "p-1" },
    { id: "u2", licensor_id: "c-dy", property_id: "legacy-prop" },
    { id: "u4", licensor_id: null, property_id: null },
  ];
  const residual = rowsNeedingRewrite(rows, CORE_LIC_IDS, CORE_PROP_IDS);
  assert.deepEqual(
    residual.map((r) => r.id).sort(),
    ["u2", "u3"],
  );
  assert.deepEqual(selectNextBatch(residual, 1, null).map((r) => r.id), ["u2"]);
  assert.deepEqual(selectNextBatch(residual, 1, "u2").map((r) => r.id), ["u3"]);
  assert.throws(() => selectNextBatch(residual, 0), /positive integer/);
});

test("evaluatePreflight hard-fails unmapped and ambiguous licensors", () => {
  const unmapped = evaluatePreflight({
    unmappedLegacyLicensors: 2,
    ambiguousLegacyLicensors: 0,
    residualAssets: 10,
    legacyTargetedFkCount: 0,
  });
  assert.equal(unmapped.action, "abort");
  assert.match(unmapped.reason, /2 legacy licensors have no canonical core\.licensor match/);

  // Intended ambiguous-licensor abort message (word order: count, then "ambiguous").
  const ambiguous = evaluatePreflight({
    unmappedLegacyLicensors: 0,
    ambiguousLegacyLicensors: 3,
    residualAssets: 10,
    legacyTargetedFkCount: 0,
  });
  assert.equal(ambiguous.action, "abort");
  assert.match(
    ambiguous.reason,
    /3 legacy licensors have ambiguous \(multiple\) core\.licensor matches/,
  );
  assert.doesNotMatch(ambiguous.reason, /no canonical/);
});

test("evaluatePreflight refuses DML while legacy FKs remain", () => {
  const d = evaluatePreflight({
    unmappedLegacyLicensors: 0,
    ambiguousLegacyLicensors: 0,
    residualAssets: 100,
    residualStyleGroups: 0,
    residualBakeoff: 0,
    legacyTargetedFkCount: 5,
    coreTargetedFkCount: 0,
  });
  assert.equal(d.action, "abort");
  assert.match(d.reason, /20260723112910/);
  assert.deepEqual(d.phases, []);
});

test("evaluatePreflight DML-only proceed / noop (no DDL phases)", () => {
  const proceed = evaluatePreflight({
    unmappedLegacyLicensors: 0,
    ambiguousLegacyLicensors: 0,
    residualAssets: 85481,
    residualStyleGroups: 50,
    residualBakeoff: 3,
    coreTargetedFkCount: 0,
    legacyTargetedFkCount: 0,
    missingFkCount: 5,
    characterCatalogExists: false,
    batchSize: DEFAULT_BATCH_SIZE,
  });
  assert.equal(proceed.action, "proceed");
  assert.deepEqual(proceed.phases, ["backfill"]);
  for (const p of FORBIDDEN_APPLY_DDL_PHASES) {
    assert.ok(!proceed.phases.includes(p));
  }

  const noop = evaluatePreflight({
    unmappedLegacyLicensors: 0,
    residualAssets: 0,
    residualStyleGroups: 0,
    residualBakeoff: 0,
    coreTargetedFkCount: 5,
    characterCatalogExists: true,
  });
  assert.equal(noop.action, "noop");
  assert.equal(noop.status, STATUS_END_STATE_COMPLETE);
  assert.deepEqual(noop.phases, []);

  // Residuals zero but FKs/view missing → not full success.
  const schemaIncomplete = evaluatePreflight({
    unmappedLegacyLicensors: 0,
    residualAssets: 0,
    residualStyleGroups: 0,
    residualBakeoff: 0,
    coreTargetedFkCount: 0,
    missingFkCount: 5,
    characterCatalogExists: false,
  });
  assert.equal(schemaIncomplete.action, "noop");
  assert.equal(schemaIncomplete.status, STATUS_DML_COMPLETE_SCHEMA_INCOMPLETE);
  assert.match(schemaIncomplete.reason, /dml_complete_schema_incomplete/);
  assert.doesNotMatch(schemaIncomplete.reason, /end-state complete/i);
});

test("buildPhasePlan is DML-only; assertApplyPlanIsDmlOnly proves no FK/view DDL", () => {
  const decision = evaluatePreflight({
    unmappedLegacyLicensors: 0,
    residualAssets: 4500,
    residualStyleGroups: 10,
    residualBakeoff: 1,
    coreTargetedFkCount: 0,
    legacyTargetedFkCount: 0,
    missingFkCount: 5,
    characterCatalogExists: false,
    batchSize: 2000,
  });
  const plan = buildPhasePlan(decision, 2000);
  assert.equal(plan.action, "proceed");
  assert.ok(plan.steps.every((s) => !FORBIDDEN_APPLY_DDL_PHASES.includes(s.phase)));
  assert.ok(!plan.steps.some((s) => s.phase === "drop_fks"));
  assert.ok(!plan.steps.some((s) => s.phase === "finalize"));
  assert.equal(plan.steps.filter((s) => s.phase === "backfill_assets").length, 3);
  assert.ok(assertApplyPlanIsDmlOnly(plan));

  for (const step of plan.steps) {
    if (step.sql) {
      assert.doesNotMatch(step.sql, /\badd\s+constraint\b/i);
      assert.doesNotMatch(step.sql, /\bvalidate\s+constraint\b/i);
      assert.doesNotMatch(step.sql, /\bcreate\s+or\s+replace\s+view\b/i);
      assert.doesNotMatch(step.sql, /\bdrop\s+constraint\b/i);
    }
  }
});

test("asset/style SQL preserve COALESCE partial-resume + hard-fail ambiguity", () => {
  const pre = buildPreflightSql();
  assert.match(pre, /unmapped_legacy_licensors/);
  assert.match(pre, /ambiguous_legacy_licensors/);
  assert.match(pre, /when 'DS' then 'DY'/);

  const batch = buildAssetBatchSql(2000);
  const batchBody = batch.replace(/--[^\n]*/g, " ");
  assert.match(batch, /limit 2000/);
  assert.match(batch, /coalesce\(\s*\(select c\.id from core\.licensor/i);
  assert.match(batch, /coalesce\(\s*\(select p\.id from core\.property/i);
  // Transaction-local trigger suppression — no schema DDL statements.
  assert.match(batchBody, /set\s+local\s+session_replication_role\s*=\s*replica/i);
  assert.doesNotMatch(batchBody, /\balter\s+table\b/i);
  assert.doesNotMatch(batchBody, /\bdisable\s+trigger\b/i);
  assert.doesNotMatch(batchBody, /\benable\s+trigger\b/i);
  assert.doesNotMatch(batchBody, /\bcreate\s+(or\s+replace\s+)?view\b/i);
  assert.doesNotMatch(batchBody, /\bdrop\s+(constraint|table|view|index|function|trigger)\b/i);
  assert.doesNotMatch(batchBody, /\bvalidate\s+constraint\b/i);
  assert.doesNotMatch(batchBody, /\badd\s+constraint\b/i);
  assert.match(batch, /ambiguous/);

  const sg = buildStyleGroupsBackfillSql();
  const sgBody = sg.replace(/--[^\n]*/g, " ");
  assert.match(sg, /coalesce\(\s*\(select c\.id from core\.licensor/i);
  assert.doesNotMatch(sgBody, /\balter\s+table\b/i);
  assert.doesNotMatch(sgBody, /\badd\s+constraint\b/i);
  assert.doesNotMatch(sgBody, /\bcreate\s+(or\s+replace\s+)?view\b/i);
  assert.doesNotMatch(sgBody, /\bvalidate\s+constraint\b/i);

  const bo = buildBakeoffBackfillSql();
  const boBody = bo.replace(/--[^\n]*/g, " ");
  assert.match(bo, /ai_tag_bakeoff_results/);
  assert.match(bo, /set property_id = null/);
  assert.doesNotMatch(boBody, /\balter\s+table\b/i);
  assert.doesNotMatch(boBody, /\bcreate\s+(or\s+replace\s+)?view\b/i);
  assert.doesNotMatch(boBody, /\bvalidate\s+constraint\b/i);

  assert.throws(() => buildAssetBatchSql(0), /Invalid batchSize/);
});

test("session timeouts and advisory lock SQL present", () => {
  const timeouts = buildSessionTimeoutsSql();
  assert.match(timeouts, /lock_timeout/);
  assert.match(timeouts, /statement_timeout/);
  assert.match(timeouts, /set local/i);

  const lock = buildAdvisoryLockSql();
  assert.match(lock, /pg_try_advisory_lock/);
  assert.match(lock, new RegExp(String(ADVISORY_LOCK_KEY1)));
  assert.match(lock, new RegExp(String(ADVISORY_LOCK_KEY2)));

  const unlock = buildAdvisoryUnlockSql();
  assert.match(unlock, /pg_advisory_unlock/);
});

test("evaluateForwardProgress aborts stuck residual loops", () => {
  assert.equal(
    evaluateForwardProgress({
      residualBefore: 100,
      residualAfter: 80,
      rowsUpdated: 20,
    }).ok,
    true,
  );
  assert.equal(
    evaluateForwardProgress({
      residualBefore: 100,
      residualAfter: 100,
      rowsUpdated: 0,
    }).ok,
    false,
  );
  assert.equal(
    evaluateForwardProgress({
      residualBefore: 100,
      residualAfter: 100,
      rowsUpdated: 5,
    }).ok,
    false,
  );
  assert.equal(
    evaluateForwardProgress({
      residualBefore: 0,
      residualAfter: 0,
      rowsUpdated: 0,
    }).ok,
    true,
  );
});

test("evaluateFinalValidation enforces five core FKs and zero residuals", () => {
  assert.equal(
    evaluateFinalValidation({
      bad_asset_licensors: 1,
      bad_asset_properties: 0,
      bad_sg_licensors: 0,
      bad_sg_properties: 0,
      bad_bakeoff_properties: 0,
      core_fk_count: 5,
      character_catalog_exists: true,
    }).ok,
    false,
  );
  assert.equal(
    evaluateFinalValidation({
      bad_asset_licensors: 0,
      bad_asset_properties: 0,
      bad_sg_licensors: 0,
      bad_sg_properties: 0,
      bad_bakeoff_properties: 0,
      core_fk_count: 4,
      character_catalog_exists: true,
    }).ok,
    false,
  );
  assert.equal(
    evaluateFinalValidation({
      bad_asset_licensors: 0,
      bad_asset_properties: 0,
      bad_sg_licensors: 0,
      bad_sg_properties: 0,
      bad_bakeoff_properties: 0,
      core_fk_count: TARGET_FK_SPECS.length,
      character_catalog_exists: true,
    }).ok,
    true,
  );

  const val = buildFinalValidationSql();
  assert.match(val, /core_fk_count/);
  assert.match(val, /assets_licensor_id_fkey/);
  assert.match(val, /assets_property_id_fkey/);
  assert.match(val, /style_groups_licensor_id_fkey/);
  assert.match(val, /style_groups_property_id_fkey/);
  assert.match(val, /ai_tag_bakeoff_results_property_id_fkey/);
  assert.match(val, /character_catalog_exists/);
});

test("gate/barrier pure evaluators: production refusal vs preview pass", () => {
  assert.equal(
    evaluateBackfillGate({
      residualAssets: 10,
      residualStyleGroups: 0,
      residualBakeoff: 0,
    }).ok,
    false,
  );
  assert.equal(
    evaluateBackfillGate({
      residualAssets: 0,
      residualStyleGroups: 0,
      residualBakeoff: 0,
    }).ok,
    true,
  );

  // Production before repair: 113000 not in ledger → barrier refuses
  const prodRefuse = evaluateLedgerBarrier({ hasUnsafe113000InLedger: false });
  assert.equal(prodRefuse.ok, false);
  assert.match(prodRefuse.reason, /repair/);

  // Preview / post-repair: 113000 recorded → barrier passes
  const previewPass = evaluateLedgerBarrier({ hasUnsafe113000InLedger: true });
  assert.equal(previewPass.ok, true);
});

test("bridge migrations exist, ordered between 112900 and 113000, correct roles", () => {
  const files = listBridgeMigrationFilenames();
  assert.deepEqual(BRIDGE_MIGRATION_VERSIONS, [
    "20260723112910",
    "20260723112920",
    "20260723112930",
    "20260723112940",
  ]);

  for (const f of files) {
    const path = join(MIGRATIONS_DIR, f);
    assert.ok(existsSync(path), `missing ${f}`);
    const version = f.slice(0, 14);
    assert.ok(version > "20260723112900", `${f} must sort after 112900`);
    assert.ok(version < UNSAFE_MIGRATION_VERSION, `${f} must sort before 113000`);
  }

  // Unsafe file still present and unedited marker
  const unsafePath = join(
    MIGRATIONS_DIR,
    "20260723113000_dam_core_licensor_property_cutover.sql",
  );
  assert.ok(existsSync(unsafePath));
  const unsafe = readFileSync(unsafePath, "utf8");
  assert.match(unsafe, /create temporary table dam_legacy_licensor_map/);

  const dropSql = readFileSync(join(MIGRATIONS_DIR, files[0]), "utf8");
  assert.match(dropSql, /public\.licensors/);
  assert.match(dropSql, /drop constraint if exists/i);
  // Catalog match is exact table+constraint pairs, not conname-only.
  assert.match(dropSql, /rel\.relname = 'assets' and c\.conname = 'assets_licensor_id_fkey'/);
  assert.match(
    dropSql,
    /rel\.relname = 'ai_tag_bakeoff_results' and c\.conname = 'ai_tag_bakeoff_results_property_id_fkey'/,
  );
  assert.doesNotMatch(dropSql, /update public\.assets/i);
  assert.doesNotMatch(dropSql, /schema_migrations/i);

  const gateSql = readFileSync(join(MIGRATIONS_DIR, files[1]), "utf8");
  assert.match(gateSql, /backfill gate/i);
  assert.match(gateSql, /raise exception/i);
  assert.doesNotMatch(gateSql, /update public\.assets/i);

  const finSql = readFileSync(join(MIGRATIONS_DIR, files[2]), "utf8");
  assert.match(finSql, /references core\.licensor/);
  assert.match(finSql, /references core\.property/);
  assert.match(finSql, /validate constraint assets_licensor_id_fkey/i);
  assert.match(finSql, /create or replace view public\.dam_character_catalog/i);
  assert.match(finSql, /rel\.relname = 'assets' and c\.conname = 'assets_licensor_id_fkey'/);
  assert.match(
    finSql,
    /rel\.relname = 'ai_tag_bakeoff_results' and c\.conname = 'ai_tag_bakeoff_results_property_id_fkey'/,
  );
  assert.doesNotMatch(finSql, /update public\.assets/i);
  assert.doesNotMatch(finSql, /limit 5000/i);

  const barrierSql = readFileSync(join(MIGRATIONS_DIR, files[3]), "utf8");
  assert.match(barrierSql, /schema_migrations/);
  assert.match(barrierSql, /20260723113000/);
  assert.match(barrierSql, /migration repair/i);
  assert.match(barrierSql, /raise exception/i);
  // Must not write ledger from SQL
  assert.doesNotMatch(barrierSql, /insert\s+into\s+supabase_migrations/i);
  assert.doesNotMatch(barrierSql, /update\s+supabase_migrations/i);
  assert.doesNotMatch(barrierSql, /delete\s+from\s+supabase_migrations/i);
});

test("describeDbPushWorkflow documents multi-pass + include-all preview", () => {
  const w = describeDbPushWorkflow();
  assert.equal(w.productionPasses.length, 3);
  assert.ok(w.productionPasses[0].applies.includes("20260723112910"));
  assert.ok(w.productionPasses[1].stopsAt.includes("112940") || w.productionPasses[1].stopsAt.includes("barrier"));
  assert.ok(w.previewOutOfOrder.includeAll);
  assert.ok(w.forbidden.some((f) => /repair 113000 before/i.test(f)));
});

test("formatProgressEvidence reports updated + residual delta fields", () => {
  const line = formatProgressEvidence({
    phase: "backfill_assets",
    batchIndex: 3,
    batchSize: 2000,
    rowsUpdated: 2000,
    residualBefore: 6000,
    residualAfter: 4000,
    residualAssets: 4000,
    elapsedMs: 1200,
  });
  assert.match(line, /phase=backfill_assets/);
  assert.match(line, /updated=2000/);
  assert.match(line, /residualBefore=6000/);
  assert.match(line, /residualAfter=4000/);
});

test("normalizeName trims and lowercases", () => {
  assert.equal(normalizeName("  Frozen "), "frozen");
  assert.equal(normalizeName(null), null);
});

test("main module source does not schedule DDL phases on apply path", () => {
  const src = readFileSync(join(__dirname, "dam-core-taxonomy-safe-cutover.mjs"), "utf8");
  // Apply path must not call removed DDL builders
  assert.doesNotMatch(src, /buildDropLegacyFksSql/);
  assert.doesNotMatch(src, /buildFinalizeSql/);
  // No executable trigger DDL (comments may mention the forbidden pattern).
  assert.doesNotMatch(src, /alter\s+table\s+public\.assets\s+(disable|enable)\s+trigger/i);
  assert.match(src, /session_replication_role\s*=\s*replica/);
  assert.match(src, /STATUS_DML_COMPLETE_SCHEMA_INCOMPLETE/);
  assert.match(src, /assertApplyPlanIsDmlOnly/);
  assert.match(src, /buildAdvisoryLockSql/);
  assert.match(src, /evaluateForwardProgress/);
  // Offline dry-run must not present illustrative operational counts as proof
  assert.match(src, /operationalCounts: null/);
  assert.match(src, /evidenceMode: "offline"/);
});
