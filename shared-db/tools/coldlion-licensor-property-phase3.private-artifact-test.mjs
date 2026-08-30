/**
 * Phase 3 ColdLion licensor/property reconciliation — deterministic local validation.
 *
 * No database, no credentials, no network. Reads the frozen Phase 2B evidence CSVs and the
 * generated Phase 3 artifacts and proves:
 *   - 100% ledger coverage (every Phase 2 source + canonical row appears exactly once);
 *   - mapping-hash stability (recorded hashes equal content-derived hashes);
 *   - zero cross-entity matches (FK licensor never linked; FR property never tied to FRIENDS TV);
 *   - a named human owner for every one of the 28 non-automatic (pending) decisions;
 *   - the named-case dispositions (NASA, ZAG, FRIDA KAHLO, FRIENDS TV, ColdLion-only, canonical-only);
 *   - the frozen approved-mapping input is EMPTY and Phase 4 is BLOCKED.
 *
 * Run: node --test tools/coldlion-licensor-property-phase3.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { test } from "node:test";
// Pure helpers from the read-only snapshot tool (importing does NOT trigger a fetch — main() is
// guarded to direct invocation only). Used for offline title-mapping + blank-title coverage.
import { pickTitle, hashEdges, summarizePayload } from "./coldlion-licensor-property-phase3-designflow-snapshot.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const P2 = join(root, "docs/verification/coldlion-licensor-property-phase2b-20260724");
const P3 = join(root, "docs/verification/coldlion-licensor-property-phase3-20260725");

function md5(s) {
  return createHash("md5").update(s, "utf8").digest("hex");
}

function parseCsv(text) {
  const rows = [];
  let field = "";
  let row = [];
  let inQ = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const header = rows[0];
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => {
      const o = {};
      header.forEach((h, i) => {
        o[h] = r[i] ?? "";
      });
      return o;
    });
}

function readCsv(dir, name) {
  return parseCsv(readFileSync(join(dir, name), "utf8"));
}
function readJson(dir, name) {
  return JSON.parse(readFileSync(join(dir, name), "utf8"));
}

// Identity key: source rows by composite natural key, canonical-only by canonical UUID.
function identityKey(r) {
  if (r.row_scope === "canonical_only") {
    return `canonical_only|${r.entity_type}|${r.canonical_id || r.candidate_canonical_id}`;
  }
  return `coldlion_source|${r.entity_type}|${r.company_code}/${r.division_code}/${r.mg_type_code}/${r.mg_code}`;
}

// Documented encoding used by the generator for mapping hashes.
function encodeMappings(rows) {
  return rows
    .slice()
    .sort((a, b) => (a.composite_key < b.composite_key ? -1 : a.composite_key > b.composite_key ? 1 : 0))
    .map((r) => `${r.entity_type}|${r.composite_key}|${r.canonical_id}`)
    .join("\n");
}

const licP2 = readCsv(P2, "licensors.csv");
const propP2 = readCsv(P2, "properties.csv");
const licLedger = readCsv(P3, "ruling-ledger-licensors.csv");
const propLedger = readCsv(P3, "ruling-ledger-properties.csv");
const dispositions = readCsv(P3, "dispositions.csv");
const proposed = readCsv(P3, "phase4-proposed-auto-mapping.csv");
const pendingLink = readCsv(P3, "phase4-pending-link-mapping.csv");
const coverage = readJson(P3, "coverage-summary.json");
const phase4 = readJson(P3, "phase4-approved-mapping.json");
const parentCmp = readJson(P3, "parent-comparison.json");

test("Phase 2 evidence and Phase 3 artifacts exist", () => {
  for (const f of ["licensors.csv", "properties.csv", "parent_edges.csv", "review-findings.csv"]) {
    assert.ok(existsSync(join(P2, f)), `Phase 2 missing ${f}`);
  }
  for (const f of [
    "ruling-ledger-licensors.csv", "ruling-ledger-properties.csv", "dispositions.csv",
    "phase4-approved-mapping.json", "phase4-proposed-auto-mapping.csv",
    "phase4-pending-link-mapping.csv", "coverage-summary.json", "parent-comparison.json",
  ]) {
    assert.ok(existsSync(join(P3, f)), `Phase 3 missing ${f}`);
  }
});

test("100% ledger coverage — every Phase 2 source + canonical row appears exactly once", () => {
  const toKey = (r) =>
    identityKey({
      row_scope: r.row_scope,
      entity_type: r.entity_type,
      company_code: r.company_code,
      division_code: r.division_code,
      mg_type_code: r.mg_type_code,
      mg_code: r.mg_code,
      canonical_id: r.canonical_id || r.candidate_canonical_id,
    });

  for (const [p2rows, ledger, label] of [
    [licP2, licLedger, "licensor"],
    [propP2, propLedger, "property"],
  ]) {
    const p2Keys = p2rows.map(toKey).sort();
    const ledKeys = ledger.map(toKey).sort();
    assert.equal(ledger.length, p2rows.length, `${label} ledger row count mismatch`);
    assert.deepEqual(ledKeys, p2Keys, `${label} ledger is missing or has extra rows vs Phase 2`);
  }

  // distinct canonical UUIDs represented (matched via source + canonical-only) must be 26 / 256
  const distinctCanon = (rows) =>
    new Set(rows.map((r) => r.candidate_canonical_id || r.canonical_id).filter(Boolean)).size;
  assert.equal(distinctCanon(licLedger), 26, "expected 26 distinct canonical licensor UUIDs");
  assert.equal(distinctCanon(propLedger), 256, "expected 256 distinct canonical property UUIDs");
});

test("ledger totals reconcile", () => {
  const total = licLedger.length + propLedger.length;
  assert.equal(total, 570, "expected 570 ledger rows");
  assert.equal(coverage.ledger_rows, 570);
  assert.equal(coverage.source_rows, 560);
  assert.equal(coverage.canonical_only_rows, 10);
  assert.equal(coverage.coverage_pct, 100);
  assert.equal(coverage.category_counts["exact compatible code match"], 542);
  assert.equal(coverage.category_counts["exact normalized-name match"], 2);
  assert.equal(coverage.category_counts["ColdLion-only candidate"], 14);
  assert.equal(coverage.category_counts["canonical-only curated/legacy record"], 10);
  assert.equal(coverage.category_counts["entity-type collision"], 2);
});

test("mapping hash stability — recorded hashes equal content-derived hashes", () => {
  const all = [...licLedger, ...propLedger];
  const composite = (r) => `${r.company_code}/${r.division_code}/${r.mg_type_code}/${r.mg_code}`;

  // re-derive the proposed/pending sets FROM THE LEDGER, independent of the CSV the generator wrote
  const proposedFromLedger = all
    .filter((r) => r.disposition === "auto_link_eligible")
    .map((r) => ({
      entity_type: r.entity_type,
      composite_key: composite(r),
      canonical_id: r.candidate_canonical_id,
    }));
  const pendingFromLedger = all
    .filter((r) => r.disposition === "nasa_name_only_pending")
    .map((r) => ({
      entity_type: r.entity_type,
      composite_key: composite(r),
      canonical_id: r.candidate_canonical_id,
    }));

  assert.equal(proposedFromLedger.length, 542);
  assert.equal(pendingFromLedger.length, 2);

  const proposedHash = md5(encodeMappings(proposedFromLedger));
  const pendingHash = md5(encodeMappings(pendingFromLedger));
  const approvedHash = md5(encodeMappings([])); // empty set

  assert.equal(proposedHash, "1230f5a12d0f2a3029f1d3df17fc5b5f", "proposed auto hash must be stable");
  assert.equal(pendingHash, "2edf77b7ddd8d0405f93d020003b9540", "pending (NASA) hash must be stable");
  assert.equal(approvedHash, "d41d8cd98f00b204e9800998ecf8427e", "approved (empty) hash must be md5('')");

  // recorded values agree with the JSON artifacts
  assert.equal(phase4.proposed_auto_mappings.hash, proposedHash);
  assert.equal(phase4.pending_link_mappings.hash, pendingHash);
  assert.equal(phase4.approved_mapping_hash, approvedHash);
  assert.equal(coverage.phase4.proposed_auto_hash, proposedHash);
  assert.equal(coverage.phase4.pending_link_hash, pendingHash);
  assert.equal(coverage.phase4.approved_mapping_hash, approvedHash);

  // cross-check: the mapping CSVs the generator wrote hash to the same values
  const csvToMappings = (rows) =>
    rows.map((r) => ({
      entity_type: r.entity_type,
      composite_key: r.composite_key,
      canonical_id: r.canonical_id,
    }));
  assert.equal(md5(encodeMappings(csvToMappings(proposed))), proposedHash, "proposed CSV must match its hash");
  assert.equal(md5(encodeMappings(csvToMappings(pendingLink))), pendingHash, "pending CSV must match its hash");
});

test("frozen approved-mapping input is empty and Phase 4 is BLOCKED", () => {
  assert.deepEqual(phase4.approved_mappings, []);
  assert.equal(phase4.approved_by, null);
  assert.equal(phase4.approved_at_utc, null);
  assert.equal(phase4.phase4_ruling, "BLOCKED");
  assert.equal(coverage.phase4_readiness.ruling, "BLOCKED");
  assert.equal(coverage.phase4.approved_count, 0);
});

test("zero cross-entity matches — FK licensor never linked, FR property never tied to FRIENDS TV", () => {
  const FRIENDS_TV_LICENSOR = "2b2caddf-4fb0-4fc3-8245-ccd8f8177e48"; // canonical licensor FR
  // FK licensor rows must be quarantined with NO canonical candidate
  const fkLic = licLedger.filter((r) => r.mg_code === "FK" && r.mg_type_code === "05");
  assert.equal(fkLic.length, 2, "expected 2 FK licensor rows (CW001+SP001)");
  for (const r of fkLic) {
    assert.equal(r.disposition, "frida_kahlo_cross_entity_quarantine");
    assert.equal(r.candidate_canonical_id, "", "FK licensor must not carry a canonical candidate");
  }
  // FR property rows must link to the PROPERTY UUID (1ST ORDER TROOPER), never the FRIENDS TV licensor
  const frProp = propLedger.filter((r) => r.mg_code === "FR" && r.mg_type_code === "06");
  assert.equal(frProp.length, 2);
  for (const r of frProp) {
    assert.equal(r.disposition, "auto_link_eligible");
    assert.notEqual(
      r.candidate_canonical_id,
      FRIENDS_TV_LICENSOR,
      "FR property must not cross-link to FRIENDS TV licensor",
    );
    assert.ok(r.candidate_canonical_id, "FR property must have its own canonical property candidate");
  }
  // FRIENDS TV licensor is canonical-only and never linked
  const friendsTv = licLedger.find((r) => r.canonical_code === "FR" && r.row_scope === "canonical_only");
  assert.ok(friendsTv, "FRIENDS TV canonical-only row present");
  assert.equal(friendsTv.disposition, "friends_tv_curated_only");
  assert.equal(coverage.cross_entity_matches, 0);
});

test("named human owner for every non-automatic (pending) decision", () => {
  assert.equal(dispositions.length, 28, "expected 28 non-automatic rows");
  for (const r of dispositions) {
    assert.equal(r.decision_status, "pending_human");
    assert.ok(r.named_owner && r.named_owner.trim(), `row ${r.mg_code || r.canonical_code} missing named_owner`);
    assert.ok((r.rationale || "").length > 0, `row ${r.mg_code || r.canonical_code} missing rationale`);
    assert.ok((r.phase4_blocks || "").length > 0, `row ${r.mg_code || r.canonical_code} missing phase4_blocks`);
  }
  assert.equal(coverage.pending_human_count, 28);
  assert.equal(coverage.exit_gate.owners_named_for_all_non_automatic, true);
});

test("named-case disposition counts", () => {
  const dc = coverage.disposition_counts;
  assert.equal(dc.auto_link_eligible, 542);
  assert.equal(dc.nasa_name_only_pending, 2); // NASA in CW001 + SP001
  assert.equal(dc.frida_kahlo_cross_entity_quarantine, 2); // FK licensor CW001 + SP001
  assert.equal(dc.zag_coldlion_only_lapsed, 2); // ZAG CW001 + SP001
  assert.equal(dc.coldlion_only_new_candidate, 12); // 6 ColdLion-only properties x 2 divisions
  assert.equal(dc.friends_tv_curated_only, 1); // FRIENDS TV
  assert.equal(dc.canonical_only_preserve, 9); // 5 X- licensors + 4 canonical-only properties
  const sum = Object.values(dc).reduce((a, b) => a + b, 0);
  assert.equal(sum, 570);

  // NASA lands on canonical X-NASA by name (code differs) — alias/rename candidate
  const nasa = licLedger.filter((r) => r.mg_code === "NA");
  assert.equal(nasa.length, 2);
  for (const r of nasa) {
    assert.equal(r.disposition, "nasa_name_only_pending");
    assert.equal(r.candidate_code, "X-NASA");
  }
  // ZAG has no candidate
  for (const r of licLedger.filter((r) => r.mg_code === "ZG")) {
    assert.equal(r.disposition, "zag_coldlion_only_lapsed");
    assert.equal(r.candidate_canonical_id, "");
  }
});

test("parent-edge comparison: all 256 canonical parents agree with DesignFlow", () => {
  assert.equal(parentCmp.agreed, 256);
  assert.equal(parentCmp.disagreed, 0);
  assert.equal(coverage.parent_comparison.agreed, 256);
  assert.equal(coverage.parent_comparison.disagreed, 0);
});

test("Phase 3 exit gate PASS, zero ambiguity, status differences zero", () => {
  assert.equal(coverage.ambiguous_automatic_matches, 0);
  assert.equal(coverage.status_differences, 0);
  assert.equal(coverage.exit_gate.coverage_100pct, true);
  assert.equal(coverage.exit_gate.zero_ambiguous_automatic_matches, true);
  assert.equal(coverage.exit_gate.approved_mapping_input_frozen_and_hashed, true);
  assert.match(coverage.exit_gate.ruling, /PASS/);
});

test("carried-forward Phase 2B baseline hashes are present and unchanged", () => {
  const b = coverage.phase2_baseline_carried_forward;
  assert.equal(b.canonical_licensors, 26);
  assert.equal(b.canonical_properties, 256);
  assert.equal(b.licensor_uuid_hash, "590ea83ea6df1487fcfc1e18b3ef6a0d");
  assert.equal(b.property_uuid_hash, "e0e6c36eb02bb2d320c0deaff7aa8f8c");
  assert.equal(b.status_hash, "5960fa4c08b5da2d0880c138e3e32ef7");
  assert.equal(b.parent_edge_hash, "7459f6826cc59468779e7ead33ec0edc");
  assert.equal(b.source_ref_count, 505);
  assert.equal(b.source_ref_hash, "5f7221c29bca6e755c448200da1a88c5");
  assert.equal(b.coldlion_source_refs, 0);
  assert.equal(b.linked_licensors, 0);
  assert.equal(b.linked_properties, 0);
  assert.equal(b.schedules, 0);
  assert.equal(b.coldlion_snapshot_hash, "a69332e05d9064723ffa1dfbd870506c");
});

test("DesignFlow entry-gate baseline is recorded (37 / 468 / 256) and the snapshot tool maps the API `title` field", () => {
  const d = coverage.designflow_baseline;
  assert.equal(d.http_status, 200);
  assert.equal(d.licensor_rows, 37);
  assert.equal(d.property_rows, 468);
  assert.equal(d.distinct_property_codes, 256);

  // The recorded edge_hash must equal a recompute over the recorded edges (internal consistency),
  // NOT a brittle literal: the title-aware snapshot is content-addressed, so any source
  // title or edge change must change the recorded hash while remaining reproducible.
  const dflowEdges = JSON.parse(readFileSync(join(P3, "designflow-fresh-edges.json"), "utf8"));
  assert.equal(hashEdges(dflowEdges), d.edge_hash, "recorded edge_hash must match the recorded edges");

  // Pure/local title-mapping coverage (NO API call): the live DesignFlow name field is `title`;
  // mg_desc/name are legacy fallbacks; `title` wins so a blank title surfaces instead of silently
  // substituting a fallback. This is the defect that left the on-disk snapshot with all-blank names.
  assert.equal(pickTitle({ title: "NASA" }), "NASA");
  assert.equal(pickTitle({ title: "NASA", mg_desc: "IGNORED" }), "NASA", "title wins over mg_desc");
  assert.equal(pickTitle({ title: "NASA", name: "IGNORED" }), "NASA", "title wins over name");
  assert.equal(pickTitle({ mg_desc: "NASA" }), "NASA", "mg_desc legacy fallback");
  assert.equal(pickTitle({ name: "NASA" }), "NASA", "name legacy fallback");
  assert.equal(pickTitle({}), "");

  // Blank-title guard: a payload with no titles is reported incomplete (non-zero blank counts),
  // proving blank titles cannot silently pass — the exact pre-fix condition.
  const blank = summarizePayload([{ mg_code: "1P", properties: [{ mg_code: "DB" }] }]);
  assert.equal(blank.summary.titles_complete, false);
  assert.equal(blank.summary.licensor_name_breakdown.blank, 1);
  assert.equal(blank.summary.property_name_breakdown.blank, 1);

  // A titled payload is reported complete and the names flow through to the edges.
  const titled = summarizePayload([
    { title: "DISNEY", mg_code: "1P", properties: [{ title: "STAR WARS", mg_code: "DB" }] },
  ]);
  assert.equal(titled.summary.titles_complete, true);
  assert.equal(titled.summary.licensor_name_breakdown.blank, 0);
  assert.equal(titled.summary.property_name_breakdown.blank, 0);
  assert.equal(titled.edges[0].licensor_name, "DISNEY");
  assert.equal(titled.edges[0].property_name, "STAR WARS");
});

test("generator is local, deterministic, and performs no DB/credential/canonical mutation", () => {
  const gen = readFileSync(join(root, "tools/generate-coldlion-licensor-property-phase3-report.mjs"), "utf8");
  // no database driver, no credential env reads, no canonical write paths
  assert.doesNotMatch(gen, /require\(.*pg"\)|from\s+["']pg["']/, "generator must not depend on a DB driver");
  assert.doesNotMatch(gen, /process\.env\.(DB_|DATABASE_URL|SUPABASE|COLDLION_API_KEY|DESIGNFLOW_API_KEY)/);
  assert.doesNotMatch(gen, /insert\s+into\s+core\./i);
  assert.doesNotMatch(gen, /update\s+core\./i);
  assert.doesNotMatch(gen, /core\.property\.licensor_id\s*=/i);
  assert.doesNotMatch(gen, /insert\s+into\s+core\.taxonomy_source_ref/i);
  assert.doesNotMatch(gen, /cron\.schedule/i);
  // hashes are content-derived (md5 over encoded rows), not time-derived
  assert.match(gen, /function encodeMappings/);
  assert.match(gen, /md5\(encodeMappings\(\[\]\)\)/);
});

console.log("coldlion-licensor-property-phase3 validation checks configured");
