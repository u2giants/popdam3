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
  exactSourceId,
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
    asset_metadata_values: 4,
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
  // SYNTHETIC ONLY. Four values, chosen to exercise the four things the shape must survive:
  //   ordinals 0/1/2 under ONE element  -> repetition with order
  //   ordinal 1 and ordinal 2 share the display text "Fixture Shared Label" under DIFFERENT
  //     elements                        -> equal display values must NOT merge
  //   FUTURE_UNKNOWN_ELEMENT            -> an element nobody has modelled still loads
  assetMetadataValues: [
    { asset_id: A1, metadata_element_id: "FIXTURE_ELEMENT_A", value_ordinal: 0,
      data_type: "string", source_value: "fx-a-0", display_value: "Fixture Label Zero" },
    { asset_id: A1, metadata_element_id: "FIXTURE_ELEMENT_A", value_ordinal: 1,
      data_type: "string", source_value: "fx-a-1", display_value: "Fixture Shared Label" },
    { asset_id: A1, metadata_element_id: "FIXTURE_ELEMENT_A", value_ordinal: 2,
      data_type: "string", source_value: "fx-a-2", display_value: "Fixture Label Two" },
    { asset_id: A2, metadata_element_id: "FUTURE_UNKNOWN_ELEMENT", value_ordinal: 0,
      data_type: "number", source_value: "12345", display_value: "Fixture Shared Label" },
  ],
};

test("buildPayloads produces a row array for every load target", () => {
  const p = buildPayloads(fixtureCapture);
  for (const t of LOAD_ORDER) assert.ok(Array.isArray(p[t]), `${t} must be an array`);
});

test("is_licensed_selection is TRUE only for properties an exact Property search selected", () => {
  const p = buildPayloads(fixtureCapture);
  // NOTE === "9001", a STRING. Source IDs are identities and are no longer numbers.
  assert.equal(p.pmt_property.find((r) => r.property_source_id === "9001").is_licensed_selection, true);
  assert.equal(p.pmt_property.find((r) => r.property_source_id === "9002").is_licensed_selection, false);
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
  assert.equal(p.pmt_authorized_title_property[0].property_source_id, "9001");
});

// ---------------------------------------------------------------------------
// The duplicated property-name copies (issue #964, plan_pmt-duplicate-name-columns.md).
// plm.pmt_property.property_name is the single place a property name is written.
// pmt_authorized_title_property.paramount_property_name and
// pmt_property_capture_log.property_name were deprecated by migration 20260814193351;
// this loader must stop forwarding BOTH, while the source files may still carry them.
// ---------------------------------------------------------------------------
test("the loader forwards NEITHER duplicated property-name copy", () => {
  const p = buildPayloads(fixtureCapture);
  for (const row of p.pmt_authorized_title_property) {
    assert.ok(!("paramount_property_name" in row),
      "pmt_authorized_title_property must not carry paramount_property_name");
    assert.ok(!("property_name" in row),
      "pmt_authorized_title_property must not carry property_name either");
  }
  for (const row of p.pmt_property_capture_log) {
    assert.ok(!("property_name" in row),
      "pmt_property_capture_log must not carry property_name");
  }
});

test("the omission is the loader's, not the fixture's -- the source fields still exist", () => {
  // If these ever stop holding, the tests above would pass vacuously: nothing would be
  // dropped because nothing was there to drop. The capture CSVs may legitimately keep
  // carrying these columns; the loader simply must not forward them.
  assert.equal(typeof fixtureCapture.titleScope[0].paramount_property_name, "string");
  assert.notEqual(fixtureCapture.titleScope[0].paramount_property_name, "");
  assert.equal(typeof fixtureCapture.captureLog[0].property_name, "string");
  assert.notEqual(fixtureCapture.captureLog[0].property_name, "");
});

test("the database boundary receives no name key: the serialized chunks omit both columns", () => {
  // This is the exact wire format plm.load_pmt_capture_chunk receives. An absent key
  // serializes to nothing, so the DB-side r->>'...' reads NULL -- legal only after
  // migration 20260814193351 dropped the NOT NULL. If either key reappears here, a
  // capture run against a post-drop database is one migration away from failing.
  const p = buildPayloads(fixtureCapture);
  const atpJson = JSON.stringify(p.pmt_authorized_title_property);
  const logJson = JSON.stringify(p.pmt_property_capture_log);
  assert.ok(!atpJson.includes("paramount_property_name"));
  assert.ok(!atpJson.includes("property_name"));
  assert.ok(!logJson.includes("property_name"));
});

test("the entity payload remains the SINGLE place the property name is written", () => {
  const p = buildPayloads(fixtureCapture);
  const entity = p.pmt_property.find((r) => r.property_source_id === "9001");
  assert.equal(entity.property_name, "Fixture Property Alpha");
  // No other target's rows may carry a property-name KEY, or the name's VALUE.
  for (const t of LOAD_ORDER) {
    if (t === "pmt_property") continue;
    for (const row of p[t]) {
      for (const k of Object.keys(row)) {
        assert.ok(!(k === "property_name" || k.endsWith("_property_name")),
          `${t}.${k} reintroduced a property-name copy`);
      }
      assert.ok(!Object.values(row).includes("Fixture Property Alpha"),
        `${t} leaked the property-name value`);
    }
  }
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
    "asset_metadata_values",
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
  assert.equal(p.pmt_asset_metadata_value.length, e.asset_metadata_values);
});

test("LOAD_ORDER puts every parent strictly before the links that reference it", () => {
  const at = (t) => LOAD_ORDER.indexOf(t);
  for (const link of ["pmt_asset_property", "pmt_asset_character", "pmt_asset_collection",
                      "pmt_asset_brand", "pmt_asset_franchise", "pmt_authorized_property_asset",
                      "pmt_relationship_anomaly", "pmt_asset_metadata_value"]) {
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

// ---------------------------------------------------------------------------
// EXACT SOURCE IDENTITIES (spec section 9, cases 1-5).
//
// Every ID below is SYNTHETIC. No real Paramount value appears in this public repository.
//
// These tests exist because the old bug was SILENT. num('007') returned 7 and
// num('9007199254740993') returned 9007199254740992, neither raised anything, and the wrong
// row looked exactly like a right one. So each case asserts the exact string identity, not
// merely that "it worked".
// ---------------------------------------------------------------------------
test("LEADING ZEROES survive: '007' stays '007' and never becomes 7", () => {
  assert.equal(exactSourceId("007", "fixture.field"), "007");
  // The precise failure being guarded: Number('007') === 7, so '007' and '7' would collapse
  // into one row and one of the two identities would be gone with no error anywhere.
  assert.notEqual(exactSourceId("007", "fixture.field"), String(Number("007")));
  assert.notEqual(exactSourceId("007", "fixture.field"), exactSourceId("7", "fixture.field"));
});

test("BEYOND 2^53 survives exactly: a 16-digit ID is not rounded", () => {
  const big = "9007199254740993"; // Number.MAX_SAFE_INTEGER + 2, synthetic
  assert.equal(exactSourceId(big, "fixture.field"), big);
  // Proof the hazard is real and that this validator avoids it.
  assert.equal(String(Number(big)), "9007199254740992");
  assert.notEqual(exactSourceId(big, "fixture.field"), String(Number(big)));
});

test("an EMPTY source ID is rejected, never loaded as an absent identity", () => {
  assert.throws(() => exactSourceId("", "fixture.field"), /empty/i);
});

test("a NON-STRING source ID is rejected BEFORE loading", () => {
  // A number arriving here has already lost its leading zeroes and its precision, so it is
  // refused rather than accepted and stringified -- stringifying would launder the damage.
  assert.throws(() => exactSourceId(9001, "fixture.field"), /must be a string/i);
  assert.throws(() => exactSourceId(null, "fixture.field"), /must be a string/i);
  assert.throws(() => exactSourceId(undefined, "fixture.field"), /must be a string/i);
});

test("an ID outside the proven format is REFUSED, not guessed at", () => {
  assert.throws(() => exactSourceId("90a1", "fixture.field"), /proven source format/i);
  assert.throws(() => exactSourceId("90 01", "fixture.field"), /proven source format/i);
});

test("the source-ID error names the FIELD and never the row value", () => {
  try {
    exactSourceId("not-an-id", "pmt_asset_property.property_source_id");
    assert.fail("must throw");
  } catch (e) {
    assert.match(e.message, /pmt_asset_property\.property_source_id/);
    assert.ok(!e.message.includes("not-an-id"),
      "a public-repo error must never echo a source value back into CI logs");
  }
});

test("every source ID the loader emits is a STRING, never a number", () => {
  const p = buildPayloads(fixtureCapture);
  for (const t of LOAD_ORDER) {
    for (const row of p[t]) {
      for (const [k, v] of Object.entries(row)) {
        if (!k.endsWith("_source_id")) continue;
        assert.equal(typeof v, "string", `${t}.${k} must stay text, got ${typeof v}`);
      }
    }
  }
});

test("asset IDs still require 40 lowercase hex characters", () => {
  assert.throws(() => assertAssetIds(["ABCDEF"]));
  assert.throws(() => assertAssetIds(["A".repeat(40)]), /hex|40/i);
});

// ---------------------------------------------------------------------------
// LOSSLESS REPEATED METADATA (spec section 9, cases 6-10).
// ---------------------------------------------------------------------------
test("REPEATED values keep their source ORDER, taken from the row and not the array index", () => {
  const p = buildPayloads(fixtureCapture);
  const a = p.pmt_asset_metadata_value.filter((r) => r.metadata_element_id === "FIXTURE_ELEMENT_A");
  assert.equal(a.length, 3, "three values under one element must be three rows, not one");
  assert.deepEqual(a.map((r) => r.value_ordinal), [0, 1, 2]);
  assert.deepEqual(a.map((r) => r.source_value), ["fx-a-0", "fx-a-1", "fx-a-2"]);
});

test("EQUAL display values under DIFFERENT elements do NOT merge", () => {
  const p = buildPayloads(fixtureCapture);
  const shared = p.pmt_asset_metadata_value.filter((r) => r.display_value === "Fixture Shared Label");
  assert.equal(shared.length, 2, "identical display text is not identity; both rows must survive");
  assert.notEqual(shared[0].metadata_element_id, shared[1].metadata_element_id);
});

test("an UNKNOWN FUTURE metadata element loads with no schema change", () => {
  const p = buildPayloads(fixtureCapture);
  const future = p.pmt_asset_metadata_value.find(
    (r) => r.metadata_element_id === "FUTURE_UNKNOWN_ELEMENT"
  );
  assert.ok(future, "an element nobody modelled must still land");
  assert.equal(future.source_value, "12345");
  assert.equal(typeof future.source_value, "string",
    "a source-emitted JSON number is kept as TEXT; data_type records what it was");
  assert.equal(future.data_type, "number");
});

test("a MISSING metadata field becomes null and never the string 'undefined'", () => {
  const p = buildPayloads(fixtureCapture);
  for (const row of p.pmt_asset_metadata_value) {
    for (const [k, v] of Object.entries(row)) {
      assert.notEqual(v, "undefined", `${k} turned an absent value into the WORD undefined`);
      assert.notEqual(v, undefined, `${k} must be an explicit null, not undefined`);
    }
    assert.equal(row.language, null);
    assert.equal(row.metadata_category_id, null);
  }
});

test("a metadata row without a builder-supplied ordinal is REFUSED", () => {
  const bad = { ...fixtureCapture, assetMetadataValues: [
    { asset_id: A1, metadata_element_id: "FIXTURE_ELEMENT_A", source_value: "x" },
  ]};
  assert.throws(() => buildPayloads(bad), /value_ordinal/);
});

test("a metadata row with no element id, or a bad asset id, is REFUSED", () => {
  assert.throws(() => buildPayloads({ ...fixtureCapture, assetMetadataValues: [
    { asset_id: A1, metadata_element_id: "", value_ordinal: 0, source_value: "x" }] }),
    /metadata_element_id/);
  assert.throws(() => buildPayloads({ ...fixtureCapture, assetMetadataValues: [
    { asset_id: "NOT-A-HEX-ID", metadata_element_id: "E", value_ordinal: 0, source_value: "x" }] }),
    /asset_id/);
});

test("summarise still reports COUNTS only for the metadata population", () => {
  const s = summarise(buildPayloads(fixtureCapture));
  assert.equal(s.pmt_asset_metadata_value, 4);
  const text = JSON.stringify(s);
  assert.ok(!text.includes("Fixture Shared Label"), "summaries must never carry a value");
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

// ---------------------------------------------------------------------------
// Issue #964, plan_pmt-duplicate-name-columns.md -- the deprecation migration itself
// (20260814193351). These pin, OFFLINE, the invariants the database contract test
// supabase/tests/pmt_no_duplicate_property_name_contracts.sql pins against a live
// catalog: both writers stopped, guard before relax, index gone, posture intact, and
// NOTHING destructive in the staged file.
// ---------------------------------------------------------------------------
async function readDeprecationMigration() {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  return readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations",
      "20260814193351_pmt_duplicate_name_columns_deprecated.sql"),
    "utf8"
  ).replace(/\r\n/g, "\n");
}

async function readDuplicateNameContract() {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  return readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "tests",
      "pmt_no_duplicate_property_name_contracts.sql"),
    "utf8"
  ).replace(/\r\n/g, "\n");
}

test("the duplicate-name contract exposes the VALUES aliases its loop reads", async () => {
  const sql = await readDuplicateNameContract();
  assert.match(sql, /select table_name, column_name from \(values[\s\S]*?\) as v\(table_name, column_name\)/,
    "section A must alias VALUES as table_name/column_name for r.table_name/r.column_name");
  assert.doesNotMatch(sql, /\) as v\(tbl, col\)/,
    "the old aliases make SELECT table_name,column_name fail before assertions run");
});

test("the deprecation migration replaces the loader WITHOUT the two duplicate-name writes", async () => {
  const sql = await readDeprecationMigration();
  const starts = sql.match(/create or replace function plm\.load_pmt_capture_chunk\(/g) ?? [];
  assert.equal(starts.length, 1, "exactly one whole-function replacement");
  const start = sql.indexOf("create or replace function plm.load_pmt_capture_chunk(");
  const body = sql.slice(start, sql.indexOf("\n$$;", start));
  const normBody = body.replace(/\s+/g, " ");

  assert.ok(!body.includes("paramount_property_name"),
    "the function body must not write the rights-list copy");
  assert.ok(!normBody.includes("property_name, reported_asset_count"),
    "the old capture-log INSERT shape must be gone");
  assert.ok(normBody.includes("property_name, is_licensed_selection"),
    "the entity branch keeps its legitimate property_name write");
  assert.ok(body.includes("security definer"), "SECURITY DEFINER preserved");
  assert.ok(body.includes("set search_path = plm, core, public, extensions"),
    "pinned search_path preserved");
  assert.ok(body.includes("not (p_target = any (c_targets))"), "allow-list guard preserved");

  // The security-definer posture is re-pinned AFTER the replacement, as in every
  // prior replacement of this function.
  assert.match(sql, /revoke all on function plm\.load_pmt_capture_chunk\(uuid, text, jsonb\) from public;/);
  assert.match(sql, /revoke all on function plm\.load_pmt_capture_chunk\(uuid, text, jsonb\) from anon, authenticated;/);
  assert.match(sql, /grant execute on function plm\.load_pmt_capture_chunk\(uuid, text, jsonb\) to service_role;/);
});

test("the deprecation migration relaxes BOTH columns behind the drift guard, and drops the index", async () => {
  const sql = await readDeprecationMigration();
  assert.match(sql, /alter table plm\.pmt_authorized_title_property alter column paramount_property_name drop not null;/);
  assert.match(sql, /alter table plm\.pmt_property_capture_log alter column property_name drop not null;/);

  // The refusal guard runs BEFORE either relax, and raises on drift or orphans.
  const driftAt = sql.indexOf("v_atp_mismatch > 0 or v_log_mismatch > 0");
  const orphanAt = sql.indexOf("v_orphans > 0");
  const relaxAt = sql.indexOf("drop not null");
  assert.ok(driftAt > 0, "drift refusal present");
  assert.ok(orphanAt > 0, "orphan refusal present");
  assert.ok(relaxAt > driftAt && relaxAt > orphanAt,
    "the guard must run before the NOT NULL relax");

  assert.match(sql, /drop index plm\.idx_pmt_atp_name;/);
});

test("the deprecation migration is STAGED: schema-only, and carries no column drop", async () => {
  const sql = await readDeprecationMigration();
  // Strip every function/DO body first: inserts INSIDE the loader are the runtime path.
  const topLevel = sql.replace(/\$\$[\s\S]*?\$\$/g, "\n-- [body omitted]\n");
  const seeds = [...topLevel.matchAll(/insert\s+into\s+plm\.pmt_/gi)];
  assert.equal(seeds.length, 0, "the migration must not seed any plm.pmt_* row at the top level");
  assert.ok(!/\bdrop\s+column\b/i.test(topLevel),
    "plan Step 6's column drops are deliberately NOT in this staged migration");
  assert.ok(!/\brename\s+column\b/i.test(topLevel),
    "no rename either: Step 1 (duplicate vs distinct fact) is still open");
});
