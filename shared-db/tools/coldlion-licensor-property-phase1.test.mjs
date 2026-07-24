/**
 * Static contract smoke for Phase 1 ColdLion licensor/property mirror schema.
 * Does not connect to a database.
 * Run: node tools/coldlion-licensor-property-phase1.test.mjs
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = join(
  root,
  "supabase/migrations/20260724030000_coldlion_licensor_property_phase1_mirror_schema.sql"
);
const oldMigrationPath = join(
  root,
  "supabase/migrations/20260724120000_coldlion_licensor_property_phase1_mirror_schema.sql"
);
const testsPath = join(
  root,
  "supabase/tests/coldlion_licensor_property_phase1_contracts.sql"
);

assert.equal(existsSync(oldMigrationPath), false, "future-dated 20260724120000 migration must be removed");
assert.equal(existsSync(migrationPath), true, "expected migration 20260724030000");

const migration = readFileSync(migrationPath, "utf8");
const tests = readFileSync(testsPath, "utf8");

const requiredMigrationSnippets = [
  "20260724030000",
  "Phase 1 preflight FAILED",
  "alter column licensor_id set not null",
  "property_licensor_id_fkey",
  "on delete restrict",
  "plm_merch_group_header_semantic_key_uidx",
  "unique (company_code, division_code, mg_type_code, mg_type_desc)",
  "plm_erp_licensor_header_semantic_fkey",
  "plm_erp_property_header_semantic_fkey",
  "create table plm.erp_licensor",
  "create table plm.erp_property",
  "create table plm.taxonomy_resolution_review",
  "proposed_licensor_id",
  "proposed_property_id",
  "resolved_licensor_id",
  "resolved_property_id",
  "finding_scope",
  "canonical_only",
  "primary key (company_code, division_code, mg_type_code, mg_code)",
  "api.coldlion_licensor_reconciliation",
  "api.coldlion_property_reconciliation",
  "api.coldlion_taxonomy_cutover_summary",
  "item_cooccurrence_count",
  "plm_erp_licensor_select",
  "plm_erp_property_select",
  "plm_taxonomy_resolution_review_select",
  "revoke all on table plm.erp_licensor from authenticated",
  "revoke all on table plm.erp_property from authenticated",
  "does NOT prove ColdLion source freshness",
  "raw                jsonb not null",
  "plm_taxonomy_resolution_review_source_uidx",
  "plm_taxonomy_resolution_review_status_resolution_ck",
  "plm_taxonomy_resolution_review_resolved_link_ck",
];

for (const snippet of requiredMigrationSnippets) {
  assert.match(
    migration,
    new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `migration missing: ${snippet}`
  );
}

// Partial unique index must limit ACTIVE findings only (preserve history).
assert.match(
  migration,
  /create unique index plm_taxonomy_resolution_review_source_uidx[\s\S]*?where finding_scope = 'source'\s+and status in \('open', 'quarantined', 'conflict'\)/i,
  "source_uidx must be partial unique on active statuses open|quarantined|conflict"
);
assert.match(
  migration,
  /create unique index plm_taxonomy_resolution_review_canonical_licensor_uidx[\s\S]*?status in \('open', 'quarantined', 'conflict'\)/i,
  "canonical licensor uidx must use active-status predicate"
);
assert.match(
  migration,
  /create unique index plm_taxonomy_resolution_review_canonical_property_uidx[\s\S]*?status in \('open', 'quarantined', 'conflict'\)/i,
  "canonical property uidx must use active-status predicate"
);

// COMMENT ON INDEX must be schema-qualified: indexes are created in schema plm
// (table plm.taxonomy_resolution_review), but migration search_path does not
// include plm. Unqualified names failed preview apply with:
//   ERROR: relation "plm_taxonomy_resolution_review_source_uidx" does not exist (42P01)
const reviewPartialUniqueIndexNames = [
  "plm_taxonomy_resolution_review_source_uidx",
  "plm_taxonomy_resolution_review_canonical_licensor_uidx",
  "plm_taxonomy_resolution_review_canonical_property_uidx",
];
for (const indexName of reviewPartialUniqueIndexNames) {
  assert.match(
    migration,
    new RegExp(
      String.raw`comment\s+on\s+index\s+plm\.${indexName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\s+is`,
      "i"
    ),
    `COMMENT ON INDEX for ${indexName} must be schema-qualified as plm.${indexName}`
  );
  assert.doesNotMatch(
    migration,
    new RegExp(
      String.raw`comment\s+on\s+index\s+${indexName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\s+is`,
      "i"
    ),
    `COMMENT ON INDEX for ${indexName} must not use an unqualified index name`
  );
}

// approved_link package: resolution + typed id + nonblank by + nonnull at
assert.match(
  migration,
  /status = 'approved_link'\s+and resolution = 'approved_link'/i,
  "approved_link must require resolution=approved_link"
);
assert.match(
  migration,
  /btrim\(resolved_by\) <> ''/i,
  "approved_link must require nonblank resolved_by"
);
assert.match(
  migration,
  /resolved_at is not null/i,
  "approved_link must require nonnull resolved_at"
);
// Non-approved statuses clear resolution package
assert.match(
  migration,
  /status in \('open', 'quarantined', 'conflict', 'ignored', 'dismissed'\)\s+and resolved_licensor_id is null\s+and resolved_property_id is null\s+and resolved_by is null\s+and resolved_at is null/i,
  "non-approved statuses must null all resolved_* package fields"
);
// Conflict cannot say ignored; ignored cannot say conflict
assert.match(
  migration,
  /status = 'conflict'\s+and \(resolution is null or resolution = 'conflict'\)/i,
  "conflict status must only allow null|conflict resolution"
);
assert.match(
  migration,
  /status = 'ignored'\s+and \(resolution is null or resolution = 'ignored'\)/i,
  "ignored status must only allow null|ignored resolution"
);

// raw must not use a default on new mirrors (no "raw jsonb not null default")
assert.doesNotMatch(migration, /raw\s+jsonb\s+not\s+null\s+default/i);

// No polymorphic entity ids
assert.doesNotMatch(migration, /proposed_entity_id/i);
assert.doesNotMatch(migration, /resolved_entity_id/i);

// No authenticated write policies
assert.doesNotMatch(migration, /plm_erp_licensor_admin_write/i);
assert.doesNotMatch(migration, /plm_erp_property_admin_write/i);
assert.doesNotMatch(migration, /plm_taxonomy_resolution_review_admin_write/i);
assert.doesNotMatch(migration, /for all to authenticated/i);

// No second header dictionary / importer / schedule / core bulk mutation
assert.doesNotMatch(migration, /create table plm\.erp_merch_group_header/i);
assert.doesNotMatch(migration, /create or replace function plm\.sync_coldlion_licensors/i);
assert.doesNotMatch(migration, /create or replace function public\.sync_coldlion_licensors/i);
assert.doesNotMatch(migration, /cron\.schedule/i);
assert.doesNotMatch(migration, /update core\.property\s+set/i);
assert.doesNotMatch(migration, /update core\.licensor\s+set/i);
assert.doesNotMatch(migration, /insert into core\.property/i);
assert.doesNotMatch(migration, /insert into core\.licensor/i);

const requiredTestSnippets = [
  "20260724030000",
  "begin;",
  "rollback;",
  "attnotnull",
  "confdeltype",
  "property_licensor_id_fkey",
  "null licensor_id insert",
  "delete of referenced licensor",
  "Big Theme",
  "lied mg_type_desc",
  "composite uniqueness",
  "mg_code = 'FR'",
  "P1TROOP-",
  "canonical_only",
  "proposed_licensor_id",
  "resolved_licensor_id",
  "NASA",
  "ZAG",
  "FRIDA",
  "has_table_privilege('authenticated'",
  "truncate",
  "write policies",
  "raw must be NOT NULL",
  // Active uniqueness + history
  "plm_taxonomy_resolution_review_source_uidx",
  "second active source finding",
  "new active after dismissed history",
  "new active after approved_link history",
  "exactly 1 ACTIVE finding",
  // Status/resolution matrix invalid cases
  "approved_link without resolved_by",
  "blank resolved_by",
  "approved_link without resolved_at",
  "resolution=approved_link accepted",
  "conflict status with resolution=ignored",
  "ignored status with resolution=conflict",
  "property approved_link with resolved_licensor_id",
  // Status/resolution matrix valid cases
  "valid open/unmatched",
  "valid conflict/conflict",
  "valid ignored/ignored",
  "valid dismissed/deferred",
  "resolved_property_id",
];

for (const snippet of requiredTestSnippets) {
  assert.match(
    tests,
    new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    `test missing: ${snippet}`
  );
}

// Must not plant production core.property code='FR' (FR collision is mirror-only).
// Match only within a single INSERT values list, not across later mirror FR rows.
assert.doesNotMatch(
  tests,
  /insert into core\.property\s*\([^;]*\bcode\b[^;]*\)\s*values\s*\([^;]*'FR'/i,
  "tests must not insert core.property with code FR"
);
assert.match(tests, /insert into plm\.erp_licensor[\s\S]*?'FR'/i);
assert.match(tests, /insert into plm\.erp_property[\s\S]*?'FR'/i);

assert.ok(tests.indexOf("begin;") < tests.lastIndexOf("rollback;"));

// Docs must not say NOT NULL is deferred
const docs = [
  "docs/app-migration-notes/coldlion-licensor-property-phase1-20260724.md",
  "docs/verification/coldlion-licensor-property-phase1-20260724.md",
  "fix_coldlion_licensor_property_phase1_handoff.md",
].map((p) => readFileSync(join(root, p), "utf8"));

for (const doc of docs) {
  assert.match(doc, /20260724030000/);
  // Must not describe NOT NULL enforcement as still-deferred work.
  assert.doesNotMatch(doc, /NOT NULL[^\n.]{0,80}deferred/i);
  assert.doesNotMatch(doc, /deferred[^\n.]{0,80}NOT NULL/i);
  assert.match(doc, /NOT NULL/i);
  assert.match(doc, /RESTRICT/i);
  assert.match(doc, /ENFORCED|enforced|Enforced/);
  // Review contracts: active partial unique + status/resolution matrix
  assert.match(doc, /open\s*\|\s*quarantined\s*\|\s*conflict|open.*quarantined.*conflict/i);
  assert.match(doc, /approved_link/i);
  assert.match(doc, /resolved_by/i);
  assert.match(doc, /partial unique|ACTIVE finding|active finding/i);
  assert.match(doc, /history|dismissed/i);
}

console.log("coldlion-licensor-property-phase1 static checks passed");
