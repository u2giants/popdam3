/**
 * Static contract smoke for Phase 2A ColdLion licensor/property mirror-only importer.
 * Does not connect to a database. Validates the migration, the rolled-back SQL contracts,
 * and the runner by reading them as text.
 * Run: node --test tools/coldlion-licensor-property-phase2a.test.mjs
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationPath = join(
  root,
  "supabase/migrations/20260724060000_coldlion_licensor_property_phase2a_mirror_importer.sql",
);
const correctionPath = join(
  root,
  "supabase/migrations/20260724061000_coldlion_licensor_property_phase2a_guard_corrections.sql",
);
const contractsPath = join(root, "supabase/tests/coldlion_licensor_property_phase2_contracts.sql");
const runnerPath = join(root, "tools/sync-coldlion-licensors-properties.mjs");

assert.equal(existsSync(migrationPath), true, "expected Phase 2A migration 20260724060000");
assert.equal(existsSync(correctionPath), true, "expected Phase 2A correction migration 20260724061000");
assert.equal(existsSync(contractsPath), true, "expected Phase 2A SQL contracts file");
assert.equal(existsSync(runnerPath), true, "expected runner tools/sync-coldlion-licensors-properties.mjs");

const migration = readFileSync(correctionPath, "utf8");
const contracts = readFileSync(contractsPath, "utf8");
const runner = readFileSync(runnerPath, "utf8");

function assertIncludes(haystack, snippet, label) {
  assert.match(
    haystack,
    new RegExp(snippet.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `${label}: missing ${snippet}`,
  );
}

// ---------------------------------------------------------------- migration: required surface
const migrationSnippets = [
  "20260724061000",
  "create or replace function plm.sync_coldlion_licensors_properties(",
  "create or replace function public.sync_coldlion_licensors_properties(",
  "create or replace function api.coldlion_licensor_property_run_list(",
  "p_mode text default 'mirror_only'",
  "Phase 2A supports mirror_only mode only",
  "pg_advisory_xact_lock",
  "merchGroupHeaders",
  "merchGroupDetails",
  "cross_entity_code",
  "plm.taxonomy_resolution_review",
  "plm.merch_group_header",
  "ingest.raw_record",
  "ingest.sync_run",
  "conflicting duplicate natural key",
  "incomplete pagination",
  "count dropped",
  "configured header division",
  "duplicate header natural key",
  "short licensor pull",
  "short property pull",
  "md5(d.value::text)",
  "security definer",
  "revoke all on function plm.sync_coldlion_licensors_properties",
  "revoke all on function public.sync_coldlion_licensors_properties",
  "grant execute on function public.sync_coldlion_licensors_properties",
  "coldlion_licensors_properties_api",
];
for (const s of migrationSnippets) assertIncludes(migration, s, "migration");

// mirror tables written, source-owned fields only, never canonical link fields
assertIncludes(migration, "insert into plm.erp_licensor", "migration");
assertIncludes(migration, "insert into plm.erp_property", "migration");
assert.match(migration, /on conflict \(company_code, division_code, mg_type_code, mg_code\) do update set/i);

// ---------------------------------------------------------------- migration: forbidden patterns
// No scheduling, no canonical writes, no source-ref writes, no link/promote execution path.
// (These target actual SQL statements, not the documentation comment that names the
// forbidden tables to explain the contract.)
assert.doesNotMatch(migration, /cron\.schedule/i);
assert.doesNotMatch(migration, /insert\s+into\s+core\./i);
assert.doesNotMatch(migration, /update\s+core\./i);
assert.doesNotMatch(migration, /delete\s+from\s+core\./i);
assert.doesNotMatch(migration, /insert\s+into\s+core\.taxonomy_source_ref/i);
assert.doesNotMatch(migration, /update\s+core\.taxonomy_source_ref/i);
assert.doesNotMatch(migration, /core\.property\.licensor_id\s*=/i);
// The ONLY mention of link_approved/promote_approved must be the loud rejection, never a branch.
assert.doesNotMatch(migration, /elsif[^;]*link_approved/i);
assert.doesNotMatch(migration, /elsif[^;]*promote_approved/i);
assert.doesNotMatch(migration, /when\s+(v_mode|p_mode)\s*=\s*'link_approved'/i);
assert.doesNotMatch(migration, /when\s+(v_mode|p_mode)\s*=\s*'promote_approved'/i);
// mode rejection is the single mode gate
assert.match(migration, /if v_mode <> 'mirror_only' then/i);

// ---------------------------------------------------------------- contracts: required cases
const contractSnippets = [
  "begin;",
  "rollback;",
  "plm.sync_coldlion_licensors_properties",
  "public.sync_coldlion_licensors_properties",
  "'mirror_only'",
  "'link_approved'",
  "'promote_approved'",
  "cross_entity_code",
  "P2A-BAD-PAGE",
  "P2A-BAD-SEM",
  "P2A-BAD-DUP",
  "P2A-BAD-DROP",
  "P2A-LAPSED",
  "licensorCount",
  "rows_inserted",
  "rows_unchanged",
  "snapshot_hash",
  "has_function_privilege('service_role'",
  "has_function_privilege('authenticated'",
  "core.taxonomy_source_ref",
  "source_id = 'EDGEHOME/CW001/05/P2A-1'",
  "new mirror rows must default to unresolved",
];
for (const s of contractSnippets) assertIncludes(contracts, s, "contracts");
assert.ok(contracts.indexOf("begin;") < contracts.lastIndexOf("rollback;"));

// ---------------------------------------------------------------- runner: reuses shared helpers, forces mirror_only, dry-run default
assert.match(runner, /from "\.\/coldlion-sync-common\.mjs"/);
assert.match(runner, /buildFailedSyncRunSql/);
assert.match(runner, /fetchPaged/);
assert.match(runner, /runSql/);
assert.match(runner, /SOURCE_NAME = "coldlion_licensors_properties_api"/);
assert.match(runner, /public\.sync_coldlion_licensors_properties/);
assert.match(runner, /'mirror_only'/);
assert.match(runner, /resolveRunMode/);
assert.match(runner, /willWriteDb/);
// dry-run default safety: no --apply => willWriteDb false
assert.match(runner, /args\.has\("--apply"\)/);
// configurable thresholds, not baked-in 22/258
assert.match(runner, /COLDLION_REQUIRED_DIVISIONS/);
assert.match(runner, /COLDLION_LICENSOR_FLOOR/);
assert.match(runner, /COLDLION_PROPERTY_FLOOR/);
assert.match(runner, /COLDLION_MAX_COUNT_DROP_PCT/);
// No secret emission: the runner never writes the API key value to any output stream.
assert.doesNotMatch(runner, /(stdout|stderr|console)\.[a-z]+\([^)]*\bapiKey\b/i);

console.log("coldlion-licensor-property-phase2a static checks passed");
