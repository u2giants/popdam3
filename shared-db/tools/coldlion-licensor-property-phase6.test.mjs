// Static contract tests for Phase 6 migration + tools (no DB, no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(
  new URL(
    "../supabase/migrations/20260726180000_coldlion_licensor_property_phase6_parallel_run.sql",
    import.meta.url,
  ),
);
const workflowPath = fileURLToPath(
  new URL("../.github/workflows/coldlion-licensor-property-phase6-parallel.yml", import.meta.url),
);
const contractsPath = fileURLToPath(
  new URL("../supabase/tests/coldlion_licensor_property_phase6_contracts.sql", import.meta.url),
);

const migration = readFileSync(migrationPath, "utf8");
const workflow = readFileSync(workflowPath, "utf8");
const contracts = readFileSync(contractsPath, "utf8");

test("phase6 migration is additive evidence/alert machinery", () => {
  assert.match(migration, /create table if not exists plm\.taxonomy_parallel_observation/);
  assert.match(migration, /create table if not exists plm\.taxonomy_sync_alert/);
  assert.match(migration, /plm\.compute_taxonomy_immutability_snapshot/);
  assert.match(migration, /plm\.record_taxonomy_parallel_observation/);
  assert.match(migration, /plm\.check_taxonomy_sync_health/);
  assert.match(migration, /c_expected_coldlion_refs constant integer := 542/);
  assert.match(migration, /c_expected_linked_licensors constant integer := 38/);
  assert.match(migration, /c_expected_linked_properties constant integer := 504/);
});

test("phase6 observation evidence is append-only UUID PK (no ON CONFLICT UPDATE)", () => {
  assert.match(migration, /id uuid primary key default gen_random_uuid\(\)/);
  assert.match(migration, /observation_date date not null/);
  assert.match(migration, /is_drill boolean not null default false/);
  assert.doesNotMatch(migration, /observation_date date primary key/);
  assert.doesNotMatch(migration, /on conflict\s*\(/i);
  assert.doesNotMatch(migration, /on conflict\s+on/i);
  assert.doesNotMatch(migration, /do update set/i);
  assert.match(migration, /APPEND-ONLY/i);
  assert.match(migration, /plm_taxonomy_parallel_observation_date_idx/);
});

test("phase6 pins full Phase 4 preview baseline including separate status hashes", () => {
  assert.match(migration, /c_expected_licensor_count constant integer := 26/);
  assert.match(migration, /c_expected_property_count constant integer := 256/);
  assert.match(migration, /590ea83ea6df1487fcfc1e18b3ef6a0d/);
  assert.match(migration, /e0e6c36eb02bb2d320c0deaff7aa8f8c/);
  assert.match(migration, /d9b07759bf80ff227e2fa9bd635d2138/);
  assert.match(migration, /f436d4acd79761fedbfc9b5796ac7bce/);
  assert.match(migration, /7459f6826cc59468779e7ead33ec0edc/);
  assert.match(migration, /c_expected_taxonomy_source_ref_count constant integer := 1047/);
  assert.match(migration, /c_expected_designflow_refs constant integer := 505/);
  assert.match(migration, /licensor_status_hash/);
  assert.match(migration, /property_status_hash/);
  assert.match(migration, /phase4_baseline_drift/);
});

test("phase6 drills are distinct and health uses non-drill observations", () => {
  assert.match(migration, /is_drill = false/);
  assert.match(migration, /v_is_drill boolean := v_force_fail/);
  assert.match(migration, /latest_nondrill_observation/);
  assert.match(migration, /forced_failure_drill/);
  assert.match(migration, /observation_id uuid references plm\.taxonomy_parallel_observation\(id\)/);
});

test("phase6 migration never schedules production or mutates core on write path", () => {
  assert.doesNotMatch(migration, /cron\.schedule/i);
  assert.doesNotMatch(migration, /qsllyeztdwjgirsysgai/);
  assert.doesNotMatch(migration, /insert into core\.licensor/i);
  assert.doesNotMatch(migration, /update core\.licensor/i);
  assert.doesNotMatch(migration, /update core\.property/i);
  assert.doesNotMatch(migration, /insert into core\.taxonomy_source_ref/i);
});

test("phase6 comparison computes hashes from live tables only", () => {
  assert.match(migration, /plm\.compute_taxonomy_immutability_snapshot\(\)/);
  assert.doesNotMatch(migration, /p_licensor_uuid_hash/);
  assert.doesNotMatch(migration, /p_parent_edge_hash/);
  assert.match(migration, /force_fail/);
});

test("phase6 grants: service_role write; browser no execute on public writers", () => {
  assert.match(migration, /grant execute on function public\.record_taxonomy_parallel_observation/);
  assert.match(migration, /to service_role/);
  assert.match(migration, /revoke all on function public\.record_taxonomy_parallel_observation\(date, jsonb\)[\s\S]*from anon, authenticated/i);
  assert.match(migration, /api\.coldlion_parallel_observation_list/);
  assert.match(migration, /api\.taxonomy_sync_alert_list/);
});

test("phase6 keys DesignFlow and ColdLion source names correctly", () => {
  assert.match(migration, /coldlion_licensors_properties_api/);
  assert.match(migration, /designflow_plm/);
  assert.match(migration, /plm_master_data_api/);
  assert.match(migration, /coldlion_designflow_daily_comparison/);
  assert.match(migration, /coldlion_designflow_sync_health/);
});

test("workflow is workflow_dispatch-first, preview-only, schedule-exact", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /rjyboqwcdzcocqgmsyel/);
  assert.match(workflow, /qsllyeztdwjgirsysgai/);
  assert.match(workflow, /PHASE6_SCHEDULE_ENABLED/);
  assert.match(workflow, /force-fail-health/);
  assert.match(workflow, /force-fail-compare/);
  assert.match(workflow, /SUPABASE_DB_PASSWORD_PREVIEW/);
  assert.match(workflow, /COLDLION_API_KEY/);
  assert.match(workflow, /DESIGNFLOW_API_KEY/);
  assert.match(workflow, /PHASE6_PREVIEW_ONLY/);
  assert.match(workflow, /github\.event\.schedule/);
  assert.match(workflow, /tools\/coldlion-licensor-property-phase6\.test\.mjs/);
  assert.doesNotMatch(workflow, /SUPABASE_DB_PASSWORD_PRODUCTION/);
  assert.doesNotMatch(workflow, /date -u \+%H/);
});

test("a pre-link failure still delivers a database-independent GitHub alert", () => {
  assert.match(workflow, /failed before an alert row was readable/);
  assert.match(workflow, /pre-link\/fault fallback/);
  assert.match(workflow, /database-independent fallback/);
  assert.match(workflow, /gh issue create/);
  assert.match(workflow, /Human response owner: Albert Hazan/);
});

test("phase6 SQL contracts cover append-only, baseline, and force_fail drills", () => {
  assert.match(contracts, /force_fail/);
  assert.match(contracts, /append-only|APPEND-ONLY|two same-day/i);
  assert.match(contracts, /is_drill/);
  assert.match(contracts, /browser roles must not execute/);
  assert.match(contracts, /rollback;/i);
  assert.match(contracts, /mutated canonical/);
  assert.match(contracts, /590ea83ea6df1487fcfc1e18b3ef6a0d|phase4 baseline|baseline/i);
});
