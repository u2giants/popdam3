#!/usr/bin/env node
// Operational runner for the GUARDED RECURRING PROMOTION of ColdLion source-owned
// Licensor/Property fields (accelerated plan Step 7A item 3).
//
// WHERE THIS SITS IN THE RECURRING CYCLE
//   1. `coldlion` lane — tools/sync-coldlion-licensors-properties.mjs refreshes the typed
//      mirror (mirror_only). It never touches core.*.
//   2. `promote` lane — THIS runner. It reads the refreshed mirror + the approved links,
//      computes a promotion plan, and asks the database to apply it.
//   3. `compare` / `health` lanes — unchanged.
//
// TWO INDEPENDENT COMPUTATIONS, AND DISAGREEMENT IS FATAL
// ------------------------------------------------------
// This runner computes the plan in JavaScript (tools/coldlion-recurring-promotion.mjs,
// pure and unit-tested row by row) and sends it to plm.promote_coldlion_source_owned,
// which recomputes the SAME decisions in SQL from the same tables and aborts if the two
// disagree. That is deliberate redundancy: the highest-risk failure in this whole workstream
// is not ColdLion being wrong, it is OUR mapping/promotion logic being wrong. One
// implementation cannot catch its own bug; two that must agree can.
//
// THE PLAN CARRIES TWO CROSS-CHECKED SETS, NOT ONE (corrected 2026-07-31)
// ----------------------------------------------------------------------
// `promotions` is the curated-name set. `provenance_refreshes` is every row whose
// core.taxonomy_source_ref.source_name / .source_code the database will rewrite — which is a
// WIDER set, because provenance is refreshed on a source_code-only drift and on rows whose
// curated name is held for review. Until 2026-07-31 only `promotions` was compared, so those
// two write paths were applied with nothing checking them (GLM-5.2 review of PR #331).
// A plan without a `provenance_refreshes` key is now REFUSED by the database as an
// out-of-date runner, rather than silently accepted under the old, narrower assertion.
//
// WHAT IT CAN AND CANNOT CHANGE
//   Can : core.taxonomy_source_ref.source_name / .source_code  (always, for valid links)
//         core.licensor.name / core.property.name              (only under the one approved
//                                                               normalized-equivalent rule)
//   Cannot: canonical UUIDs, core.property.licensor_id, lifecycle status, canonical codes,
//         creating a canonical row, deleting one, or inactivating one that ColdLion stopped
//         sending. ColdLion's API supplies neither the parent edge nor a lifecycle flag, so
//         it is not entitled to assert either.
//
// FAIL CLOSED, LOUDLY, AND DURABLY
// A protected-invariant failure raises inside the database transaction, so the cycle rolls
// back whole — the canonical layer is never left partially promoted. Because that rollback
// would also erase an in-transaction breaker trip, this runner then records a critical
// alert in a SEPARATE transaction (the established PR #107 durable-failure pattern); the
// existing coldlion_autotrip_on_critical_alert trigger trips the breaker from there, which
// blocks every subsequent promotion until an authorized reset.
//
// Usage:
//   node tools/promote-coldlion-source-owned.mjs                        # dry-run: print the plan + SQL
//   node tools/promote-coldlion-source-owned.mjs --apply --linked       # preview
//   node tools/promote-coldlion-source-owned.mjs --apply --linked \
//        --production --production-authorized --project-ref qsllyeztdwjgirsysgai
//
// ONE PROMOTION AT A TIME, AND A SKIP IS NOT A FAILURE
// ----------------------------------------------------
// The scheduled lane and a manual drill can both reach the database at once, so
// plm.promote_coldlion_source_owned takes transaction-scoped advisory lock 720260729
// (docs/advisory-lock-registry.md) as its very first statement. A caller that cannot take
// it does not wait and does not silently no-op: it commits a CANCELLED ingest.sync_run row
// with metadata.outcome = skipped_already_running and returns mode = skipped_already_running.
//
// This runner reports that as its own exit code, 3 — deliberately distinct from BOTH success
// (0) and failure (1). It must never take the failure path for a skip, because that path
// records a durable FAILED sync_run row and calls record_taxonomy_sync_alert, and two
// consecutive failed rows fire the pg_notify breaker (tools/coldlion-sync-common.mjs
// buildFailedSyncRunSql). Two healthy overlapping cycles would then trip the breaker and
// block promotion until an authorized reset — an outage manufactured out of a normal race.
//
// A CLIENT-SIDE TOOLING FAULT IS NOT A SYNC FAILURE EITHER (added 2026-07-31, backlog B14)
// -----------------------------------------------------------------------------------------
// The same reasoning applies to a fault at the SPAWN boundary: if the Supabase CLI or psql
// could not be executed at all (ENOENT, ENOBUFS, EACCES — the cases where Node sets
// result.error), the database was never asked anything and cannot have failed. runSql tags
// those CLIENT_SPAWN_FAULT and this runner exits 4 without recording a durable failed row or
// an alert. Previously an ENOBUFS from this repo's own buffering defect wrote a failed row,
// and two in a row auto-tripped the breaker — a production outage manufactured out of a
// client-side bug and blamed on the data. An EXTERNAL signal kill is deliberately NOT in that
// set: on Linux it leaves result.error undefined, so it takes the recorded-failure path.
//
// AND NEITHER IS A BENIGN MID-READ SNAPSHOT RACE (added 2026-07-31, backlog B14 review)
// -------------------------------------------------------------------------------------
// The cycle state is read as several bounded pages, so the mirror lane can commit a new
// snapshot part-way through. That is the same healthy-overlap class as the lane-lock skip
// above. The read restarts from page 0 once; if it is still racing after that, the runner
// exits 5 having promoted and recorded NOTHING. Recording it would let two unlucky overlaps
// in consecutive cycles auto-trip the breaker on a completely healthy feed.
//
// Exit codes: 0 promoted (or clean no-op), 1 refused/failed, 2 unparseable result,
//             3 skipped because another promotion already holds the lane lock,
//             4 client-side tooling fault (nothing recorded, breaker untouched),
//             5 benign mid-read snapshot race (nothing recorded, breaker untouched).

import { readLinkedProjectRefSync, repoRootFrom } from "./check-supabase-link-state.mjs";

import { pathToFileURL } from "node:url";
import {
  buildFailedSyncRunSql,
  isClientSpawnFault,
  runSql,
  sqlDollarQuote,
} from "./coldlion-sync-common.mjs";
import {
  PREVIEW_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertNoProductionEnv,
  assertPreviewApplyTarget,
  resolveRunMode,
} from "./phase6-preview-guards.mjs";
import {
  assertColdlionApplyTarget,
  describeAuthorizedTarget,
  resolveProductionAuthorization,
} from "./coldlion-production-authorization.mjs";
import { parsePhase6FunctionResult } from "./phase6-cli-result-parse.mjs";
import {
  HUMAN_RESPONSE_OWNER,
  PROMOTION_MODE,
  PROMOTION_RULE_ID,
  planRecurringPromotion,
} from "./coldlion-recurring-promotion.mjs";
import {
  APPROVED_COUNT,
  APPROVED_DISTINCT,
  APPROVED_HASH,
} from "./run-coldlion-licensor-property-phase4.mjs";

export const SOURCE_NAME = "coldlion_licensors_properties_promote_source_owned";

/**
 * The transaction-scoped advisory lock key that serializes the promotion lane, mirrored
 * from the migration so a test can prove the two never drift apart. Registered in
 * docs/advisory-lock-registry.md.
 */
export const PROMOTION_ADVISORY_LOCK_KEY = 720260729;

/** The exact `mode` the database returns when it lost the race for that lock. */
export const SKIPPED_ALREADY_RUNNING_MODE = "skipped_already_running";

/** Exit code for that outcome — distinct from success (0) and from failure (1). */
export const EXIT_SKIPPED_ALREADY_RUNNING = 3;

/**
 * Exit code for a CLIENT-SIDE tooling fault (the Supabase CLI / psql could not be executed at
 * all: ENOENT, ENOBUFS, EACCES — an external signal kill is excluded, see
 * CLIENT_SPAWN_FAULT_CODE). Distinct from success (0), from a real failure (1),
 * from unparseable (2) and from a lane skip (3), because it must take NEITHER the success path
 * NOR the failure path. The failure path records a durable failed `ingest.sync_run` row and a
 * critical alert, and two consecutive failed rows auto-trip the circuit breaker — so letting a
 * defect in OUR tooling down that path manufactures a production outage out of a client-side
 * bug and blames the database for it. The job still did not run, so it is not success either.
 */
export const EXIT_CLIENT_TOOLING_FAULT = 4;

/**
 * Exit code for a benign READ RACE: the ColdLion mirror lane committed a new snapshot while
 * this runner was paging the cycle state, and it was still doing so after the bounded retry.
 *
 * Like EXIT_SKIPPED_ALREADY_RUNNING, this is NOT a failure and must never be recorded as one.
 * Two healthy lanes overlapping is the normal-race class that exit 3 already exists for; if a
 * mid-read snapshot could write a durable failed row, two unlucky overlaps in consecutive
 * cycles would auto-trip the breaker on a completely healthy feed — the exact defect class
 * backlog B14 exists to remove, arriving through a different door. Nothing was promoted and
 * nothing was recorded; the next scheduled cycle reads a settled mirror.
 */
export const EXIT_CYCLE_STATE_RACE = 5;

/**
 * WORST-CASE serialized bytes for ONE cycle-state row, used to derive the page size.
 *
 * MEASURED, NOT ESTIMATED. tools/coldlion-cycle-state-paging.test.mjs rebuilds the exact probe
 * row shape from the REAL ColdLion rows committed at
 * docs/verification/coldlion-licensor-property-phase2b-20260724/{licensors,properties}.csv
 * (570 real rows) and asserts the largest one still fits inside this budget. Measured on that
 * data: mean 496 bytes, p95 536, MAX 581. That mean independently reproduces the incident
 * figure — 1,305,075 recorded bytes / 496 = ~2,630 mirror rows — which is what makes it
 * trustworthy rather than a guess.
 *
 * 2048 is ~3.5x the largest real row, so every text field in the widest row observed could
 * more than triple before the budget is wrong. The test re-measures on every CI run, so growth
 * in the real data cannot silently invalidate it.
 */
export const CYCLE_STATE_MAX_ROW_BYTES = 2048;

/**
 * Target bytes for one page: HALF of Node's 1 MiB spawnSync default. Deliberately sized against
 * the DEFAULT rather than against the raised ceiling, so a page fits even on a hypothetical
 * path where maxBuffer was never applied.
 */
export const CYCLE_STATE_PAGE_TARGET_BYTES = 512 * 1024;

/**
 * Rows per probe response — DERIVED from the two constants above, never hand-tuned. The payload
 * is bounded by this constant instead of by the number of ColdLion licensors, properties and
 * source refs, which only ever goes up.
 *
 * Note what this is and is NOT load-bearing for: since runSql now applies the same 256 MiB
 * maxBuffer on BOTH the psql and the Supabase-CLI paths, correctness no longer depends on this
 * arithmetic at all. The budget keeps pages small and predictable; the ceiling is what makes
 * being wrong about the budget survivable.
 */
export const CYCLE_STATE_PAGE_SIZE = Math.floor(
  CYCLE_STATE_PAGE_TARGET_BYTES / CYCLE_STATE_MAX_ROW_BYTES,
);

/** Refuse to loop forever if the database keeps handing back full pages. */
export const CYCLE_STATE_MAX_PAGES = 10000;

/**
 * How many times the whole paged read may be attempted. A new mirror snapshot landing mid-read
 * invalidates the pages already collected, so the read restarts from page 0 against the new
 * snapshot — ONCE. Bounded on purpose: an unbounded retry against a lane that is committing
 * snapshots faster than this runner can page would spin forever.
 */
export const CYCLE_STATE_MAX_ATTEMPTS = 2;

/** Tag for the benign mid-read snapshot race, so the runner can refuse to record it. */
export const CYCLE_STATE_RACE_CODE = "CYCLE_STATE_RACE";

/** Is this the benign read race rather than a genuine fault? */
export function isCycleStateRace(error) {
  return error?.code === CYCLE_STATE_RACE_CODE;
}

export { PROMOTION_MODE, PROMOTION_RULE_ID, HUMAN_RESPONSE_OWNER };

// =====================================================================================
// Pure SQL builders (unit-testable without a database)
// =====================================================================================

/**
 * Read this cycle's mirror + approved-link state. `present_this_cycle` is derived from the
 * mirror row's last_sync_run_id matching the most recent SUCCESSFUL mirror_only run — not
 * from a timestamp window. A time window would call a delayed snapshot "missing" and a
 * stale one "present"; the run id cannot be wrong about which snapshot a row came from.
 */
export function buildCycleStateSql({ offset = 0, limit = CYCLE_STATE_PAGE_SIZE } = {}) {
  if (!Number.isInteger(offset) || offset < 0) throw new Error(`invalid probe offset ${offset}`);
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`invalid probe limit ${limit}`);
  return `with snapshot as (
  select id from ingest.sync_run
  where source_name = 'coldlion_licensors_properties_api' and status = 'succeeded'
  order by started_at desc nulls last limit 1
),
mirror as (
  -- PAGED WINDOW. This probe used to return the ENTIRE ColdLion mirror as one buffered JSON
  -- document; every layer it crossed (the CLI's buffer, Node's spawnSync maxBuffer, the
  -- string, the parsed object) scaled linearly with the row count, and raising maxBuffer only
  -- moved that cliff. The window is applied HERE, on the union, because the selection
  -- predicate below uses only mirror columns — so no join has to be evaluated for rows
  -- outside the page, and the payload is bounded by CYCLE_STATE_PAGE_SIZE instead of by the
  -- size of the mirror. Aggregating server-side was NOT an option: the planner in
  -- coldlion-recurring-promotion.mjs decides row by row and genuinely needs every row.
  select * from (
    select 'licensor'::text as entity_type, company_code, division_code, mg_type_code, mg_code,
           name as source_name, source_active, licensor_id as canonical_id, resolution_status, last_sync_run_id
    from plm.erp_licensor
    union all
    select 'property'::text, company_code, division_code, mg_type_code, mg_code,
           name, source_active, property_id, resolution_status, last_sync_run_id
    from plm.erp_property
  ) u
  where u.resolution_status = 'manually_matched'
     or u.last_sync_run_id = (select id from snapshot)
  order by u.entity_type, u.company_code, u.division_code, u.mg_type_code, u.mg_code
  offset ${offset} limit ${limit}
)
select jsonb_build_object(
  'ok', true,
  'snapshot_run_id', (select id from snapshot),
  'page_offset', ${offset}::bigint,
  'page_limit', ${limit}::bigint,
  'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'entityType', m.entity_type,
      'company', m.company_code,
      'division', m.division_code,
      'mgTypeCode', m.mg_type_code,
      'mgCode', m.mg_code,
      'name', m.source_name,
      'source_active', m.source_active,
      'resolution_status', m.resolution_status,
      -- coalesce to FALSE, matching the database's FIX 4. A NULL last_sync_run_id must mean
      -- "not present this cycle", never "unknown" — an unknown here would reach JavaScript
      -- as null and silently take neither branch.
      'present_this_cycle', coalesce(m.last_sync_run_id = (select id from snapshot), false),
      'canonical_id', m.canonical_id,
      'canonical_name', c.canonical_name,
      'canonical_code', c.canonical_code,
      'canonical_status', c.canonical_status,
      'canonical_licensor_id', c.canonical_licensor_id,
      'higher_status_authority', exists (
        select 1 from core.taxonomy_owner_ruling o
        where o.entity_schema = 'core' and o.entity_table = m.entity_type and o.entity_id = m.canonical_id
      ) or exists (
        select 1 from core.taxonomy_source_ref hs
        where hs.entity_schema = 'core' and hs.entity_table = m.entity_type and hs.entity_id = m.canonical_id
          and hs.source_system not in ('coldlion', 'designflow_plm')
      ),
      'source_ref_id', r.id,
      'source_ref_name', r.source_name,
      -- The provenance layer's stored source_code. Without it the runner cannot predict the
      -- source_code refresh the database performs, and the Step 5.6 cross-check of that
      -- write would have nothing to compare against.
      'source_ref_code', r.source_code)
      order by m.entity_type, m.company_code, m.division_code, m.mg_type_code, m.mg_code)
    from mirror m
    left join lateral (
      select l.name as canonical_name, l.code as canonical_code,
             l.status::text as canonical_status, null::uuid as canonical_licensor_id
      from core.licensor l where m.entity_type = 'licensor' and l.id = m.canonical_id
      union all
      select p.name, p.code, p.status::text, p.licensor_id
      from core.property p where m.entity_type = 'property' and p.id = m.canonical_id
    ) c on true
    left join core.taxonomy_source_ref r
      on r.source_system = 'coldlion'
     and r.source_id = m.company_code || '/' || m.division_code || '/' || m.mg_type_code || '/' || m.mg_code
    where m.resolution_status = 'manually_matched'
       or m.last_sync_run_id = (select id from snapshot)
  ), '[]'::jsonb)
) as cycle;\n`;
}

/**
 * Read the WHOLE cycle state as a sequence of bounded pages and stitch it back together.
 *
 * Two guards, both of which fail CLOSED, because offset paging over a table another lane can
 * write to is only safe if you check that it did not move underneath you:
 *   1. every page must report the SAME `snapshot_run_id`; a change means a new mirror snapshot
 *      landed mid-read, so the pages describe two different cycles;
 *   2. no typed key may appear twice; a duplicate means the ordered window shifted, which also
 *      means some other row was skipped entirely — and a silently skipped row would look to the
 *      planner exactly like a record ColdLion stopped sending.
 *
 * Returns null (not a throw) when a page is unparseable, preserving the runner's existing
 * exit-2 behaviour for that case.
 */
export function readCycleState({
  linked = false,
  pageSize = CYCLE_STATE_PAGE_SIZE,
  runSqlImpl = runSql,
  parse = parsePhase6FunctionResult,
} = {}) {
  let attempts = 0;
  let last = null;

  while (attempts < CYCLE_STATE_MAX_ATTEMPTS) {
    attempts += 1;
    last = readCycleStatePass({ linked, pageSize, runSqlImpl, parse });
    if (!last.restart) return last.cycle; // may legitimately be null (unparseable -> exit 2)
    // The pages collected so far describe a mirror that moved underneath them. They are
    // discarded WHOLE and the read restarts from page 0 — never stitched together, and never
    // allowed to proceed on partial data.
  }

  if (last.kind === "snapshot") {
    // Still racing after the bounded retry. BENIGN: the mirror lane is committing snapshots
    // faster than this runner can page. Tagged so the caller refuses to record it as a failure —
    // otherwise two unlucky overlaps in consecutive cycles would auto-trip the breaker on a
    // completely healthy feed, which is the very defect class B14 exists to remove.
    const error = new Error(
      `the ColdLion mirror snapshot changed mid-read on all ${CYCLE_STATE_MAX_ATTEMPTS} attempts ` +
        `(${last.detail}); aborting without promoting. This is a benign overlap with the mirror ` +
        "lane, not a database fault, and is NOT recorded as a sync failure.",
    );
    error.code = CYCLE_STATE_RACE_CODE;
    throw error;
  }

  // A duplicate key that survives a clean restart is NOT a benign race: the snapshot held still
  // and the ordered window shifted anyway, so the read itself is broken (a non-deterministic
  // ORDER BY, or rows mutating inside a settled snapshot). A shifted window also means some
  // OTHER row was skipped entirely, and a skipped row looks to the planner exactly like a
  // record ColdLion stopped sending. That is a real fault: loud, durable and recorded.
  throw new Error(
    `cycle-state paging returned a duplicate typed key on all ${CYCLE_STATE_MAX_ATTEMPTS} ` +
      `attempts (${last.detail}); the ordered window is not stable, so at least one other row ` +
      "was skipped. Failing closed.",
  );
}

/**
 * ONE full paged read. Returns `{restart:true, kind, detail}` when the read must be abandoned
 * and retried from page 0, otherwise `{restart:false, cycle}`.
 */
function readCycleStatePass({ linked, pageSize, runSqlImpl, parse }) {
  const rows = [];
  const seenKeys = new Set();
  let snapshotRunId = null;
  let pages = 0;

  for (let offset = 0; ; offset += pageSize) {
    if (pages >= CYCLE_STATE_MAX_PAGES) {
      throw new Error(
        `cycle-state probe exceeded ${CYCLE_STATE_MAX_PAGES} pages of ${pageSize} rows; refusing to loop`,
      );
    }
    const page = parse(runSqlImpl(buildCycleStateSql({ offset, limit: pageSize }), { linked }), {
      requiredKey: "ok",
    });
    if (!page) return { restart: false, cycle: null };
    pages += 1;

    if (pages === 1) {
      snapshotRunId = page.snapshot_run_id ?? null;
    } else if (String(page.snapshot_run_id ?? "") !== String(snapshotRunId ?? "")) {
      return {
        restart: true,
        kind: "snapshot",
        detail: `${snapshotRunId} -> ${page.snapshot_run_id}`,
      };
    }

    const pageRows = Array.isArray(page.rows) ? page.rows : [];
    for (const row of pageRows) {
      // NUL separator: these key parts are Postgres text values, which cannot contain NUL, so
      // the concatenation is injective — two different key tuples can never alias into one
      // string and mask a genuine duplicate.
      const key = [row?.entityType, row?.company, row?.division, row?.mgTypeCode, row?.mgCode].join(
        " ",
      );
      if (seenKeys.has(key)) {
        return { restart: true, kind: "duplicate", detail: key.replace(/ /g, "/") };
      }
      seenKeys.add(key);
      rows.push(row);
    }

    if (pageRows.length < pageSize) break;
  }

  return {
    restart: false,
    cycle: { ok: true, snapshot_run_id: snapshotRunId, rows, pages_fetched: pages },
  };
}

export function buildPromoteSql(plan, { isDrill = false } = {}) {
  const expected = {
    hash: APPROVED_HASH,
    count: APPROVED_COUNT,
    distinct_canonical: APPROVED_DISTINCT,
  };
  return `select * from public.promote_coldlion_source_owned(
  ${sqlDollarQuote("cl_expected", expected)}::jsonb,
  ${sqlDollarQuote("cl_plan", plan)}::jsonb,
  ${isDrill ? "true" : "false"});\n`;
}

/**
 * Split the database's cycle state into the three inputs the pure planner takes.
 * `sourceRows` = what ColdLion sent this cycle. `linkedRows` = the approved links that
 * exist, whether or not ColdLion sent them — that is what makes an ABSENT record visible
 * as a review item instead of silently disappearing.
 *
 * `provenanceRows` = rows that are BOTH present this cycle AND approved-linked, which is the
 * exact scope of the database's provenance write. It has to be derived HERE, from the intact
 * row, rather than by intersecting the first two lists afterwards: sourceRows and linkedRows
 * are filtered on different predicates, so a typed key can appear in both while the two
 * entries come from DIFFERENT mirror rows (one present but unlinked, one linked but absent).
 * Intersecting by key would claim a provenance write on a row the database never touches, and
 * the Step 5.6 cross-check would then fail-closed on a perfectly healthy cycle.
 */
export function splitCycleState(cycle) {
  const rows = Array.isArray(cycle?.rows) ? cycle.rows : [];
  const sourceRows = rows
    .filter((r) => r.present_this_cycle === true)
    .map((r) => ({
      company: r.company,
      division: r.division,
      mgTypeCode: r.mgTypeCode,
      mgCode: r.mgCode,
      entityType: r.entityType,
      name: r.name,
    }));
  const linkedRows = rows
    .filter((r) => r.resolution_status === "manually_matched")
    .map((r) => ({
      company: r.company,
      division: r.division,
      mgTypeCode: r.mgTypeCode,
      mgCode: r.mgCode,
      entityType: r.entityType,
      canonical_id: r.canonical_id,
      canonical_name: r.canonical_name,
      canonical_code: r.canonical_code,
      canonical_status: r.canonical_status,
      canonical_licensor_id: r.canonical_licensor_id,
      source_ref_name: r.source_ref_name,
    }));
  const provenanceRows = rows
    .filter((r) => r.present_this_cycle === true && r.resolution_status === "manually_matched")
    .map((r) => ({
      company: r.company,
      division: r.division,
      mgTypeCode: r.mgTypeCode,
      mgCode: r.mgCode,
      entityType: r.entityType,
      name: r.name,
      source_ref_id: r.source_ref_id ?? null,
      source_ref_name: r.source_ref_name,
      source_ref_code: r.source_ref_code,
    }));
  return { sourceRows, linkedRows, provenanceRows };
}

// Status planning is intentionally separate from the retired name/provenance planner.
// Only current, approved typed links participate. Duplicate division arms must agree;
// a durable owner ruling wins; unresolved identities never enter a canonical group.
export function planColdlionStatusChanges(rows = []) {
  const groups = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.present_this_cycle !== true || row?.resolution_status !== "manually_matched" || !row?.canonical_id) continue;
    const key = `${row.entityType}/${row.canonical_id}`;
    const group = groups.get(key) ?? { key, entity_type: row.entityType, canonical_id: row.canonical_id, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  const changes = [];
  const unchanged = [];
  const quarantines = [];
  for (const group of [...groups.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const flags = new Set(group.rows.map((row) => row.source_active));
    if ([...flags].some((flag) => typeof flag !== "boolean") || flags.size !== 1) {
      quarantines.push({ ...group, reason: "conflicting_or_missing_source_active" });
      continue;
    }
    if (group.rows.some((row) => row.higher_status_authority === true)) {
      quarantines.push({ ...group, reason: "higher_status_authority" });
      continue;
    }
    const desired_status = [...flags][0] ? "active" : "inactive";
    const decision = { key: group.key, entity_type: group.entity_type, canonical_id: group.canonical_id, desired_status };
    if (group.rows.every((row) => row.canonical_status === desired_status)) unchanged.push(decision);
    else changes.push(decision);
  }
  return { changes, unchanged, quarantines };
}

/**
 * Did the database report that another promotion already holds the lane advisory lock?
 *
 * Matched on the `mode` column value the function returns, which is the only thing the
 * database promises about this outcome. Deliberately NOT matched on the word "skipped"
 * alone: a quarantine reason, an audit decision_detail or a psql NOTICE could easily
 * contain that word, and reading a real failure as a benign skip is the dangerous
 * direction of this error — it would let a broken cycle exit 0-ish and never alert.
 */
export function isAlreadyRunningSkip(output) {
  return new RegExp(`\\b${SKIPPED_ALREADY_RUNNING_MODE}\\b`).test(String(output ?? ""));
}

/** The durable critical alert that survives the aborted promotion and trips the breaker. */
export function buildPromotionAlertSql(failedInvariant, detail) {
  // Named arguments on purpose: the function's positional order is
  // (severity, source_name, reason, ...) and a silent transposition of the first two would
  // record a well-formed alert with the wrong severity, which the breaker autotrip reads.
  return `select public.record_taxonomy_sync_alert(
  p_severity => 'critical',
  p_source_name => ${sqlDollarQuote("al_source", SOURCE_NAME)},
  p_reason => ${sqlDollarQuote("al_reason", `ColdLion recurring promotion refused: ${failedInvariant}`)},
  p_payload => ${sqlDollarQuote("al_payload", {
    failed_invariant: failedInvariant,
    detail: String(detail ?? "").slice(0, 3000),
    mode: PROMOTION_MODE,
    rule_id: PROMOTION_RULE_ID,
    human_response_owner: HUMAN_RESPONSE_OWNER,
    first_response:
      "Set COLDLION_LICENSOR_PROPERTY_PRODUCTION_ENABLED=false to stop the recurring lane, leave mirrors and evidence intact, compare the protected UUID/status/parent hashes, then reproduce and fix forward on preview via shared-db.",
  })}::jsonb);\n`;
}

function readLinkedProjectRef() {
  // #593: delegate to the shared reader. Same contract as the single-file read
  // it replaces -- the CLI-authoritative ref, or null when unlinked -- but a
  // `project-ref` / `linked-project.json` split is now REPORTED instead of
  // invisible, and `repoRootFrom` pins it to THIS checkout under the
  // agent-per-worktree model.
  return readLinkedProjectRefSync({ root: repoRootFrom(import.meta.url) });
}

// =====================================================================================
// Entry point
// =====================================================================================

export function main(argv = process.argv.slice(2), env = process.env) {
  const auth = resolveProductionAuthorization(argv, env);
  if (!auth.requested) assertNoProductionEnv(env);

  const mode = resolveRunMode(argv, env);
  const isDrill = argv.includes("--drill");
  const linkedProjectRef = mode.linked ? readLinkedProjectRef() : null;

  assertColdlionApplyTarget({
    apply: mode.apply,
    linked: mode.linked,
    connString: mode.connString,
    linkedProjectRef,
    argv,
    env,
    assertPreviewApplyTarget,
  });

  process.stdout.write(
    `${JSON.stringify(
      {
        tool: "promote-coldlion-source-owned",
        target: mode.target,
        authorized_target: describeAuthorizedTarget(argv, env),
        linked_project_ref: linkedProjectRef,
        mode: mode.apply ? "apply" : "dry-run (no DB write)",
        promotion_mode: PROMOTION_MODE,
        rule_id: PROMOTION_RULE_ID,
        is_drill: isDrill,
        approved_scope: {
          hash: APPROVED_HASH,
          count: APPROVED_COUNT,
          distinct_canonical: APPROVED_DISTINCT,
        },
        human_response_owner: HUMAN_RESPONSE_OWNER,
        preview_project_ref: PREVIEW_PROJECT_REF,
        production_project_ref: PRODUCTION_PROJECT_REF,
      },
      null,
      2,
    )}\n`,
  );

  if (!mode.apply) {
    process.stdout.write(buildCycleStateSql());
    process.stdout.write(
      `-- This is PAGE 1 of the cycle-state probe. --apply reads successive pages of ` +
        `${CYCLE_STATE_PAGE_SIZE} rows until a short page ends the read.\n`,
    );
    process.stdout.write(
      "Dry-run complete. No database write performed. Re-run with --apply --linked to promote.\n",
    );
    return 0;
  }

  let stage = "read-cycle-state";
  try {
    const cycle = readCycleState({ linked: mode.linked });
    if (!cycle) {
      process.stderr.write(
        "PROMOTION UNPARSEABLE: the cycle-state probe could not be parsed; failing closed with exit 2\n",
      );
      return 2;
    }
    if (!cycle.snapshot_run_id) {
      throw new Error(
        "no successful ColdLion mirror_only snapshot exists to promote; the recurring lane runs the snapshot first on purpose",
      );
    }

    stage = "plan";
    const { sourceRows, linkedRows, provenanceRows } = splitCycleState(cycle);
    const plan = planRecurringPromotion({ sourceRows, linkedRows, provenanceRows });
    plan.status = planColdlionStatusChanges(cycle.rows);

    process.stdout.write(
      `${JSON.stringify(
        {
          snapshot_run_id: cycle.snapshot_run_id,
          cycle_state_pages: cycle.pages_fetched,
          cycle_state_rows: cycle.rows.length,
          counts: plan.counts,
          quarantine_reasons: plan.quarantines.reduce((acc, q) => {
            acc[q.reason] = (acc[q.reason] ?? 0) + 1;
            return acc;
          }, {}),
          curated_name_changes: plan.promotions
            .filter((p) => p.curated_name_changed)
            .map((p) => ({ key: p.key, from: p.old_values, to: p.proposed_fields })),
          // Printed separately from curated_name_changes because these are the writes that
          // used to happen with no cross-check at all: source_code refreshes, and refreshes
          // of rows whose curated name is held for review.
          provenance_refreshes: plan.provenance_refreshes.map((p) => ({
            key: p.key,
            fields: p.fields,
          })),
        },
        null,
        2,
      )}\n`,
    );

    if (plan.refuse) {
      throw new Error(
        `protected-invariant violation in the computed plan: ${JSON.stringify(plan.protected_violations)}`,
      );
    }

    stage = "promote";
    const promoteOut = runSql(buildPromoteSql(plan, { isDrill }), { linked: mode.linked });
    process.stdout.write(promoteOut);

    // Checked BEFORE the refusal heuristic below. The skip message contains no "refused"
    // or "ABORTED", but keeping the order explicit means a future edit to that heuristic
    // cannot start swallowing skips into the failure path and tripping the breaker.
    if (isAlreadyRunningSkip(promoteOut)) {
      process.stdout.write(
        `PROMOTION SKIPPED: another promotion already holds advisory lock ${PROMOTION_ADVISORY_LOCK_KEY}, ` +
          `so this cycle did not read or write anything. The database committed a cancelled ` +
          `ingest.sync_run row under ${SOURCE_NAME} with metadata.outcome=${SKIPPED_ALREADY_RUNNING_MODE}.\n` +
          `This is NOT a failure: no durable failed row and no alert were recorded, so it does not ` +
          `count toward the two-consecutive-failure breaker. The next scheduled cycle promotes ` +
          `whatever this one deferred.\n`,
      );
      return EXIT_SKIPPED_ALREADY_RUNNING;
    }

    if (/protected|ABORTED|refused/i.test(promoteOut) && !/"protected_violations": *0/.test(promoteOut)) {
      // The database prints its refusal; treat anything that is not an explicit zero-violation
      // result as a failure rather than reading success into ambiguous output.
      process.stderr.write("PROMOTION: the database result does not confirm zero protected violations\n");
      return 1;
    }

    process.stdout.write(
      `PROMOTION COMPLETE: ${plan.counts.curated_name_changes} curated name change(s), ` +
        `${plan.counts.provenance_refreshes} provenance refresh(es) ` +
        `(${plan.counts.provenance_source_code_refreshes} touching source_code), ` +
        `${plan.counts.quarantines} quarantined for review, protected invariants unchanged.\n`,
    );
    return 0;
  } catch (error) {
    // A CLIENT-SIDE tooling fault is not the database failing, and must NEVER reach the durable
    // failure path below: that path writes a failed ingest.sync_run row and a critical alert,
    // and two consecutive failed rows auto-trip the coldlion_licensor_property breaker. An
    // ENOBUFS/ENOENT/EACCES in this repo's own tooling would then take down a healthy
    // production feed while blaming the data. Reported loudly and separately instead.
    if (isCycleStateRace(error)) {
      process.stderr.write(
        `CYCLE-STATE RACE at stage ${stage}: ${error.message}
` +
          `No durable failed ingest.sync_run row and no critical alert were recorded, so this ` +
          `does NOT count toward the two-consecutive-failure circuit breaker. Nothing was ` +
          `promoted and nothing partial was used. The next scheduled cycle reads a settled ` +
          `mirror and promotes whatever this one deferred.
`,
      );
      return EXIT_CYCLE_STATE_RACE;
    }

    if (isClientSpawnFault(error)) {
      process.stderr.write(
        `CLIENT TOOLING FAULT at stage ${stage}: ${error.message}\n` +
          `No durable failed ingest.sync_run row and no critical alert were recorded, so this ` +
          `does NOT count toward the two-consecutive-failure circuit breaker. Nothing was ` +
          `promoted. Fix the runner host (the Supabase CLI / psql could not be executed) and ` +
          `re-run; the database was never told anything was wrong because nothing was.\n` +
          `Human response owner: ${HUMAN_RESPONSE_OWNER}\n`,
      );
      return EXIT_CLIENT_TOOLING_FAULT;
    }

    // Durable, separate-transaction alert so the breaker trip survives the rollback.
    try {
      runSql(buildPromotionAlertSql(stage, error?.message ?? String(error)), { linked: mode.linked });
    } catch (alertErr) {
      process.stderr.write(
        `WARNING: could not record the durable promotion alert: ${alertErr?.message ?? alertErr}\n`,
      );
    }
    try {
      runSql(buildFailedSyncRunSql(SOURCE_NAME, stage, error?.message ?? String(error)), {
        linked: mode.linked,
      });
    } catch (recErr) {
      process.stderr.write(`WARNING: could not record durable failure: ${recErr?.message ?? recErr}\n`);
    }
    process.stderr.write(
      `ColdLion recurring promotion FAILED at stage ${stage}: ${error?.message ?? error}\n` +
        `Human response owner: ${HUMAN_RESPONSE_OWNER}\n`,
    );
    return 1;
  }
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) process.exitCode = main();
