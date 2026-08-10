/**
 * Offline tests for the Paramount Creative Library loader.
 * Connects to no database and reads no external file.
 * Run: node --test tools/sync-paramount-creative-library.test.mjs
 *
 * ALL FIXTURE DATA IS INVENTED. Not one Paramount title, property, character,
 * collection, brand, franchise, asset ID, filename or relationship row appears
 * here. The real capture is confidential and lives in the PRIVATE repo
 * u2giants/licensor-source-data; this repository is PUBLIC.
 *     SCHEMA IN GIT. DATA OUT OF GIT.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseCsv,
  csvToObjects,
  decodeUtf8Strict,
  hashIdSet,
  sha256,
  resolveTarget,
  chunk,
  buildBatchRows,
  buildPayloads,
  summarise,
  manifestExpectations,
  assertAssetIds,
  resolveRunConfig,
  LOAD_ORDER,
  MAX_BATCH_SIZE,
  MAX_CHUNK_ROWS,
} from "./sync-paramount-creative-library.mjs";

// Invented project refs. Both are 20 chars; neither is a real project.
const REF_A = "aaaabbbbccccddddeeee";
const REF_B = "zzzzyyyyxxxxwwwwvvvv";

// Invented 40-hex asset IDs.
const A1 = "a".repeat(40);
const A2 = "b".repeat(40);
const A3 = "c".repeat(40);

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------
test("parseCsv handles quotes, embedded commas and doubled quotes", () => {
  const rows = parseCsv('h1,h2\n1,"Fix, One"\n2,"Quote ""Q"""\n');
  assert.deepEqual(rows[1], ["1", "Fix, One"]);
  assert.deepEqual(rows[2], ["2", 'Quote "Q"']);
});

test("parseCsv strips a BOM so the first header is not corrupted", () => {
  assert.equal(parseCsv("﻿source_id,name\n1,X\n")[0][0], "source_id");
});

test("parseCsv handles a newline inside a quoted field", () => {
  const rows = parseCsv('a,b\n1,"Multi\nLine"\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], "Multi\nLine");
});

test("csvToObjects keys rows by header name", () => {
  const objs = csvToObjects("source_id,name\n11,Fixture Alpha\n");
  assert.deepEqual(objs, [{ source_id: "11", name: "Fixture Alpha" }]);
});

test("decodeUtf8Strict REFUSES invalid UTF-8 instead of silently substituting U+FFFD", () => {
  assert.throws(() => decodeUtf8Strict(Buffer.from([0xff, 0xfe, 0x41])), /not valid UTF-8/);
});

// ---------------------------------------------------------------------------
// Wrong-target safety. The single most expensive mistake this loader can make.
// ---------------------------------------------------------------------------
test("resolveTarget accepts a DATABASE_URL whose ref matches the expected ref", () => {
  assert.equal(
    resolveTarget({
      databaseUrl: `postgres://postgres.${REF_A}:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
      expectedRef: REF_A,
    }),
    REF_A
  );
});

test("POSITIVE: resolveTarget REFUSES when the URL points at a different project", () => {
  assert.throws(
    () =>
      resolveTarget({
        databaseUrl: `postgres://postgres.${REF_B}:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
        expectedRef: REF_A,
      }),
    /REFUSING TO CONNECT/
  );
});

test("resolveTarget REFUSES when the expected ref is not stated at all", () => {
  assert.throws(
    () => resolveTarget({ databaseUrl: `postgres://postgres.${REF_A}@h:6543/postgres`, expectedRef: "" }),
    /PMT_EXPECTED_PROJECT_REF is required/
  );
});

test("resolveTarget REFUSES a URL with no discoverable ref rather than connecting blind", () => {
  assert.throws(
    () => resolveTarget({ databaseUrl: "postgres://user:pw@localhost:5432/postgres", expectedRef: REF_A }),
    /Could not find a project ref/
  );
});

// ---------------------------------------------------------------------------
// Required inputs
// ---------------------------------------------------------------------------
const baseEnv = {
  PMT_SOURCE_DIR: "/tmp/fixture",
  PMT_PRIVATE_SOURCE_COMMIT: "f".repeat(40),
  PMT_SOURCE_URL: "https://portal.invalid",
  PMT_LIBRARY_NAME: "Fixture Library",
  PMT_CAPTURED_BY: "fixture-operator",
  PMT_PORTAL_GLOBAL_ASSET_COUNT: "1234",
};

test("resolveRunConfig accepts a complete environment", () => {
  const cfg = resolveRunConfig({ ...baseEnv });
  assert.equal(cfg.portalGlobalAssetCount, 1234);
  assert.equal(cfg.captureKind, "full");
});

test("POSITIVE: the loader REFUSES to start without portal_global_asset_count", () => {
  const env = { ...baseEnv };
  delete env.PMT_PORTAL_GLOBAL_ASSET_COUNT;
  assert.throws(() => resolveRunConfig(env), /PMT_PORTAL_GLOBAL_ASSET_COUNT is required/);
});

test("portal_global_asset_count must be a non-negative integer, not a guess", () => {
  assert.throws(
    () => resolveRunConfig({ ...baseEnv, PMT_PORTAL_GLOBAL_ASSET_COUNT: "about 46000" }),
    /non-negative integer/
  );
});

test("POSITIVE: a source URL carrying a query string is REFUSED as a possible signed URL", () => {
  assert.throws(
    () => resolveRunConfig({ ...baseEnv, PMT_SOURCE_URL: "https://portal.invalid/d?token=abc" }),
    /ORIGIN only/
  );
});

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------
test("chunk splits to the database's bound and never exceeds it", () => {
  const parts = chunk(new Array(12001).fill(0));
  assert.equal(parts.length, 3);
  assert.ok(parts.every((p) => p.length <= MAX_CHUNK_ROWS));
  assert.equal(parts.reduce((n, p) => n + p.length, 0), 12001);
});

test("chunk refuses a size the database would reject", () => {
  assert.throws(() => chunk([1], MAX_CHUNK_ROWS + 1), /between 1 and/);
});

// ---------------------------------------------------------------------------
// Asset ID shape. Errors must never quote the offending value.
// ---------------------------------------------------------------------------
test("assertAssetIds accepts lowercase 40-hex", () => {
  assert.doesNotThrow(() => assertAssetIds([A1, A2]));
});

test("POSITIVE: assertAssetIds rejects a bad ID and does NOT print the value", () => {
  try {
    assertAssetIds([A1, "NOT-A-HEX-ID"]);
    assert.fail("should have thrown");
  } catch (e) {
    assert.match(e.message, /1 asset ID\(s\)/);
    assert.ok(!e.message.includes("NOT-A-HEX-ID"), "the offending value must not be printed");
  }
});

// ---------------------------------------------------------------------------
// Batch ID-set reconstruction. The check must be FALSIFIABLE, not assumed.
// ---------------------------------------------------------------------------
test("hashIdSet is order-independent, so it hashes a SET and not a sequence", () => {
  assert.equal(hashIdSet([A1, A2]), hashIdSet([A2, A1]));
  assert.notEqual(hashIdSet([A1, A2]), hashIdSet([A1, A3]));
});

test("a batch whose returned set matches the reconstructed requested set is complete", () => {
  const rows = buildBatchRows(
    [{ batch_number: 1, batch_size: 2, status: 200, first_asset_id: A1, last_asset_id: A2,
       captured_at: "2026-01-01T00:00:00Z", records: [{ asset_id: A1 }, { asset_id: A2 }], failures: [] }],
    [A1, A2]
  );
  assert.equal(rows[0].complete, true);
  assert.equal(rows[0].id_sets_matched, true);
  assert.equal(rows[0].requested_ids_sha256, rows[0].returned_ids_sha256);
});

test("POSITIVE: a SUBSTITUTED asset is caught even though the COUNT is identical", () => {
  // This is the whole reason the check hashes sets rather than comparing counts.
  const rows = buildBatchRows(
    [{ batch_number: 1, batch_size: 2, status: 200, first_asset_id: A1, last_asset_id: A3,
       captured_at: "2026-01-01T00:00:00Z", records: [{ asset_id: A1 }, { asset_id: A3 }], failures: [] }],
    [A1, A2]
  );
  assert.equal(rows[0].returned_asset_count, rows[0].expected_asset_count, "counts are equal");
  assert.equal(rows[0].id_sets_matched, false, "but the SETS differ, so it must not pass");
  assert.equal(rows[0].complete, false);
  assert.match(rows[0].failure_message, /ID sets differ/);
});

test("a non-200 batch can never be complete", () => {
  const rows = buildBatchRows(
    [{ batch_number: 1, batch_size: 1, status: 500, first_asset_id: A1, last_asset_id: A1,
       captured_at: "2026-01-01T00:00:00Z", records: [{ asset_id: A1 }], failures: [] }],
    [A1]
  );
  assert.equal(rows[0].complete, false);
  assert.match(rows[0].failure_message, /http status 500/);
});

test("a batch larger than the proven 100 ceiling can never be complete", () => {
  const ids = Array.from({ length: MAX_BATCH_SIZE + 1 }, (_, i) => String(i).padStart(40, "0"));
  const rows = buildBatchRows(
    [{ batch_number: 1, batch_size: MAX_BATCH_SIZE + 1, status: 200, first_asset_id: ids[0],
       last_asset_id: ids[ids.length - 1], captured_at: "2026-01-01T00:00:00Z",
       records: ids.map((id) => ({ asset_id: id })), failures: [] }],
    ids
  );
  assert.equal(rows[0].complete, false);
  assert.match(rows[0].failure_message, /exceeds 100/);
});

test("a batch with recorded failures can never be complete", () => {
  const rows = buildBatchRows(
    [{ batch_number: 1, batch_size: 1, status: 200, first_asset_id: A1, last_asset_id: A1,
       captured_at: "2026-01-01T00:00:00Z", records: [{ asset_id: A1 }], failures: ["fixture failure"] }],
    [A1]
  );
  assert.equal(rows[0].complete, false);
  assert.match(rows[0].failure_message, /1 recorded failure/);
});

// ---------------------------------------------------------------------------
// Payload construction, on a wholly invented mini-capture.
// ---------------------------------------------------------------------------
const fixtureCapture = {
  manifest: {
    licensed_business_titles: 2,
    captured_properties: 1,
    property_result_rows: 2,
    unique_authorized_assets: 2,
    metadata_batches: 1,
    entities: { properties: 2, franchises: 1, characters: 1, style_guides: 1, brands: 1 },
    relationships: {
      asset_property: 2, asset_franchise: 1, asset_character: 1, asset_style_guide: 1,
      asset_brand: 1, property_character_explicit: 1, property_style_guide_explicit: 1,
      property_franchise_asset_cooccurrence: 1, authorized_property_context: 2,
    },
    malformed_explicit_pairs: 1,
  },
  manifestSha256: "0".repeat(64),
  authorizedAssetIds: [A1, A2],
  batches: [{ batch_number: 1, batch_size: 2, status: 200, first_asset_id: A1, last_asset_id: A2,
              captured_at: "2026-01-01T00:00:00Z", records: [{ asset_id: A1 }, { asset_id: A2 }], failures: [] }],
  assets: [
    { asset_id: A1, name: "Fixture Asset A", date_imported: "", date_last_updated: "",
      content_size: "10", content_type: "image", mime_type: "image/png", version: "1" },
    { asset_id: A2, name: "Fixture Asset B", date_imported: "", date_last_updated: "",
      content_size: "20", content_type: "image", mime_type: "image/png", version: "1" },
  ],
  properties: [{ source_id: "9001", name: "Fixture Property Alpha" },
               { source_id: "9002", name: "Fixture Property Beta" }],
  franchises: [{ source_id: "6001", name: "Fixture Franchise" }],
  characters: [{ source_id: "7001", name: "Fixture Character" }],
  collections: [{ source_id: "5001", name: "Fixture Collection", paramount_term: "Collection" }],
  brands: [{ source_id: "4001", name: "Fixture Brand" }],
  titleSummary: [
    { licensed_business_title: "FIXTURE TITLE ONE", capture_status: "captured",
      resolved_property_count: "1", unique_asset_count: "2", full_metadata_count: "2", notes: "" },
    { licensed_business_title: "FIXTURE TITLE TWO",
      capture_status: "licensed_but_not_present_in_current_portal_view",
      resolved_property_count: "0", unique_asset_count: "0", full_metadata_count: "0",
      notes: "absent from current portal view" },
  ],
  titleScope: [
    { licensed_business_title: "FIXTURE TITLE ONE", capture_status: "captured", property_id: "9001",
      paramount_property_name: "Fixture Property Alpha", reported_asset_count: "2", notes: "" },
    { licensed_business_title: "FIXTURE TITLE TWO",
      capture_status: "licensed_but_not_present_in_current_portal_view", property_id: "",
      paramount_property_name: "", reported_asset_count: "0", notes: "not present" },
  ],
  captureLog: [{ property_id: "9001", property_name: "Fixture Property Alpha",
                 reported_asset_count: "2", captured_asset_count: "2", page_count: "1",
                 complete: "true", failures: "0" }],
  anomalies: [{ asset_id: A1, relationship_field: "property_style_guide",
                raw_value: "fixture malformed value", action: "excluded_missing_second_source_id" }],
  linkAssetProperty: [{ asset_id: A1, property_id: "9001" }, { asset_id: A2, property_id: "9002" }],
  linkAssetFranchise: [{ asset_id: A1, franchise_id: "6001" }],
  linkAssetCharacter: [{ asset_id: A1, character_id: "7001" }],
  linkAssetCollection: [{ asset_id: A1, style_guide_id: "5001" }],
  linkAssetBrand: [{ asset_id: A1, brand_id: "4001" }],
  linkPropertyCharacter: [{ property_id: "9001", character_id: "7001", evidence_asset_count: "1" }],
  linkPropertyCollection: [{ property_id: "9001", collection_id: "5001", evidence_asset_count: "1" }],
  linkPropertyFranchise: [{ property_id: "9001", franchise_id: "6001", evidence_asset_count: "1" }],
  linkAuthorizedContext: [{ asset_id: A1, licensed_property_id: "9001" },
                          { asset_id: A2, licensed_property_id: "9001" }],
};

test("buildPayloads produces a row array for every load target", () => {
  const p = buildPayloads(fixtureCapture);
  for (const t of LOAD_ORDER) assert.ok(Array.isArray(p[t]), `${t} must be an array`);
});

test("is_licensed_selection is TRUE only for properties an exact Property search selected", () => {
  const p = buildPayloads(fixtureCapture);
  assert.equal(p.pmt_property.find((r) => r.property_source_id === 9001).is_licensed_selection, true);
  assert.equal(p.pmt_property.find((r) => r.property_source_id === 9002).is_licensed_selection, false);
});

test("POSITIVE: a portal-unavailable title is KEPT with zero counts, never filtered out", () => {
  const p = buildPayloads(fixtureCapture);
  const absent = p.pmt_authorized_title.find(
    (r) => r.capture_status === "licensed_but_not_present_in_current_portal_view"
  );
  assert.ok(absent, "the unavailable title must still be a row");
  assert.equal(absent.unique_asset_count, 0);
  assert.equal(absent.full_metadata_count, 0);
  // Both rights-list titles survive. A missing row would read as "not licensed".
  assert.equal(p.pmt_authorized_title.length, 2);
});

test("a title with no resolved property produces no title-property mapping row", () => {
  const p = buildPayloads(fixtureCapture);
  assert.equal(p.pmt_authorized_title_property.length, 1);
  assert.equal(p.pmt_authorized_title_property[0].property_source_id, 9001);
});

test("POSITIVE: the franchise payload NEVER carries a direct-relationship claim", () => {
  const p = buildPayloads(fixtureCapture);
  for (const row of p.pmt_property_franchise_evidence) {
    assert.ok(!("is_direct_source_relationship" in row),
      "the loader must not even offer to set this; the database pins it");
    assert.ok(!("evidence_kind" in row));
  }
});

test("the loader never emits a creative-content field", () => {
  const p = buildPayloads(fixtureCapture);
  const banned = /(^|_)(bytes|blob|content|preview|thumbnail|download|url|token|cookie|authorization)($|_)/i;
  // These three DESCRIBE the asset record; none of them carries creative content.
  const allowed = new Set(["content_type", "content_size_bytes", "content_was_json"]);
  for (const t of LOAD_ORDER) {
    for (const row of p[t]) {
      for (const key of Object.keys(row)) {
        if (allowed.has(key)) continue;
        assert.ok(!banned.test(key), `${t}.${key} looks like creative content or a credential`);
      }
    }
  }
});

test("summarise reports COUNTS only and leaks no row", () => {
  const s = summarise(buildPayloads(fixtureCapture));
  const text = JSON.stringify(s);
  assert.ok(!text.includes("Fixture Property Alpha"));
  assert.ok(!text.includes(A1));
  assert.equal(s.pmt_asset, 2);
  assert.equal(s.pmt_asset_property, 2);
});

test("manifestExpectations flattens every declared population the database checks", () => {
  const e = manifestExpectations(fixtureCapture.manifest);
  for (const k of [
    "licensed_business_titles", "unique_authorized_assets", "metadata_batches", "properties",
    "franchises", "characters", "style_guides", "brands", "asset_property", "asset_franchise",
    "asset_character", "asset_style_guide", "asset_brand", "property_character_explicit",
    "property_style_guide_explicit", "property_franchise_asset_cooccurrence",
    "authorized_property_context", "malformed_explicit_pairs", "captured_properties",
  ]) {
    assert.equal(typeof e[k], "number", `${k} must be a number`);
  }
});

test("every built payload count matches the manifest it will be validated against", () => {
  // The database refuses to finalize on any mismatch, so a divergence here is the loader's bug.
  const p = buildPayloads(fixtureCapture);
  const e = manifestExpectations(fixtureCapture.manifest);
  assert.equal(p.pmt_asset.length, e.unique_authorized_assets);
  assert.equal(p.pmt_property.length, e.properties);
  assert.equal(p.pmt_asset_property.length, e.asset_property);
  assert.equal(p.pmt_asset_character.length, e.asset_character);
  assert.equal(p.pmt_relationship_anomaly.length, e.malformed_explicit_pairs);
  assert.equal(p.pmt_authorized_property_asset.length, e.authorized_property_context);
  assert.equal(p.pmt_capture_batch.length, e.metadata_batches);
});

test("LOAD_ORDER puts every parent strictly before the links that reference it", () => {
  const at = (t) => LOAD_ORDER.indexOf(t);
  for (const link of ["pmt_asset_property", "pmt_asset_character", "pmt_asset_collection",
                      "pmt_asset_brand", "pmt_asset_franchise", "pmt_authorized_property_asset",
                      "pmt_relationship_anomaly"]) {
    assert.ok(at("pmt_asset") < at(link), `pmt_asset must load before ${link}`);
  }
  assert.ok(at("pmt_property") < at("pmt_asset_property"));
  assert.ok(at("pmt_character") < at("pmt_asset_character"));
  assert.ok(at("pmt_collection") < at("pmt_asset_collection"));
  assert.ok(at("pmt_brand") < at("pmt_asset_brand"));
  assert.ok(at("pmt_franchise") < at("pmt_asset_franchise"));
  assert.ok(at("pmt_authorized_title") < at("pmt_authorized_title_property"));
  assert.ok(at("pmt_property") < at("pmt_property_capture_log"));
});

test("sha256 is stable, so the manifest hash gate is deterministic", () => {
  assert.equal(sha256(Buffer.from("fixture")), sha256(Buffer.from("fixture")));
  assert.notEqual(sha256(Buffer.from("fixture")), sha256(Buffer.from("fixture2")));
});

// ---------------------------------------------------------------------------
// The confidentiality boundary, asserted against this file and the migration.
// ---------------------------------------------------------------------------
test("POSITIVE: the migration is SCHEMA ONLY and seeds no source row", async () => {
  // The single check that would have caught the mistake this whole boundary exists to
  // prevent: a well-meaning seed migration materialising confidential rows into public
  // git history, permanently. Rows must arrive at runtime through the loader, never here.
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const sql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations",
      "20260810020000_pmt_creative_library_landing.sql"),
    "utf8"
  );

  // Strip every function/DO body first. Inserts INSIDE the loader functions are the
  // runtime path and are expected; what must not exist is a top-level seed statement.
  const topLevel = sql.replace(/\$\$[\s\S]*?\$\$/g, "\n-- [function body omitted]\n");
  const seeds = [...topLevel.matchAll(/insert\s+into\s+plm\.pmt_/gi)];
  assert.equal(seeds.length, 0, "the migration must not seed any plm.pmt_* row at the top level");

  // No 40-hex asset ID and no 64-hex hash literal outside a regex or a repeat() call.
  const stripped = sql.replace(/\^\[0-9a-f\]\{\d+\}\$/g, "");
  assert.equal((stripped.match(/\b[0-9a-f]{40}\b/g) ?? []).length, 0,
    "a 40-hex literal in the migration would be a real asset ID");
});

// ---------------------------------------------------------------------------
// The inert-guarantee bug. plm carries
//     alter default privileges ... grant all on tables to service_role
// so EVERY table created in that schema is handed TRUNCATE automatically at
// CREATE TABLE time, before any GRANT in the migration runs. TRUNCATE does not
// fire row triggers, so the completed-capture immutability triggers do not stop
// it. Read from the preview catalog, service_role held TRUNCATE on all 23 tables
// while every UPDATE and DELETE test passed. The follow-up migration revokes it.
// ---------------------------------------------------------------------------
test("POSITIVE: the follow-up migration revokes TRUNCATE on every one of the 23 tables", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const sql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations",
      "20260810090000_pmt_loader_target_guard_and_truncate_revoke.sql"),
    "utf8"
  );

  assert.match(sql, /revoke truncate, trigger on plm\.%I from service_role/,
    "TRUNCATE must be revoked; a row trigger cannot stop it");

  // The revoke loop must name all 23 tables, or the ones it misses stay wipeable.
  const tables = [
    "pmt_capture", "pmt_capture_expectation", "pmt_capture_batch", "pmt_authorized_title",
    "pmt_authorized_title_property", "pmt_property", "pmt_franchise", "pmt_character",
    "pmt_collection", "pmt_brand", "pmt_asset", "pmt_asset_property", "pmt_asset_franchise",
    "pmt_asset_character", "pmt_asset_collection", "pmt_asset_brand",
    "pmt_property_character", "pmt_property_collection", "pmt_property_franchise_evidence",
    "pmt_authorized_property_asset", "pmt_relationship_anomaly", "pmt_property_capture_log",
    "pmt_shrink_override",
  ];
  assert.equal(tables.length, 23);
  // The whole first do-block, so a long table list cannot fall outside the window.
  const revokeBlock = sql.slice(sql.indexOf("do $$"), sql.indexOf("$$;") + 3);
  for (const t of tables) {
    assert.ok(revokeBlock.includes(`'${t}'`), `${t} is missing from the revoke loop`);
  }

  // It must NOT reach beyond this claim: no other schema, no other prefix, and not the
  // schema-level default privileges, which the orchestrator is sequencing separately.
  // Executable statements only. The header comment explains the schema-level default
  // privilege on purpose; what matters is that the migration does not CHANGE it.
  const executable = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/alter\s+default\s+privileges/i.test(executable),
    "the schema-level default privilege fix is not this migration's to make");
  assert.ok(!/plm\.erp_|plm\.opa_/.test(executable), "must not touch another workstream's tables");
});

test("POSITIVE: the follow-up migration checks the target BEFORE the empty-chunk shortcut", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const sql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations",
      "20260810090000_pmt_loader_target_guard_and_truncate_revoke.sql"),
    "utf8"
  );
  const guardAt = sql.indexOf("not (p_target = any (c_targets))");
  const emptyReturnAt = sql.indexOf("if v_n = 0 then");
  assert.ok(guardAt > 0, "the allow-list guard must exist");
  assert.ok(emptyReturnAt > 0, "the empty-chunk shortcut must exist");
  assert.ok(guardAt < emptyReturnAt,
    "the target guard must come FIRST, or a typo'd target with an empty chunk reads as success");
});

test("no RAISE statement uses %L, which is a format() specifier and prints a stray L", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const sql = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations",
      "20260810090000_pmt_loader_target_guard_and_truncate_revoke.sql"),
    "utf8"
  );
  // Only the executable RAISE statements matter; the header comments discuss %L on purpose.
  const raiseLines = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .match(/raise\s+exception[\s\S]*?using errcode/gi) ?? [];
  assert.ok(raiseLines.length > 0, "there should be RAISE statements to check");
  for (const r of raiseLines) {
    assert.ok(!r.includes("%L"), `a RAISE still uses %L: ${r.slice(0, 80)}`);
  }
});
