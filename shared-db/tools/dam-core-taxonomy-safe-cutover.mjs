#!/usr/bin/env node
/**
 * Safe DAM core licensor/property cutover — DML-only tool + SQL builders.
 *
 * Why this exists
 * ---------------
 * Migration 20260723113000_dam_core_licensor_property_cutover.sql is preview-
 * proven but production-hostile (one transaction = DDL + ~85k rewrites →
 * PostgREST 503 / PGRST002). That file is applied on preview and MUST NOT be
 * edited. Stage 0 splits work:
 *
 *   DDL  → timestamped shared-db migrations between 112900 and 113000
 *          (drop legacy FKs → residual gate → finalize core FKs/view → ledger barrier)
 *   DML  → this Node tool only (read-only preflight + bounded residual batches)
 *
 * This module must NEVER execute ALTER/CREATE/DROP/VALIDATE (schema DDL),
 * including ALTER TABLE … DISABLE/ENABLE TRIGGER. Asset-trigger suppression
 * uses transaction-local `SET LOCAL session_replication_role = replica` only
 * (no DDL fallback). That SET must succeed before UPDATE; preview rehearsal
 * with the same DB role is the capability proof. TEMP maps stay in the same
 * short transaction as the UPDATE (transaction-safe; roll back together).
 *
 * Ledger reality
 * --------------
 * Production: 112900 applied; 113000 pending (unsafe).
 * Preview: 113000 already applied.
 * Bridge migrations: 112910 / 112920 / 112930 / 112940.
 * Barrier refuses linear push into 113000 until that version is in the ledger
 * (preview already has it; production uses owner-approved repair AFTER
 * equivalent end-state is verified — never before).
 *
 * Safety
 * ------
 * Default is offline dry-run (prints SQL / architecture only). With DATABASE_URL
 * (or SUPABASE_DB_URL), dry-run queries live state. Remote apply requires --apply
 * plus DATABASE_URL. Never reads secret files or 1Password itself.
 *
 * Run tests: node --test tools/dam-core-taxonomy-safe-cutover.test.mjs
 */

import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_BATCH_SIZE = 2000;
/** Per-batch statement budget (DML). */
export const DEFAULT_STATEMENT_TIMEOUT = "120s";
/** Bound lock waits so a stuck operator does not hang forever. */
export const DEFAULT_LOCK_TIMEOUT = "5s";
/**
 * Session-level advisory lock key for concurrent-operator refusal.
 * Stable constant (not derived from secrets).
 */
export const ADVISORY_LOCK_KEY1 = 20260723;
export const ADVISORY_LOCK_KEY2 = 113000;

/** Full cutover end-state (DML residuals clear + five core FKs + view). */
export const STATUS_END_STATE_COMPLETE = "end_state_complete";
/**
 * DML residuals are clear but migrations have not yet produced the five core
 * FKs and/or dam_character_catalog. Not full success — finish 112920–112930.
 */
export const STATUS_DML_COMPLETE_SCHEMA_INCOMPLETE = "dml_complete_schema_incomplete";

export const TARGET_FK_SPECS = [
  {
    table: "public.assets",
    constraint: "assets_licensor_id_fkey",
    column: "licensor_id",
    refTable: "core.licensor",
  },
  {
    table: "public.assets",
    constraint: "assets_property_id_fkey",
    column: "property_id",
    refTable: "core.property",
  },
  {
    table: "public.style_groups",
    constraint: "style_groups_licensor_id_fkey",
    column: "licensor_id",
    refTable: "core.licensor",
  },
  {
    table: "public.style_groups",
    constraint: "style_groups_property_id_fkey",
    column: "property_id",
    refTable: "core.property",
  },
  {
    table: "public.ai_tag_bakeoff_results",
    constraint: "ai_tag_bakeoff_results_property_id_fkey",
    column: "property_id",
    refTable: "core.property",
  },
];

/** Bridge migrations authored between 112900 and unsafe 113000. */
export const BRIDGE_MIGRATION_VERSIONS = [
  "20260723112910",
  "20260723112920",
  "20260723112930",
  "20260723112940",
];

export const UNSAFE_MIGRATION_VERSION = "20260723113000";

/** Apply orchestrator is allowed only these write-ish phases (no schema DDL). */
export const ALLOWED_APPLY_PHASES = Object.freeze([
  "preflight",
  "advisory_lock",
  "backfill_assets",
  "backfill_style_groups",
  "backfill_bakeoff",
  "validate_residuals",
]);

/** Schema DDL phases live in migrations — never in the Node apply path. */
export const FORBIDDEN_APPLY_DDL_PHASES = Object.freeze([
  "drop_fks",
  "finalize",
  "create_view",
  "validate_constraints",
]);

/** Same code aliases as 20260723113000. */
export function normalizeLegacyLicensorCode(externalId) {
  if (externalId == null) return null;
  const raw = String(externalId);
  if (raw === "DS") return "DY";
  if (raw === "WWE") return "WW";
  return raw;
}

export function normalizeName(value) {
  if (value == null) return null;
  return String(value).trim().toLowerCase();
}

/**
 * Map one legacy licensor to a core.licensor id.
 * Prefer unique code match (after DS/DY + WWE/WW), else unique normalized name.
 * Ambiguous (2+ matches at the winning tier) → coreId null + ambiguous true.
 */
export function matchLegacyLicensorToCore(legacy, coreLicensors) {
  const wantCode = normalizeLegacyLicensorCode(legacy.external_id);
  const wantName = normalizeName(legacy.name);

  const codeMatches = coreLicensors
    .filter((c) => wantCode != null && normalizeName(c.code) === normalizeName(wantCode))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  if (codeMatches.length === 1) {
    return { coreId: codeMatches[0].id, via: "code", ambiguous: false };
  }
  if (codeMatches.length > 1) {
    return { coreId: null, via: null, ambiguous: true };
  }

  const nameMatches = coreLicensors
    .filter((c) => wantName != null && normalizeName(c.name) === wantName)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  if (nameMatches.length === 1) {
    return { coreId: nameMatches[0].id, via: "name", ambiguous: false };
  }
  if (nameMatches.length > 1) {
    return { coreId: null, via: null, ambiguous: true };
  }

  return { coreId: null, via: null, ambiguous: false };
}

/**
 * Unique property match under a canonical licensor by code (case-insensitive).
 * Ambiguous or missing → null (never guess).
 */
export function matchPropertyByCode(coreLicensorId, propertyCode, coreProperties) {
  if (coreLicensorId == null || propertyCode == null || String(propertyCode).trim() === "") {
    return null;
  }
  const key = String(propertyCode).toLowerCase();
  const hits = coreProperties.filter(
    (p) =>
      p.licensor_id === coreLicensorId &&
      p.code != null &&
      String(p.code).toLowerCase() === key,
  );
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * Unique property match under a canonical licensor by normalized name.
 * Ambiguous or missing → null (never guess).
 */
export function matchPropertyByName(coreLicensorId, propertyName, coreProperties) {
  if (coreLicensorId == null || propertyName == null || String(propertyName).trim() === "") {
    return null;
  }
  const key = normalizeName(propertyName);
  const hits = coreProperties.filter(
    (p) => p.licensor_id === coreLicensorId && normalizeName(p.name) === key,
  );
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * COALESCE(existing valid core licensor, mapped legacy licensor).
 * Prevents partial-resume rows (core licensor + legacy property) from nulling
 * the already-valid licensor when the legacy map join misses.
 */
export function resolveCanonicalLicensorId(row, legacyLicensorMap, coreLicensorIds) {
  const coreSet =
    coreLicensorIds instanceof Set ? coreLicensorIds : new Set(coreLicensorIds ?? []);
  if (row.licensor_id != null && coreSet.has(row.licensor_id)) {
    return row.licensor_id;
  }
  if (row.licensor_id != null && legacyLicensorMap) {
    return legacyLicensorMap.get(row.licensor_id) ?? null;
  }
  return null;
}

/**
 * COALESCE(existing valid core property, code match, name match).
 */
export function resolveCanonicalPropertyId(
  row,
  coreLicensorId,
  coreProperties,
  corePropertyIds,
) {
  const propSet =
    corePropertyIds instanceof Set ? corePropertyIds : new Set(corePropertyIds ?? []);
  if (row.property_id != null && propSet.has(row.property_id)) {
    return row.property_id;
  }
  const codePropertyId = matchPropertyByCode(coreLicensorId, row.property_code, coreProperties);
  if (codePropertyId != null) return codePropertyId;
  const nameSource = row.property_name ?? row.legacy_property_name ?? null;
  return matchPropertyByName(coreLicensorId, nameSource, coreProperties);
}

/**
 * Resolve one asset/style_group row to canonical ids.
 * Licensor: COALESCE(valid core, legacy map).
 * Property: code first, then unique name scoped to canonical licensor;
 *           COALESCE with existing valid core property.
 * Durable text fields are intentionally not returned for write-back.
 */
export function resolveTaxonomyRow(
  row,
  legacyLicensorMap,
  coreProperties,
  coreLicensorIds = null,
  corePropertyIds = null,
) {
  const coreLicSet =
    coreLicensorIds instanceof Set
      ? coreLicensorIds
      : coreLicensorIds
        ? new Set(coreLicensorIds)
        : new Set((coreProperties ?? []).map((p) => p.licensor_id));
  // When callers omit coreLicensorIds, still preserve ids that appear as
  // property.licensor_id; explicit Set is preferred in tests / apply path.
  const licensorId = resolveCanonicalLicensorId(row, legacyLicensorMap, coreLicSet);

  const propSet =
    corePropertyIds instanceof Set
      ? corePropertyIds
      : corePropertyIds
        ? new Set(corePropertyIds)
        : new Set((coreProperties ?? []).map((p) => p.id));

  const propertyId = resolveCanonicalPropertyId(
    row,
    licensorId,
    coreProperties,
    propSet,
  );

  return {
    id: row.id,
    licensor_id: licensorId,
    property_id: propertyId,
    preserved_property_code: row.property_code ?? null,
    preserved_property_name: row.property_name ?? null,
  };
}

/** Rows that still point at non-core ids and therefore need rewrite. */
export function rowsNeedingRewrite(rows, coreLicensorIds, corePropertyIds) {
  const lic = coreLicensorIds instanceof Set ? coreLicensorIds : new Set(coreLicensorIds);
  const prop = corePropertyIds instanceof Set ? corePropertyIds : new Set(corePropertyIds);
  return rows.filter((r) => {
    const badLic = r.licensor_id != null && !lic.has(r.licensor_id);
    const badProp = r.property_id != null && !prop.has(r.property_id);
    return badLic || badProp;
  });
}

/**
 * Deterministic batch selection for resume.
 * Orders by id ascending and takes the next `batchSize` rows after `afterId`.
 */
export function selectNextBatch(residualRows, batchSize, afterId = null) {
  const size = Number(batchSize);
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`batchSize must be a positive integer, got ${batchSize}`);
  }
  const sorted = [...residualRows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const filtered =
    afterId == null ? sorted : sorted.filter((r) => String(r.id) > String(afterId));
  return filtered.slice(0, size);
}

/**
 * After a batch: residual must strictly decrease when residual was nonzero
 * and the batch reported updates (or we accept residual→0 with updated≥0).
 * Abort if nonzero residual does not decrease.
 */
export function evaluateForwardProgress({
  residualBefore,
  residualAfter,
  rowsUpdated,
  label = "batch",
}) {
  const before = Number(residualBefore);
  const after = Number(residualAfter);
  const updated = Number(rowsUpdated);
  if (!Number.isFinite(before) || !Number.isFinite(after) || !Number.isFinite(updated)) {
    return {
      ok: false,
      reason: `${label}: non-numeric progress counters before=${residualBefore} after=${residualAfter} updated=${rowsUpdated}`,
    };
  }
  if (before < 0 || after < 0 || updated < 0) {
    return { ok: false, reason: `${label}: negative progress counters are invalid` };
  }
  if (before === 0) {
    return { ok: true, reason: `${label}: already clear` };
  }
  if (after >= before) {
    return {
      ok: false,
      reason: `${label}: residual did not decrease (before=${before}, after=${after}, updated=${updated}) — aborting to avoid stuck loop`,
    };
  }
  if (updated <= 0 && after > 0) {
    return {
      ok: false,
      reason: `${label}: residual decreased without reported updates (before=${before}, after=${after}, updated=${updated}) — aborting`,
    };
  }
  return {
    ok: true,
    reason: `${label}: forward progress updated=${updated} residual ${before}→${after}`,
  };
}

/**
 * Decide whether DML preflight should abort, no-op, or proceed with backfill.
 * Schema DDL is never scheduled here — migrations own drop/gate/finalize/barrier.
 */
export function evaluatePreflight(input) {
  const {
    unmappedLegacyLicensors = 0,
    ambiguousLegacyLicensors = 0,
    residualAssets = 0,
    residualStyleGroups = 0,
    residualBakeoff = 0,
    coreTargetedFkCount = 0,
    legacyTargetedFkCount = 0,
    missingFkCount = 0,
    characterCatalogExists = false,
    batchSize = DEFAULT_BATCH_SIZE,
  } = input;

  if (!Number.isInteger(batchSize) || batchSize <= 0 || batchSize > 10000) {
    return {
      action: "abort",
      reason: `Invalid batchSize ${batchSize}; must be integer 1..10000`,
      phases: [],
    };
  }

  if (unmappedLegacyLicensors > 0) {
    return {
      action: "abort",
      reason: `DAM core taxonomy cutover aborted: ${unmappedLegacyLicensors} legacy licensors have no canonical core.licensor match`,
      phases: [],
    };
  }

  if (ambiguousLegacyLicensors > 0) {
    return {
      action: "abort",
      reason: `DAM core taxonomy cutover aborted: ${ambiguousLegacyLicensors} legacy licensors have ambiguous (multiple) core.licensor matches`,
      phases: [],
    };
  }

  const residuals = residualAssets + residualStyleGroups + residualBakeoff;
  const fullyCoreFks = coreTargetedFkCount === TARGET_FK_SPECS.length;
  const noResiduals = residuals === 0;
  const endStateComplete = fullyCoreFks && characterCatalogExists;

  // Tool no-op when DML is done. FK/view completeness is migration territory.
  // Never report full success when residuals are zero but FKs/view are missing.
  if (noResiduals) {
    return {
      action: "noop",
      status: endStateComplete
        ? STATUS_END_STATE_COMPLETE
        : STATUS_DML_COMPLETE_SCHEMA_INCOMPLETE,
      reason: endStateComplete
        ? "Cutover end-state complete: zero residual non-core ids and five core FKs + dam_character_catalog present"
        : "dml_complete_schema_incomplete: zero residual non-core ids, but five core FKs and/or dam_character_catalog are not yet present — apply bridge migrations 112920–112930 (not this tool); do not treat as full end-state success",
      phases: [],
      progress: {
        residualAssets,
        residualStyleGroups,
        residualBakeoff,
        coreTargetedFkCount,
        legacyTargetedFkCount,
        missingFkCount,
        characterCatalogExists,
      },
    };
  }

  // Residuals remain: legacy FKs would reject core UUIDs. Require drop migration first.
  if (legacyTargetedFkCount > 0) {
    return {
      action: "abort",
      reason:
        "Residuals remain but legacy-targeted FKs still exist. Apply migration 20260723112910 (drop legacy FKs only) before this DML tool. This tool never runs DDL.",
      phases: [],
      progress: {
        residualAssets,
        residualStyleGroups,
        residualBakeoff,
        legacyTargetedFkCount,
      },
    };
  }

  return {
    action: "proceed",
    reason: "Safe DML backfill will rewrite residual non-core licensor/property ids only",
    phases: ["backfill"],
    progress: {
      residualAssets,
      residualStyleGroups,
      residualBakeoff,
      coreTargetedFkCount,
      legacyTargetedFkCount,
      missingFkCount,
      characterCatalogExists,
      batchSize,
    },
  };
}

/** Progress snapshot after a batch for operators / logs. */
export function formatProgressEvidence(snapshot) {
  const {
    phase,
    batchIndex = null,
    batchSize = null,
    rowsUpdated = null,
    residualAssets = null,
    residualStyleGroups = null,
    residualBakeoff = null,
    residualBefore = null,
    residualAfter = null,
    lastId = null,
    elapsedMs = null,
  } = snapshot;
  const parts = [`phase=${phase}`];
  if (batchIndex != null) parts.push(`batch=${batchIndex}`);
  if (batchSize != null) parts.push(`batchSize=${batchSize}`);
  if (rowsUpdated != null) parts.push(`updated=${rowsUpdated}`);
  if (residualBefore != null) parts.push(`residualBefore=${residualBefore}`);
  if (residualAfter != null) parts.push(`residualAfter=${residualAfter}`);
  if (residualAssets != null) parts.push(`residualAssets=${residualAssets}`);
  if (residualStyleGroups != null) parts.push(`residualStyleGroups=${residualStyleGroups}`);
  if (residualBakeoff != null) parts.push(`residualBakeoff=${residualBakeoff}`);
  if (lastId != null) parts.push(`lastId=${lastId}`);
  if (elapsedMs != null) parts.push(`elapsedMs=${elapsedMs}`);
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Shared SQL fragments
// ---------------------------------------------------------------------------

function licensorResolutionCte(alias = "legacy") {
  return `
  select
    ${alias}.id as legacy_id,
    (
      select array_agg(c.id order by c.id)
      from core.licensor c
      where lower(c.code) = lower(
        case ${alias}.external_id
          when 'DS' then 'DY'
          when 'WWE' then 'WW'
          else ${alias}.external_id
        end
      )
    ) as code_ids,
    (
      select array_agg(c.id order by c.id)
      from core.licensor c
      where lower(trim(c.name)) = lower(trim(${alias}.name))
    ) as name_ids
  from public.licensors ${alias}`.trim();
}

function licensorMapSelectFromResolution(src = "lr") {
  return `
  select
    ${src}.legacy_id,
    case
      when coalesce(cardinality(${src}.code_ids), 0) = 1 then ${src}.code_ids[1]
      when coalesce(cardinality(${src}.code_ids), 0) = 0
        and coalesce(cardinality(${src}.name_ids), 0) = 1 then ${src}.name_ids[1]
      else null
    end as core_id,
    case
      when coalesce(cardinality(${src}.code_ids), 0) > 1 then true
      when coalesce(cardinality(${src}.code_ids), 0) = 0
        and coalesce(cardinality(${src}.name_ids), 0) > 1 then true
      else false
    end as ambiguous
  from (${licensorResolutionCte("legacy")}) ${src}`.trim();
}

export function buildSessionTimeoutsSql({
  lockTimeout = DEFAULT_LOCK_TIMEOUT,
  statementTimeout = DEFAULT_STATEMENT_TIMEOUT,
} = {}) {
  return `
set local lock_timeout = '${lockTimeout}';
set local statement_timeout = '${statementTimeout}';
`.trim();
}

export function buildAdvisoryLockSql() {
  return `
select pg_try_advisory_lock(${ADVISORY_LOCK_KEY1}, ${ADVISORY_LOCK_KEY2}) as acquired
`.trim();
}

export function buildAdvisoryUnlockSql() {
  return `
select pg_advisory_unlock(${ADVISORY_LOCK_KEY1}, ${ADVISORY_LOCK_KEY2}) as released
`.trim();
}

export function buildPreflightSql() {
  return `
-- Read-only preflight / progress evidence (no writes).
with licensor_map as (
  ${licensorMapSelectFromResolution("lr")}
),
unmapped as (
  select count(*)::bigint as n
  from public.licensors l
  left join licensor_map m on m.legacy_id = l.id
  where m.core_id is null and coalesce(m.ambiguous, false) = false
),
ambiguous as (
  select count(*)::bigint as n
  from licensor_map m
  where m.ambiguous = true
),
residual_assets as (
  select count(*)::bigint as n
  from public.assets a
  where (a.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = a.licensor_id))
     or (a.property_id is not null and not exists (select 1 from core.property p where p.id = a.property_id))
),
residual_style_groups as (
  select count(*)::bigint as n
  from public.style_groups sg
  where (sg.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = sg.licensor_id))
     or (sg.property_id is not null and not exists (select 1 from core.property p where p.id = sg.property_id))
),
residual_bakeoff as (
  select count(*)::bigint as n
  from public.ai_tag_bakeoff_results r
  where r.property_id is not null
    and not exists (select 1 from core.property p where p.id = r.property_id)
),
fk as (
  select
    c.conname,
    n.nspname || '.' || rel.relname as table_name,
    rn.nspname || '.' || ref.relname as ref_table
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_namespace n on n.oid = rel.relnamespace
  join pg_class ref on ref.oid = c.confrelid
  join pg_namespace rn on rn.oid = ref.relnamespace
  where c.contype = 'f'
    and c.conname in (
      'assets_licensor_id_fkey',
      'assets_property_id_fkey',
      'style_groups_licensor_id_fkey',
      'style_groups_property_id_fkey',
      'ai_tag_bakeoff_results_property_id_fkey'
    )
),
catalog as (
  select exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'dam_character_catalog' and c.relkind in ('v', 'm')
  ) as exists
)
select
  (select n from unmapped) as unmapped_legacy_licensors,
  (select n from ambiguous) as ambiguous_legacy_licensors,
  (select n from residual_assets) as residual_assets,
  (select n from residual_style_groups) as residual_style_groups,
  (select n from residual_bakeoff) as residual_bakeoff,
  (select count(*) from fk where ref_table in ('core.licensor', 'core.property'))::int as core_targeted_fk_count,
  (select count(*) from fk where ref_table in ('public.licensors', 'public.properties'))::int as legacy_targeted_fk_count,
  (5 - (select count(*) from fk))::int as missing_fk_count,
  (select exists from catalog) as character_catalog_exists,
  coalesce((select json_agg(json_build_object('conname', conname, 'table', table_name, 'ref', ref_table) order by conname) from fk), '[]'::json) as fk_details
`.trim();
}

export function buildResidualCountSql(table) {
  if (table === "assets") {
    return `
select count(*)::bigint as n
from public.assets a
where (a.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = a.licensor_id))
   or (a.property_id is not null and not exists (select 1 from core.property p where p.id = a.property_id))
`.trim();
  }
  if (table === "style_groups") {
    return `
select count(*)::bigint as n
from public.style_groups sg
where (sg.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = sg.licensor_id))
   or (sg.property_id is not null and not exists (select 1 from core.property p where p.id = sg.property_id))
`.trim();
  }
  if (table === "bakeoff") {
    return `
select count(*)::bigint as n
from public.ai_tag_bakeoff_results r
where r.property_id is not null
  and not exists (select 1 from core.property p where p.id = r.property_id)
`.trim();
  }
  throw new Error(`Unknown residual table: ${table}`);
}

/**
 * One committed asset batch (DML). Residual-scoped; preserves valid core ids via COALESCE.
 * Returns rows updated through a NOTICE and a final SELECT in the DO block via a temp result
 * pattern — apply path uses GET DIAGNOSTICS via returning count in a query form.
 */
export function buildAssetBatchSql(batchSize = DEFAULT_BATCH_SIZE) {
  const size = Number(batchSize);
  if (!Number.isInteger(size) || size <= 0 || size > 10000) {
    throw new Error(`Invalid batchSize for asset batch SQL: ${batchSize}`);
  }
  return `
-- DML-only asset batch (single short transaction). Idempotent / resumable.
-- Schema FK DDL is owned by migrations 20260723112910 / 20260723112930 — not here.
do $batch$
declare
  v_rows integer;
  v_unmapped bigint;
  v_ambiguous bigint;
begin
  create temporary table dam_legacy_licensor_map on commit drop as
  ${licensorMapSelectFromResolution("lr")};

  select count(*) into v_unmapped
  from public.licensors l
  left join dam_legacy_licensor_map m on m.legacy_id = l.id
  where m.core_id is null and coalesce(m.ambiguous, false) = false;

  select count(*) into v_ambiguous
  from dam_legacy_licensor_map m
  where m.ambiguous = true;

  if v_unmapped <> 0 then
    raise exception 'DAM core taxonomy cutover aborted: % legacy licensors have no canonical core.licensor match', v_unmapped;
  end if;
  if v_ambiguous <> 0 then
    raise exception 'DAM core taxonomy cutover aborted: % legacy licensors have ambiguous core.licensor matches', v_ambiguous;
  end if;

  create temporary table dam_core_property_by_code on commit drop as
  select p.licensor_id, lower(p.code) as lookup_key, min(p.id::text)::uuid as core_id
  from core.property p
  where p.code is not null
  group by p.licensor_id, lower(p.code)
  having count(*) = 1;
  create index on dam_core_property_by_code (licensor_id, lookup_key);

  create temporary table dam_core_property_by_name on commit drop as
  select p.licensor_id, lower(trim(p.name)) as lookup_key, min(p.id::text)::uuid as core_id
  from core.property p
  group by p.licensor_id, lower(trim(p.name))
  having count(*) = 1;
  create index on dam_core_property_by_name (licensor_id, lookup_key);

  -- Suppress irrelevant asset triggers for this transaction only.
  -- Requires privilege to set session_replication_role; fails before UPDATE if
  -- the connected role cannot (no table-trigger toggle fallback; that is DDL).
  -- Capability proof: preview rehearsal with the same DB role.
  set local session_replication_role = replica;

  with residual as (
    select a.id
    from public.assets a
    where (a.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = a.licensor_id))
       or (a.property_id is not null and not exists (select 1 from core.property p where p.id = a.property_id))
    order by a.id
    limit ${size}
  ),
  resolved as (
    select
      a.id,
      coalesce(
        (select c.id from core.licensor c where c.id = a.licensor_id),
        lm.core_id
      ) as licensor_id,
      coalesce(
        (select p.id from core.property p where p.id = a.property_id),
        code_match.core_id,
        name_match.core_id
      ) as property_id
    from public.assets a
    join residual r on r.id = a.id
    left join dam_legacy_licensor_map lm on lm.legacy_id = a.licensor_id
    left join public.properties legacy_property on legacy_property.id = a.property_id
    left join dam_core_property_by_code code_match
      on code_match.licensor_id = coalesce(
           (select c.id from core.licensor c where c.id = a.licensor_id),
           lm.core_id
         )
     and code_match.lookup_key = lower(a.property_code)
    left join dam_core_property_by_name name_match
      on name_match.licensor_id = coalesce(
           (select c.id from core.licensor c where c.id = a.licensor_id),
           lm.core_id
         )
     and name_match.lookup_key = lower(trim(coalesce(a.property_name, legacy_property.name)))
  ),
  updated as (
    update public.assets a
    set licensor_id = resolved.licensor_id,
        property_id = resolved.property_id
    from resolved
    where a.id = resolved.id
    returning a.id
  )
  select count(*) into v_rows from updated;

  create temporary table if not exists dam_core_taxonomy_batch_result (
    rows_updated integer not null
  ) on commit drop;
  delete from dam_core_taxonomy_batch_result;
  insert into dam_core_taxonomy_batch_result(rows_updated) values (v_rows);

  raise notice 'dam_core_taxonomy asset batch updated=%', v_rows;
end
$batch$;
select rows_updated from dam_core_taxonomy_batch_result;
`.trim();
}

export function buildStyleGroupsBackfillSql() {
  return `
-- DML-only style_groups rewrite (one short transaction).
do $sg$
declare
  v_rows integer;
  v_unmapped bigint;
  v_ambiguous bigint;
begin
  create temporary table dam_legacy_licensor_map on commit drop as
  ${licensorMapSelectFromResolution("lr")};

  select count(*) into v_unmapped
  from public.licensors l
  left join dam_legacy_licensor_map m on m.legacy_id = l.id
  where m.core_id is null and coalesce(m.ambiguous, false) = false;

  select count(*) into v_ambiguous
  from dam_legacy_licensor_map m
  where m.ambiguous = true;

  if v_unmapped <> 0 then
    raise exception 'DAM core taxonomy cutover aborted: % legacy licensors have no canonical core.licensor match', v_unmapped;
  end if;
  if v_ambiguous <> 0 then
    raise exception 'DAM core taxonomy cutover aborted: % legacy licensors have ambiguous core.licensor matches', v_ambiguous;
  end if;

  create temporary table dam_core_property_by_code on commit drop as
  select p.licensor_id, lower(p.code) as lookup_key, min(p.id::text)::uuid as core_id
  from core.property p
  where p.code is not null
  group by p.licensor_id, lower(p.code)
  having count(*) = 1;

  create temporary table dam_core_property_by_name on commit drop as
  select p.licensor_id, lower(trim(p.name)) as lookup_key, min(p.id::text)::uuid as core_id
  from core.property p
  group by p.licensor_id, lower(trim(p.name))
  having count(*) = 1;

  with residual as (
    select sg.id
    from public.style_groups sg
    where (sg.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = sg.licensor_id))
       or (sg.property_id is not null and not exists (select 1 from core.property p where p.id = sg.property_id))
  ),
  resolved as (
    select
      sg.id,
      coalesce(
        (select c.id from core.licensor c where c.id = sg.licensor_id),
        lm.core_id
      ) as licensor_id,
      coalesce(
        (select p.id from core.property p where p.id = sg.property_id),
        code_match.core_id,
        name_match.core_id
      ) as property_id
    from public.style_groups sg
    join residual r on r.id = sg.id
    left join dam_legacy_licensor_map lm on lm.legacy_id = sg.licensor_id
    left join public.properties legacy_property on legacy_property.id = sg.property_id
    left join dam_core_property_by_code code_match
      on code_match.licensor_id = coalesce(
           (select c.id from core.licensor c where c.id = sg.licensor_id),
           lm.core_id
         )
     and code_match.lookup_key = lower(sg.property_code)
    left join dam_core_property_by_name name_match
      on name_match.licensor_id = coalesce(
           (select c.id from core.licensor c where c.id = sg.licensor_id),
           lm.core_id
         )
     and name_match.lookup_key = lower(trim(coalesce(sg.property_name, legacy_property.name)))
  ),
  updated as (
    update public.style_groups sg
    set licensor_id = resolved.licensor_id,
        property_id = resolved.property_id
    from resolved
    where sg.id = resolved.id
    returning sg.id
  )
  select count(*) into v_rows from updated;

  create temporary table if not exists dam_core_taxonomy_batch_result (
    rows_updated integer not null
  ) on commit drop;
  delete from dam_core_taxonomy_batch_result;
  insert into dam_core_taxonomy_batch_result(rows_updated) values (v_rows);

  raise notice 'dam_core_taxonomy style_groups updated=%', v_rows;
end
$sg$;
select rows_updated from dam_core_taxonomy_batch_result;
`.trim();
}

export function buildBakeoffBackfillSql() {
  return `
-- DML-only ai_tag_bakeoff_results property rewrite (one short transaction).
do $bo$
declare
  v_rows integer := 0;
  v_rows2 integer := 0;
begin
  create temporary table dam_legacy_licensor_map on commit drop as
  ${licensorMapSelectFromResolution("lr")};

  create temporary table dam_legacy_property_map on commit drop as
  select legacy.id as legacy_id, min(canonical.id::text)::uuid as core_id
  from public.properties legacy
  join dam_legacy_licensor_map lm on lm.legacy_id = legacy.licensor_id and lm.core_id is not null
  join core.property canonical
    on canonical.licensor_id = lm.core_id
   and lower(trim(canonical.name)) = lower(trim(legacy.name))
  group by legacy.id
  having count(*) = 1;

  with updated as (
    update public.ai_tag_bakeoff_results r
    set property_id = m.core_id
    from dam_legacy_property_map m
    where r.property_id = m.legacy_id
    returning r.asset_id
  )
  select count(*) into v_rows from updated;

  with updated as (
    update public.ai_tag_bakeoff_results r
    set property_id = null
    where r.property_id is not null
      and not exists (select 1 from core.property p where p.id = r.property_id)
    returning r.asset_id
  )
  select count(*) into v_rows2 from updated;

  create temporary table if not exists dam_core_taxonomy_batch_result (
    rows_updated integer not null
  ) on commit drop;
  delete from dam_core_taxonomy_batch_result;
  insert into dam_core_taxonomy_batch_result(rows_updated) values (v_rows + v_rows2);

  raise notice 'dam_core_taxonomy bakeoff updated=%', v_rows + v_rows2;
end
$bo$;
select rows_updated from dam_core_taxonomy_batch_result;
`.trim();
}

export function buildFinalValidationSql() {
  return `
-- Exact end-state proof query (read-only). Five named core FKs + zero residuals + view.
select
  (select count(*) from public.assets a
    where a.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = a.licensor_id)
  )::bigint as bad_asset_licensors,
  (select count(*) from public.assets a
    where a.property_id is not null and not exists (select 1 from core.property p where p.id = a.property_id)
  )::bigint as bad_asset_properties,
  (select count(*) from public.style_groups sg
    where sg.licensor_id is not null and not exists (select 1 from core.licensor c where c.id = sg.licensor_id)
  )::bigint as bad_sg_licensors,
  (select count(*) from public.style_groups sg
    where sg.property_id is not null and not exists (select 1 from core.property p where p.id = sg.property_id)
  )::bigint as bad_sg_properties,
  (select count(*) from public.ai_tag_bakeoff_results r
    where r.property_id is not null and not exists (select 1 from core.property p where p.id = r.property_id)
  )::bigint as bad_bakeoff_properties,
  (
    select count(*)
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f'
      and c.conname in (
        'assets_licensor_id_fkey',
        'assets_property_id_fkey',
        'style_groups_licensor_id_fkey',
        'style_groups_property_id_fkey',
        'ai_tag_bakeoff_results_property_id_fkey'
      )
      and rn.nspname || '.' || ref.relname in ('core.licensor', 'core.property')
  )::int as core_fk_count,
  (
    select coalesce(json_agg(json_build_object(
      'conname', c.conname,
      'ref', rn.nspname || '.' || ref.relname
    ) order by c.conname), '[]'::json)
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    join pg_class ref on ref.oid = c.confrelid
    join pg_namespace rn on rn.oid = ref.relnamespace
    where c.contype = 'f'
      and c.conname in (
        'assets_licensor_id_fkey',
        'assets_property_id_fkey',
        'style_groups_licensor_id_fkey',
        'style_groups_property_id_fkey',
        'ai_tag_bakeoff_results_property_id_fkey'
      )
  ) as fk_details,
  exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'dam_character_catalog' and c.relkind in ('v','m')
  ) as character_catalog_exists,
  (select count(*) from public.assets where licensor_id is not null)::bigint as asset_licensor_links,
  (select count(*) from public.assets where property_id is not null)::bigint as asset_property_links
`.trim();
}

export function evaluateFinalValidation(row) {
  const bad =
    Number(row.bad_asset_licensors) +
    Number(row.bad_asset_properties) +
    Number(row.bad_sg_licensors) +
    Number(row.bad_sg_properties) +
    Number(row.bad_bakeoff_properties);
  if (bad !== 0) {
    return { ok: false, reason: `Residual non-core ids remain (sum=${bad})`, row };
  }
  if (Number(row.core_fk_count) !== TARGET_FK_SPECS.length) {
    return {
      ok: false,
      reason: `Expected ${TARGET_FK_SPECS.length} core FKs, found ${row.core_fk_count}`,
      row,
    };
  }
  if (!row.character_catalog_exists) {
    return { ok: false, reason: "public.dam_character_catalog missing", row };
  }
  return { ok: true, reason: "Final validation passed", row };
}

/**
 * DML-only phase plan for the Node apply orchestrator.
 * Never includes drop_fks / finalize / other schema DDL.
 */
export function buildPhasePlan(preflightDecision, batchSize = DEFAULT_BATCH_SIZE) {
  if (preflightDecision.action === "abort") {
    return { action: "abort", reason: preflightDecision.reason, steps: [] };
  }
  if (preflightDecision.action === "noop") {
    return { action: "noop", reason: preflightDecision.reason, steps: [] };
  }

  const steps = [];
  for (const phase of preflightDecision.phases) {
    if (phase === "backfill") {
      const residualAssets = preflightDecision.progress?.residualAssets ?? 0;
      const assetBatches =
        residualAssets === 0 ? 0 : Math.ceil(residualAssets / batchSize);
      for (let i = 0; i < assetBatches; i += 1) {
        steps.push({
          phase: "backfill_assets",
          batchIndex: i + 1,
          batchSize,
          sql: buildAssetBatchSql(batchSize),
        });
      }
      steps.push({ phase: "backfill_style_groups", sql: buildStyleGroupsBackfillSql() });
      steps.push({ phase: "backfill_bakeoff", sql: buildBakeoffBackfillSql() });
      steps.push({
        phase: "validate_residuals",
        sql: buildFinalValidationSql(),
        readOnly: true,
      });
    } else if (FORBIDDEN_APPLY_DDL_PHASES.includes(phase)) {
      throw new Error(
        `buildPhasePlan refused forbidden DDL phase "${phase}" — use shared-db migrations`,
      );
    } else {
      throw new Error(`Unknown preflight phase: ${phase}`);
    }
  }

  for (const step of steps) {
    if (FORBIDDEN_APPLY_DDL_PHASES.includes(step.phase)) {
      throw new Error(`Plan contains forbidden DDL phase: ${step.phase}`);
    }
  }

  return { action: "proceed", reason: preflightDecision.reason, steps };
}

/**
 * Static proof that an apply plan/step list never schedules schema DDL phases
 * and that orchestrator-executed SQL does not include ALTER / CREATE VIEW /
 * DROP constraint-or-table / VALIDATE (TEMP helpers and SET LOCAL are ok).
 */
export function assertApplyPlanIsDmlOnly(plan) {
  if (!plan || !Array.isArray(plan.steps)) {
    throw new Error("assertApplyPlanIsDmlOnly: plan.steps required");
  }
  for (const step of plan.steps) {
    if (FORBIDDEN_APPLY_DDL_PHASES.includes(step.phase)) {
      throw new Error(`Apply plan includes forbidden DDL phase: ${step.phase}`);
    }
    if (!ALLOWED_APPLY_PHASES.includes(step.phase) && step.phase !== "validate_residuals") {
      // validate_residuals is allowed; already in ALLOWED
      if (!ALLOWED_APPLY_PHASES.includes(step.phase)) {
        throw new Error(`Apply plan includes unexpected phase: ${step.phase}`);
      }
    }
    // Schema DDL must never appear — including table-trigger disable/enable.
    // Strip SQL line comments so documentation text is not false-positive DDL.
    if (step.sql) {
      const sqlBody = step.sql.replace(/--[^\n]*/g, " ");
      if (
        /\b(alter\s+table|add\s+constraint|validate\s+constraint|create\s+(or\s+replace\s+)?view|drop\s+(constraint|table|view|index|function|trigger)|disable\s+trigger|enable\s+trigger)\b/i.test(
          sqlBody,
        )
      ) {
        throw new Error(
          `Apply plan step ${step.phase} contains schema DDL (ALTER/CREATE VIEW/DROP/VALIDATE/TRIGGER) — forbidden in Node tool`,
        );
      }
    }
  }
  return true;
}

/** List migration filenames that must exist for the ledger bridge. */
export function listBridgeMigrationFilenames() {
  return [
    "20260723112910_dam_core_taxonomy_drop_legacy_fks.sql",
    "20260723112920_dam_core_taxonomy_backfill_gate.sql",
    "20260723112930_dam_core_taxonomy_finalize_core_fks.sql",
    "20260723112940_dam_core_taxonomy_ledger_barrier.sql",
  ];
}

export function readBridgeMigrationSql(migrationsDir) {
  const files = listBridgeMigrationFilenames();
  const out = {};
  for (const f of files) {
    out[f] = readFileSync(join(migrationsDir, f), "utf8");
  }
  return out;
}

/**
 * Pure evaluation of barrier / gate migration semantics for unit tests
 * (mirrors SQL decision logic without a database).
 */
export function evaluateBackfillGate({ residualAssets, residualStyleGroups, residualBakeoff }) {
  const total =
    Number(residualAssets) + Number(residualStyleGroups) + Number(residualBakeoff);
  if (total > 0) {
    return {
      ok: false,
      reason: `backfill gate refuses: residuals remain total=${total}`,
    };
  }
  return { ok: true, reason: "backfill gate pass: zero residuals" };
}

/**
 * Ledger barrier: pass only when unsafe 113000 is already recorded applied
 * (preview, or production after owner-approved repair). Never pass merely
 * because end-state looks good — repair is still required before 113000 is
 * considered applied, and this barrier blocks linear push into re-running it.
 */
export function evaluateLedgerBarrier({ hasUnsafe113000InLedger }) {
  if (hasUnsafe113000InLedger) {
    return {
      ok: true,
      reason:
        "barrier pass: 20260723113000 already in schema_migrations (preview or post-repair production)",
    };
  }
  return {
    ok: false,
    reason:
      "barrier refuse: 20260723113000 not in ledger — complete end-state via 112910–112930 + DML tool, verify, then owner-approved migration repair --status applied 20260723113000 before db push may continue",
  };
}

/**
 * Documented multi-pass db push workflow (for tests + operator messaging).
 */
export function describeDbPushWorkflow() {
  return {
    productionPasses: [
      {
        pass: 1,
        command: "supabase db push",
        applies: ["20260723112910"],
        stopsAt: "20260723112920 backfill gate (residuals remain)",
        next: "run DML tool --apply until residuals=0",
      },
      {
        pass: 2,
        command: "supabase db push",
        applies: ["20260723112920", "20260723112930"],
        stopsAt: "20260723112940 ledger barrier (113000 not repaired)",
        next: "verify end-state; owner-approved migration repair --status applied 20260723113000",
      },
      {
        pass: 3,
        command: "supabase db push",
        applies: ["20260723112940", "20260723113100"],
        stopsAt: null,
        next: "dry-run must not list 113000 as pending work",
      },
    ],
    previewOutOfOrder: {
      note:
        "Preview already has 113000 applied. New 112910–112940 versions are out-of-order inserts. supabase db push --include-all applies them; each is idempotent/no-op or barrier-pass because 113000 is in the ledger.",
      includeAll: true,
    },
    forbidden: [
      "Do not edit/rename/delete 20260723113000",
      "Do not migration repair 113000 before equivalent end-state exists",
      "Do not run Node tool DDL phases (there are none)",
      "Do not modify schema_migrations from SQL",
    ],
  };
}

function preflightFromRow(row, batchSize) {
  return evaluatePreflight({
    unmappedLegacyLicensors: Number(row.unmapped_legacy_licensors),
    ambiguousLegacyLicensors: Number(row.ambiguous_legacy_licensors ?? 0),
    residualAssets: Number(row.residual_assets),
    residualStyleGroups: Number(row.residual_style_groups),
    residualBakeoff: Number(row.residual_bakeoff),
    coreTargetedFkCount: Number(row.core_targeted_fk_count),
    legacyTargetedFkCount: Number(row.legacy_targeted_fk_count),
    missingFkCount: Number(row.missing_fk_count),
    characterCatalogExists: Boolean(row.character_catalog_exists),
    batchSize,
  });
}

async function runDmlTransaction(client, sql, timeouts) {
  await client.query("begin");
  try {
    await client.query(buildSessionTimeoutsSql(timeouts));
    const result = await client.query(sql);
    await client.query("commit");
    // Last result set from "select rows_updated ..."
    const rowsUpdated =
      result?.rows?.[0]?.rows_updated != null
        ? Number(result.rows[0].rows_updated)
        : result?.rowCount ?? 0;
    return { rowsUpdated };
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * CLI entry — dry-run by default.
 * - Offline (no DATABASE_URL): architecture + SQL only; never fake operational counts.
 * - DATABASE_URL set: dry-run queries live preflight (read-only).
 * - --apply: DML-only residual backfill with advisory lock + timeouts + progress.
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  const args = new Set(argv);
  const apply = args.has("--apply");
  const printSql = args.has("--print-sql") || !apply;
  const batchSizeArg = argv.find((a) => a.startsWith("--batch-size="));
  const batchSize = batchSizeArg
    ? Number(batchSizeArg.split("=")[1])
    : DEFAULT_BATCH_SIZE;

  if (!Number.isInteger(batchSize) || batchSize <= 0 || batchSize > 10000) {
    console.error(`Invalid --batch-size=${batchSize}`);
    process.exitCode = 2;
    return;
  }

  const databaseUrl = env.DATABASE_URL || env.SUPABASE_DB_URL;
  const workflow = describeDbPushWorkflow();

  console.log(
    JSON.stringify(
      {
        tool: "dam-core-taxonomy-safe-cutover",
        mode: apply ? "apply" : databaseUrl ? "dry-run-live" : "dry-run-offline",
        batchSize,
        ddlOwnership:
          "Schema DDL is only in migrations 20260723112910–20260723112940. This tool is DML-only.",
        unsafeMigration: UNSAFE_MIGRATION_VERSION,
        bridgeMigrations: BRIDGE_MIGRATION_VERSIONS,
        note:
          "Never repair 20260723113000 until the equivalent end-state is verified. Barrier 112940 blocks linear push into unsafe 113000 until that version is in the ledger.",
        workflow,
      },
      null,
      2,
    ),
  );

  if (!apply && !databaseUrl) {
    console.log(
      "\nOffline dry-run: no DATABASE_URL — not querying live state; not claiming operational residual counts.\n",
    );
    console.log(
      JSON.stringify(
        {
          evidenceMode: "offline",
          operationalCounts: null,
          message:
            "Supply DATABASE_URL for live preflight evidence. Offline mode prints SQL builders only.",
        },
        null,
        2,
      ),
    );
    if (printSql) {
      console.log("\n-- preflight SQL --\n" + buildPreflightSql());
      console.log("\n-- one asset batch SQL --\n" + buildAssetBatchSql(batchSize));
      console.log("\n-- final validation SQL --\n" + buildFinalValidationSql());
    }
    return;
  }

  if (!databaseUrl) {
    console.error(
      "Refusing --apply without DATABASE_URL or SUPABASE_DB_URL in the environment.",
    );
    process.exitCode = 2;
    return;
  }

  let pg;
  try {
    pg = await import("pg");
  } catch (err) {
    console.error(
      "The `pg` package is required when DATABASE_URL is set. Install it in a scratch dir or project and retry.",
      err,
    );
    process.exitCode = 2;
    return;
  }

  const client = new pg.default.Client({
    connectionString: databaseUrl,
    ssl: env.PGSSL === "0" ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  let lockHeld = false;
  try {
    if (apply) {
      const lockRes = await client.query(buildAdvisoryLockSql());
      const acquired = Boolean(lockRes.rows[0]?.acquired);
      if (!acquired) {
        console.error(
          "Refusing --apply: another dam-core-taxonomy-safe-cutover operator holds the advisory lock.",
        );
        process.exitCode = 1;
        return;
      }
      lockHeld = true;
    }

    const preflightRes = await client.query(buildPreflightSql());
    const row = preflightRes.rows[0];
    const decision = preflightFromRow(row, batchSize);
    console.log(
      JSON.stringify(
        {
          evidenceMode: "live-query",
          preflight: row,
          decision,
        },
        null,
        2,
      ),
    );

    if (!apply) {
      // Live dry-run: evidence only.
      if (printSql) {
        console.log("\n-- preflight already executed above --");
        console.log("\n-- one asset batch SQL (not executed) --\n" + buildAssetBatchSql(batchSize));
      }
      return;
    }

    if (decision.action === "abort") {
      process.exitCode = 1;
      return;
    }
    if (decision.action === "noop") {
      const validation = await client.query(buildFinalValidationSql());
      const verdict = evaluateFinalValidation(validation.rows[0]);
      const status = verdict.ok
        ? STATUS_END_STATE_COMPLETE
        : STATUS_DML_COMPLETE_SCHEMA_INCOMPLETE;
      console.log(
        JSON.stringify(
          {
            status,
            dmlOnly: true,
            finalValidation: verdict,
            note: verdict.ok
              ? "Full end-state complete"
              : "dml_complete_schema_incomplete: residuals clear but five core FKs/view not present — complete via migrations 112920–112930; not full success",
          },
          null,
          2,
        ),
      );
      // DML work is done either way; incomplete schema is migration work, not a DML failure.
      process.exitCode = 0;
      return;
    }

    const plan = buildPhasePlan(decision, batchSize);
    assertApplyPlanIsDmlOnly(plan);

    // Live residual-driven asset loop (resumable; reports updated + residual delta).
    let batchIndex = 0;
    for (;;) {
      const beforeRes = await client.query(buildResidualCountSql("assets"));
      const residualBefore = Number(beforeRes.rows[0].n);
      if (residualBefore === 0) break;

      batchIndex += 1;
      const t0 = Date.now();
      const { rowsUpdated } = await runDmlTransaction(
        client,
        buildAssetBatchSql(batchSize),
        {},
      );
      const afterRes = await client.query(buildResidualCountSql("assets"));
      const residualAfter = Number(afterRes.rows[0].n);
      const progress = evaluateForwardProgress({
        residualBefore,
        residualAfter,
        rowsUpdated,
        label: `assets batch ${batchIndex}`,
      });
      console.log(
        formatProgressEvidence({
          phase: "backfill_assets",
          batchIndex,
          batchSize,
          rowsUpdated,
          residualBefore,
          residualAfter,
          residualAssets: residualAfter,
          elapsedMs: Date.now() - t0,
        }),
      );
      if (!progress.ok) {
        console.error(progress.reason);
        process.exitCode = 1;
        return;
      }
    }

    {
      const beforeRes = await client.query(buildResidualCountSql("style_groups"));
      const residualBefore = Number(beforeRes.rows[0].n);
      const t0 = Date.now();
      const { rowsUpdated } = await runDmlTransaction(
        client,
        buildStyleGroupsBackfillSql(),
        {},
      );
      const afterRes = await client.query(buildResidualCountSql("style_groups"));
      const residualAfter = Number(afterRes.rows[0].n);
      if (residualBefore > 0) {
        const progress = evaluateForwardProgress({
          residualBefore,
          residualAfter,
          rowsUpdated,
          label: "style_groups",
        });
        if (!progress.ok) {
          console.error(progress.reason);
          process.exitCode = 1;
          return;
        }
      }
      console.log(
        formatProgressEvidence({
          phase: "backfill_style_groups",
          rowsUpdated,
          residualBefore,
          residualAfter,
          residualStyleGroups: residualAfter,
          elapsedMs: Date.now() - t0,
        }),
      );
    }

    {
      const beforeRes = await client.query(buildResidualCountSql("bakeoff"));
      const residualBefore = Number(beforeRes.rows[0].n);
      const t0 = Date.now();
      const { rowsUpdated } = await runDmlTransaction(
        client,
        buildBakeoffBackfillSql(),
        {},
      );
      const afterRes = await client.query(buildResidualCountSql("bakeoff"));
      const residualAfter = Number(afterRes.rows[0].n);
      if (residualBefore > 0) {
        const progress = evaluateForwardProgress({
          residualBefore,
          residualAfter,
          rowsUpdated,
          label: "bakeoff",
        });
        if (!progress.ok) {
          console.error(progress.reason);
          process.exitCode = 1;
          return;
        }
      }
      console.log(
        formatProgressEvidence({
          phase: "backfill_bakeoff",
          rowsUpdated,
          residualBefore,
          residualAfter,
          residualBakeoff: residualAfter,
          elapsedMs: Date.now() - t0,
        }),
      );
    }

    const validation = await client.query(buildFinalValidationSql());
    const residualOk =
      Number(validation.rows[0].bad_asset_licensors) +
        Number(validation.rows[0].bad_asset_properties) +
        Number(validation.rows[0].bad_sg_licensors) +
        Number(validation.rows[0].bad_sg_properties) +
        Number(validation.rows[0].bad_bakeoff_properties) ===
      0;
    const fullVerdict = evaluateFinalValidation(validation.rows[0]);
    const status = !residualOk
      ? "dml_residuals_remain"
      : fullVerdict.ok
        ? STATUS_END_STATE_COMPLETE
        : STATUS_DML_COMPLETE_SCHEMA_INCOMPLETE;
    console.log(
      JSON.stringify(
        {
          status,
          dmlResidualsCleared: residualOk,
          finalValidation: fullVerdict,
          note: residualOk
            ? fullVerdict.ok
              ? "Full end-state complete"
              : "dml_complete_schema_incomplete: DML residuals clear; five core FKs/view not yet present — complete via migrations 112920–112930; not full success"
            : "DML residuals remain — re-run after fixing mapping issues",
        },
        null,
        2,
      ),
    );

    if (!residualOk) {
      process.exitCode = 1;
      return;
    }

    console.log(
      JSON.stringify(
        {
          status,
          dmlOnly: true,
          fullEndState: fullVerdict.ok,
          ledgerNote: fullVerdict.ok
            ? "DML tool does not write schema_migrations. End-state verified; after owner approval: supabase migration repair --status applied 20260723113000. Barrier 112940 then passes; never repair before end-state exists."
            : "DML residuals are clear (dml_complete_schema_incomplete). Do not claim full success and do not repair 113000 until migrations 112920–112930 produce five core FKs + dam_character_catalog and validation proves them.",
        },
        null,
        2,
      ),
    );
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // ignore
    }
    console.error(err);
    process.exitCode = 1;
  } finally {
    if (lockHeld) {
      try {
        await client.query(buildAdvisoryUnlockSql());
      } catch {
        // ignore
      }
    }
    await client.end();
  }
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
