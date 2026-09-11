# Implementation plan — database efficiency and Data API security

**Repository:** `u2giants/shared-db`

**Tracking issue:** [#2209](https://github.com/u2giants/shared-db/issues/2209)

**Created:** 2026-09-03

**Work class:** umbrella planning and evidence collection; later work splits by owner

**Handoff:** [`HANDOFF.d/2026-09-03T1608Z-edge-dev-codex-database-efficiency-plan.md`](HANDOFF.d/2026-09-03T1608Z-edge-dev-codex-database-efficiency-plan.md)

This plan was requested after the Supabase dashboard AI proposed performance, resource-use, and security changes. The plan itself authorizes no database write, migration, privilege change, statistics reset, infrastructure change, or application-data change.

## STATUS — read first

| Step | Deliverable | State | Evidence |
|---|---|---|---|
| 0 | Register the evidence-gated plan, handoff, router entry, and tracking issue | ✅ done 2026-09-03 | PR #2210 merged as `5c3bf67e767b6fcd85062f9cb98805535498d17f`; guarded merge run `33778748037`; exact-head Muse verdict ref recorded for `9cb7ad230f13697cb9e22e60dcd0c7c7434d8ce7` |
| 1 | Capture a reproducible production baseline and reconcile every advisor claim | ✅ done 2026-09-04 | Artifact: `docs/verification/database-efficiency/20260904T212459Z/baseline.md`; verbatim query log `queries.md`; two read-only runs (21:25:25Z and 21:31:01Z) with `run1/`, `run2/` extracts and `delta-run1-run2.txt`; 340 security findings confirmed rule-by-rule, `unused_index` moved 763 → 739. Two capture-list items remain open and are carried as named unknowns, not as done: the repository provenance of the five named functions (md5s are recorded so a later byte-comparison can settle it) and the application query sites behind the foreign keys (Step 5 candidate family 2, "Foreign keys"; see also the open technical question "Which of the 426 foreign-key findings participate in measured hot joins, parent maintenance, or cleanup?" — named by text rather than by line number, which rots) |
| 2 | Prove or disprove Data API exposure with role and HTTP behavior tests | ✅ done 2026-09-10 | Artifact: [`docs/verification/database-efficiency/20260910T002917Z/api-access-matrix.md`](docs/verification/database-efficiency/20260910T002917Z/api-access-matrix.md). All four layers captured, no row contents. Exposed schemas settled at the boundary (`public, graphql_public, api, crm, pim, core, app`), which retires the Step 1 unknown and clears the three RLS-disabled tables as unreachable (one demonstrated over HTTP, two on the catalog fact). `rls_enabled_no_policy` proven denied at count 0 on the two identities tested; `function_search_path_mutable` closed for security-definer functions. **`security_definer_view` and `materialized_view_in_api` REPRODUCED**: a PopDAM viewer reads 826 CRM accounts, 826 CRM customers, 15,742 PLM style-tracker rows and 22,045 style-guide file-group rows across the application boundary — filed as its own urgent issue. Still open, recorded as NOT MEASURED with cause: direct RPC execution of the 38 anon / 111 authenticated security-definer functions and the 78 trigger functions carrying EXECUTE, which needs preview fixtures because production is read-only for this session |
| 3 | Trace expensive rebuilds and projection churn to callers and changed-row sets | 🟨 partial 2026-09-10 — five of the gate's seven requirements met; **changed-row count** (unmet for `clear_style_group_batch`) and **query plan** (no write-side plan for any of the three write functions; none at all for `refresh_style_guide_matviews` and `sync_asset_effective_tags`) are NOT met | Original call graph: [`docs/verification/database-efficiency-callers/2026-09-04T2130Z/call-graph.md`](docs/verification/database-efficiency-callers/2026-09-04T2130Z/call-graph.md) + `callers.json` + `function-definitions.sql`; durable reconciliation: [`docs/verification/database-efficiency/20260910T140913Z/step-3-closeout.md`](docs/verification/database-efficiency/20260910T140913Z/step-3-closeout.md). The original graph measured all five caller/schedule/concurrency paths and the one-off 181 s population. Changed-row questions were resolved for three of the five by the independently governed, contract-tested migrations for #2213 (effective-tag set comparison), #2214 (unchanged-count predicate) and #2408 (guarded rebuild). `refresh_style_guide_matviews` never had a changed-row question (full refresh); its unique-index/freshness precondition was satisfied by the concurrent matview refresh that landed inside the **#2212** migration `20260905104802` via PR #2339, which is the evidence on which #2215 was closed — #2215 delivered no separate migration of its own. Still open, recorded as NOT MEASURED with cause: `clear_style_group_batch`'s changed-row count; the embedding lease/error path named in this step's own deliverable list (line 234), which was never traced; WAL delta and transaction duration (line 236); and the per-statement split and reader lock-wait time for the matview refresh. The write-side query plans were retired on the recorded read-only permission-boundary refusal, not measured. No unmeasured claim is treated as a new fix. |
| 4 | Implement and verify application-owned write-amplification reductions | ⬜ open | Separate app issues/PRs, deployed SHAs, and post-deploy deltas |
| 5 | Implement narrowly justified structural performance changes | ⬜ open | Separate `db-work` issues, preview proof, PRs, and exact production authorization |
| 6 | Harden RLS, policies, views, functions, and Auth configuration by contract | ⬜ open | Per-object access contract, negative/positive tests, and separate governed changes |
| 7 | Complete the dated index observation and maintenance/replication investigations | ⬜ open | #1966 delta on or after 2026-09-17 plus maintenance and WAL attribution reports |
| 8 | Prove end-to-end improvement and close or retain every finding explicitly | ⬜ open | Before/after workload report, CI, deployed SHA, live smoke tests, and advisor reconciliation |

**Fresh implementation starts at Step 4** (Steps 0-2 landed; Step 3 landed only in the partial scope certified in its closeout — see the STATUS table). **Step 3 is not finished.** Its unmeasured items stay open and are not carried into Step 4 as settled: `clear_style_group_batch`'s changed-row count; every write-side query plan; the embedding lease/error path; WAL delta and transaction duration; and the per-statement split and reader lock-wait time for the matview refresh. Do not start Step 4 on the assumption that any of those was measured. Use a fresh session at the boundaries after Steps 2, 4, 6, and 7; before starting a new phase, re-read this STATUS table and all remaining phases for drift.
---

# Part 1 — Why

## 1. Ultimate goal

The shared database should use less storage and computing capacity without slowing or breaking CRM, DAM, PM/PIM, DB Data Admin, or DesignFlow. Browser users must have exactly the access the business intends—no more and no less. When this program is complete, the costly work will process only what changed, every retained index and policy will have a documented purpose, maintenance will keep planner evidence trustworthy, and no privileged database object will be reachable by an unintended role.

Advisor notices and cumulative counters are leads, not acceptance evidence. Every change must preserve the capability it is meant to improve and must be justified by a measured workload or an explicit access contract. **If a step conflicts with this goal, the goal wins—stop and flag it.**

## 2. What this system is

`u2giants/shared-db` is the canonical public repository for the structure and cross-application contracts of POP Creations' shared Supabase/PostgreSQL backend. Production is the protected Supabase project whose API URL was re-verified read-only on 2026-09-03 as `https://qsllyeztdwjgirsysgai.supabase.co`. Preview is the protected `shared-db-schema-rehearsal` Supabase branch. CRM, DAM, PM/PIM, DB Data Admin, and PLM applications share these structures.

Durable schema, index, function, RLS, grant, and policy changes are authored here as forward-only migrations through the active shared-db orchestrator. Application request scheduling, batching, retries, polling, and ordinary row writes belong to each application repository. Supabase Auth configuration is a separate platform setting and needs its own explicit authority and verification.

## 3. What triggered this work

On 2026-09-03 the Supabase dashboard AI was asked how to improve performance or reduce resource use. It reported large relations, an `asset_effective_tags` full rebuild near 181 seconds, expensive style-group operations, hundreds of advisor findings, possible RLS overhead, uneven maintenance, and a possible security exposure involving 127 RLS-disabled tables.

This planning session rechecked production read-only. The size and expensive-function figures substantially reproduced, but the security and maintenance conclusions did not reproduce as stated. That mismatch is why the first phase is an evidence inventory rather than a bulk-fix migration.

## 4. Scope

### In this plan

1. Current Supabase security and performance advisor findings.
2. Real API reachability for anonymous, ordinary authenticated, intended application, service, and administrative roles.
3. Direct `auth.uid()`/similar RLS initialization overhead and overlapping permissive policies.
4. Security-definer views and functions, mutable function search paths, materialized views in the API, and leaked-password protection.
5. `public.asset_effective_tags`, style-group rebuild/clear/count operations, and style-guide materialized-view refreshes.
6. High-value unindexed foreign keys, duplicate indexes, and evidence-gated unused-index review.
7. Autovacuum/analyze visibility, dead tuples, wide rows, and Realtime/logical-replication/WAL attribution.
8. Application-owned write-amplification, scheduling, and batch-boundary fixes discovered by the investigation.
9. Preview rehearsal, exact-head review, production authorization, deployment, rollback, and live acceptance for each approved change.

### NOT in this plan

1. Blindly enabling RLS on every table, revoking broad access, or changing browser behavior without a per-object contract.
2. Adding all 426 currently advised foreign-key indexes.
3. Dropping any index because its lifetime `idx_scan` is zero.
4. Dropping an index on the four #1966 tables before the observation window closes on 2026-09-17.
5. Changing global PostgreSQL settings, scaling the Supabase project, changing the compute plan, or modifying production infrastructure.
6. Repacking, vacuum-full, reindexing, partitioning, or archiving a large table without separate evidence and authorization.
7. Moving licensed rows, sample contents, tokens, credentials, or private portal evidence into this public repository or an external reviewer prompt.
8. Treating a successful migration, preview apply, CI run, or advisor disappearance as application acceptance without live behavior proof.

---

# Part 2 — What we already know

## 5. Current state

### Live production facts re-verified read-only on 2026-09-03

- `public.assets`: 3,405,258,752 bytes total; 2,122,317,824-byte heap; 1,149,067,264 bytes of indexes; about 175,598 live rows. Autovacuum and autoanalyze both ran on 2026-09-03.
- `plm.dcp_metadata_asset`: 1,333,559,296 bytes total. Its cumulative table statistics currently report zero live tuples despite a planner estimate near 374,610; do not interpret that counter as an empty table.
- `public.asset_tags`: 1,237,778,432 bytes total; 759,234,560 bytes of indexes. Its cumulative table statistics also report zero live tuples despite a planner estimate near 2.17 million.
- `plm.nbcu_asset_metadata_value`: 1,043,570,688 bytes total; about 1.19 million planner-estimated rows.
- `public.style_guide_files`: 879,484,928 bytes total; fresh autovacuum/autoanalyze on 2026-09-02.
- `public.dam_search_documents`: 766,730,240 bytes total; 12,692 dead tuples; fresh autovacuum on 2026-09-03 and autoanalyze on 2026-09-03.
- `public.asset_effective_tags`: 546,750,464 bytes total; about 2,045,705 live and 261,433 dead tuples; 384,884,736 bytes of indexes; fresh autovacuum and autoanalyze on 2026-09-03.

The current live `pg_stat_statements` entries reproduce the dashboard AI's expensive-function numbers:

- `public.rebuild_style_groups_batch`: 3,973 calls, 2,982.5 ms mean, 11,849,391.9 ms total.
- `public.clear_style_group_batch`: 287 calls, 34,617.3 ms mean, 9,935,165.1 ms total.
- `public.refresh_style_guide_matviews`: 540 direct calls, 8,623.8 ms mean, 4,656,830.4 ms total, plus one PostgREST call.
- `public.refresh_style_group_counts_batch`: six observed all-group calls, 98,583.3 ms mean.

These are cumulative totals without a proven reset timestamp. They establish where to investigate, not current incident causality or the savings a proposed change will deliver.

### Current advisor census

The 2026-09-03 live advisor response contained:

- Performance: 426 unindexed foreign keys, 68 RLS initialization-plan notices, nine tables without primary keys, 763 unused-index notices, 125 multiple-permissive-policy notices, 22 duplicate-index notices, and one absolute Auth connection setting.
- Security: 55 RLS-enabled relations with no policy, 19 security-definer views, 99 mutable function-search-path notices, two materialized views in the API, 21 security-definer functions callable by `anon`, 143 callable by `authenticated`, and leaked-password protection disabled.

It did **not** return the claimed “127 RLS-disabled exposed tables” notice. A catalog privilege check found no RLS-disabled table with direct `anon` DML privilege across `app`, `core`, `crm`, `dam`, `dflow`, `dflow_prod`, `pim`, `plm`, and `public`; three RLS-disabled tables showed some `authenticated` DML privilege. This is still not an HTTP access proof because PostgREST's exposed-schema setting was not visible through the SQL session. Step 2 must test the actual API boundary without returning row data.

### Existing code and work already in flight

- `public.asset_effective_tags`, its two indexes, RLS policy, per-row sync trigger, initial population, and grants originate in `supabase/migrations/20260827183011_popdam_effective_asset_filters.sql:14-180,516-525`; the forward recovery is `20260830110517_popdam_effective_asset_filters.sql:16-180,524-533`.
- Current filter/count functions depend heavily on that projection, including migrations `20260831044913`, `20260831074401`, `20260831184547`, `20260831212757`, `20260831221607`, `20260901130428`, `20260901142825`, `20260902042548`, and `20260903075635`. Replacing the projection is out of scope unless those consumers retain equivalent behavior and measured speed.
- `public.rebuild_style_groups_batch` is last visibly replaced in `supabase/migrations/20260708150000_dam_strict_style_group_sku_regex.sql:11`; live `pg_get_functiondef` remains the authority because older baseline definitions also exist in `supabase/ci-bootstrap/010_pre_adoption_baseline.sql`.
- Baseline definitions and grants for `clear_style_group_batch`, `refresh_style_group_counts_batch`, and `refresh_style_guide_matviews` are recorded in `supabase/ci-bootstrap/010_pre_adoption_baseline.sql:2815,3732,3853,6986-7094`. Step 1 must locate their actual later migration provenance and compare it byte-for-byte with live definitions before planning edits.
- Issue #1966 already owns the evidence-gated unused-index investigation for `public.style_guide_files`, `public.dam_search_documents`, `public.assets`, and `plm.style_tracker_item_bridge`. Its baseline was captured on 2026-09-03 after `pg_stat_reset()` was correctly refused; the delta window closes on 2026-09-17. No counter reset or index drop may disturb it.
- Issue #2196 separately owns the ready structural proposal to select a measured fillfactor for `public.dam_search_documents` only. Do not duplicate or broaden it.
- Issue #2043 separately owns production-verifier coverage for real multi-file `DROP INDEX` batches and absence assertions. It must land before relying on the catalog verifier to prove an index is absent.
- The working checkout used to create this plan was an isolated worktree from current `origin/main` at `260c8ab29f60e6487c520f914c3423e4d4ce71b0`. No implementation, database write, privilege change, statistics reset, or application deployment has occurred in this planning session.

## 6. Key findings and root cause hypotheses

### Confirmed findings

1. The rebuild/clear/refresh family consumes much more cumulative execution time than ordinary small queries and deserves priority profiling.
2. `asset_effective_tags` has real churn and substantial index cost, but its current per-row trigger is already scoped to affected rows. The reported 181-second full population may be migration/bootstrap history rather than an ongoing full-rebuild path; the caller and timestamp must be proven.
3. Advisor volume is too large for safe blanket remediation. Many foreign keys sit on cold landing tables, and many zero-scan indexes have untrustworthy counters.
4. Current maintenance is active on several named large tables. The problem is inconsistent statistics visibility on other relations, not proof that autovacuum is globally broken.
5. RLS-disabled does not by itself prove Data API access; grants, exposed schemas, and HTTP behavior all matter. Conversely, a callable security-definer function can be risky even when its underlying table has RLS.
6. Duplicate indexes are safer candidates than zero-scan indexes only after definitions, constraint ownership, predicates, expressions, validity, and application query plans are compared.
7. WAL/logical-replication cost may be an effect of application and trigger write amplification. It must be attributed by timestamped deltas and subscriber/publication evidence before changing Realtime.

### Root-cause hypotheses to test, not assume

- Rebuild callers may repeat the same underlying refresh, send overlapping batches, or recompute unchanged style groups.
- Delete/reinsert behavior in `sync_asset_effective_tags()` may rewrite unchanged tag sets and generate dead tuples/WAL even though the trigger is row-scoped.
- Large child tables may have genuinely missing join/cleanup indexes; other advised foreign keys may never participate in costly parent changes or joins.
- RLS initialization notices may save CPU when stable auth calls are evaluated once, but policy consolidation can change OR semantics and access if performed mechanically.
- The WAL-heavy statement may belong to Supabase infrastructure rather than a query the applications can remove; application write reductions may still lower it indirectly.

## 7. Approaches considered and rejected

1. **REJECTED: apply the dashboard AI's list directly.** It combined confirmed measurements, generic advice, and at least one security conclusion that did not reproduce.
2. **REJECTED: enable RLS on every RLS-disabled table.** Some schemas are server-only or legacy, and RLS without the intended policies can cause outages while failing to address function/view exposure.
3. **REJECTED: call all RLS-disabled tables publicly exposed.** Current direct privileges contradict that blanket statement; HTTP behavior remains to be tested.
4. **REJECTED: add all missing foreign-key indexes.** Each index consumes storage and amplifies every write; only measured joins, parent maintenance, or queue behavior justify one.
5. **REJECTED: drop every duplicate or zero-scan index immediately.** Statistics may have been lost, rare workflows matter, and some apparent duplicates enforce constraints or differ by predicate/operator class/include columns.
6. **REJECTED: reset statistics to create a clean observation window.** The authorized attempt documented in #1966 was refused because the connected production role lacks privilege. A recorded baseline and later delta provide the needed answer without privilege escalation.
7. **REJECTED: lower fillfactor broadly.** #1966 proved several high-churn update paths modify indexed or predicate columns, making HOT impossible regardless of page space. #2196 is the narrow remaining candidate.
8. **REJECTED: partition/archive solely because a table is large.** Size alone is not a problem; retention authority, query shape, and lifecycle requirements must be established first.
9. **REJECTED: change global PostgreSQL, Realtime, or compute settings before workload attribution.** This can mask application amplification, raise cost, or break live features without removing the cause.
10. **REJECTED: run production `EXPLAIN ANALYZE` on unknown or mutating statements.** Use plain `EXPLAIN`, captured plans, or safe preview fixtures unless the exact production statement is proven read-only and bounded.

## 8. Design decisions

### Locked decisions — do not relitigate

1. **2026-09-03:** measure first; no blanket advisor remediation.
2. **Standing rule:** every structural change gets its own `db-work` issue, exact object claim, isolated worktree, preview rehearsal, pull request, and governed promotion. This umbrella plan is not permission to modify schema.
3. **Standing rule:** application scheduling, batching, retry, polling, and ordinary row-write fixes belong to their application repo, not the structural orchestrator.
4. **2026-09-03 / #1966:** do not reset counters or drop indexes on the four observed tables before 2026-09-17.
5. **2026-09-03 / #2196:** fillfactor investigation is limited to `public.dam_search_documents`; the other tables are not to receive speculative fillfactor changes.
6. Preserve effective-tag filtering, access boundaries, rare administrative workflows, import workflows, and queue semantics. A speedup that removes one is a regression.
7. Security tests record status codes, row counts capped at zero/one, and allowed/denied outcomes—never row contents from private or licensed tables.
8. Independent reviews receive schema and code only; no licensed data, secrets, or production rows.

### Open implementation decisions

1. Which exact objects become separate remediation issues after Steps 1–3. Criterion: reproduced risk/cost, known owner, explicit contract, and a measurable acceptance gate.
2. Whether an apparently duplicate index is removable or must be consolidated. Criterion: semantic identity plus full workload-window evidence and constraint ownership.
3. Whether `asset_effective_tags` should use unchanged-set comparison, statement-level transition tables, a durable changed-ID queue, or controlled staging/swap. Criterion: lowest write/WAL cost that preserves immediate consistency required by consumers.
4. Whether materialized-view refreshes can be coalesced. Criterion: documented staleness tolerance and no loss of freshness for user-facing flows.
5. Whether leaked-password protection should be enabled. This is an Auth/platform decision and requires Albert's explicit current authorization after user-impact and plan-tier checks.
6. Every production promotion remains an owner decision for the exact reviewed change; consolidate those asks by phase rather than requesting piecemeal approval.

---

# Part 3 — How to build it

## 9. Ordered implementation plan

### Phase A — establish truth and immediate security risk

#### Step 1 — capture a reproducible baseline and reconcile claims

Create `docs/verification/database-efficiency/<UTC>/baseline.md` and machine-readable companion files under the same directory. Use the approved read-only identity and prove the production target with `get_project_url` before every database read session. Capture:

- advisor notices grouped by rule, severity, schema, table/function/view, and remediation URL;
- relation heap/index/TOAST size, estimated rows, live/dead tuple counters, update/HOT counts, vacuum/analyze times, and relation options;
- `pg_stat_statements` query ID, normalized statement, calls, rows, total/mean execution time, block reads/writes, temp blocks, and WAL where available;
- available statistics-reset timestamp or an explicit “not derivable” state;
- every named function's live definition, owner, security mode, search path, grants, and repository provenance;
- index definitions including uniqueness, constraint ownership, predicates, expressions, include columns, validity, size, scans, tuples read/fetched;
- foreign-key child size, action, parent-change frequency if derivable, and known application query sites;
- publications/subscriptions/replication slots and only non-secret configuration needed to attribute Realtime/CDC.

Do not capture row contents or emit secret-bearing connection strings. Add a small reproducible read-only script under `scripts/database-efficiency/` only if manual extraction cannot be repeated safely; if code is added, give it unit tests with fixtures for NULL/unknown counters and quoted identifiers.

**Dependencies:** none.

**Verification gate:** a second read-only run produces the same schema of evidence; every dashboard AI claim maps to `confirmed`, `not reproduced`, `unknown`, or `superseded`, and no claim is inferred from a NULL/zero counter alone.

#### Step 2 — prove the actual Data API access boundary

Build `api-access-matrix.md` from four independent layers:

1. Supabase API exposed-schema configuration from the Management API/dashboard—not `current_setting`, which returned NULL in the SQL session.
2. Catalog grants for `anon`, `authenticated`, `service_role`, and application roles.
3. RLS enabled/forced state, policies by command/role, view `security_invoker`, function `prosecdef`, function search path, and EXECUTE grants.
4. Bounded HTTP behavior tests using the public API URL and protected test identities. Test metadata/denial only; use `HEAD`, `limit=0`, deliberately impossible identifiers, or transactionally isolated preview fixtures so no private row is returned.

For every 2026-09-03 advisor item involving `rls_enabled_no_policy`, `security_definer_view`, `materialized_view_in_api`, anonymous/authenticated security-definer execution, or mutable search paths, assign: intended role, intended operation, current catalog state, actual HTTP outcome, business owner, severity, and proposed remedy. Trigger functions that are not meant to be RPCs must be explicitly checked for direct EXECUTE exposure.

Open a separate urgent structural issue only for a reproduced unauthorized path. Its body must name exact objects, the denied/allowed contract, and privacy-safe proof; never paste returned rows. Auth leaked-password protection gets a separate owner decision and platform task, not a migration.

**Dependencies:** Step 1 inventory.

**Verification gate:** every alleged exposure has both catalog and HTTP evidence; negative controls are denied, positive controls still work, and the report contains no row data or credential values.

**Natural context cut:** start a fresh session after Step 2 and re-read Phases B–E.

### Phase B — find and remove application write amplification

#### Step 3 — trace rebuilds, projections, and refresh callers

Create a cross-repository call graph for:

- `public.rebuild_style_groups_batch(uuid,integer)`;
- `public.clear_style_group_batch(uuid,integer)`;
- `public.refresh_style_group_counts_batch(uuid[])` and its wrappers/triggers;
- `public.refresh_style_guide_matviews()`;
- `public.sync_asset_effective_tags()` and all triggers/population paths;
- any job that rebuilds `dam_search_documents` or repeatedly updates embedding leases/errors.

Search `u2giants/shared-db`, the current PopDAM repository, and any worker/DesignFlow repository named by the call sites. Record scheduler frequency, concurrency, batch key, retries, overlap, rows selected/changed/rewritten, whether unchanged values are written, transaction duration, locks, WAL delta, dead-tuple delta, and which refreshes repeat the same source change. Add phase-level timing and row-count instrumentation in preview first where existing telemetry cannot answer this; instrumentation must not log private values.

Specifically prove whether the 181-second `asset_effective_tags` population is recurring. Compare old/new tag sets and count no-op delete/inserts on a representative preview workload. For rebuild functions, compare keyset bounds with the query plan and identify full scans or repeated relationship derivation.

**Dependencies:** Step 1 query identities and function provenance. May run in parallel with non-urgent parts of Step 2 after the exposure test design is fixed.

**Verification gate:** every expensive operation has a named caller, trigger/schedule, input size, changed-row count, query plan, concurrency pattern, and timestamped cost. Any unknown remains explicitly unknown rather than becoming a proposed fix.

#### Step 4 — implement application-owned reductions

For each application-side cause, open an issue in the owning repository and implement there. Expected patterns, used only where Step 3 proves them:

- serialize only conflicting keys, not unrelated work;
- coalesce duplicate refresh requests;
- keyset-page by stable primary key;
- compute affected IDs once and reuse them;
- skip writes whose stored result is unchanged;
- refresh a materialized view once after a logical batch rather than per row/small page;
- preserve durable retries and make failure visible;
- bound concurrency without removing the original feature.

Add tests for duplicate delivery, overlapping batches, retry after partial failure, unchanged input, boundary keys, concurrent different-key work, and preservation of final counts/tags. Deploy by the owning repo's rules and record the deployed SHA.

**Dependencies:** a proven Step 3 cause and an owning repository. Independent app fixes may run in parallel.

**Verification gate:** focused tests and CI pass; deployed code serves the expected SHA; the same live workload shows fewer calls/rewrites/WAL or lower latency without missing tags, stale counts, broken search, or queue loss.

**Natural context cut:** start a fresh session after Step 4 and re-read Phases C–E.

### Phase C — narrowly justified structural performance changes

#### Step 5 — split and implement structural performance issues

The repo session turns each justified structural change into a separate issue with `db-work-scope`, exact objects, dependency order, and privacy-safe evidence, then leaves implementation to the active orchestrator. Candidate families:

1. **Rebuild/projection functions:** changed-ID input, unchanged-set comparison, staging/swap, or supporting indexes only after Step 3 proves the benefit and consistency contract.
2. **Foreign keys:** prioritize large child tables plus observed joins, parent deletes/updates, cleanup, or queue claims. Capture `EXPLAIN`/preview timing before and after. Do not equate FK enforcement with needing a child index.
3. **Duplicate indexes:** compare complete definitions and constraint dependencies. If truly redundant, use a new forward migration and the correct low-lock production method. #2043 must provide reliable absence verification first.
4. **Unused indexes:** defer the four #1966 tables until the 2026-09-17 delta. Other tables still need a dated workload window covering rare admin/import jobs.
5. **Fillfactor:** do not duplicate #2196. Any later table needs measured row width, free-slot math, HOT-eligible updates, disk-cost estimate, and after-window acceptance.
6. **Materialized views:** choose concurrent refresh only if a qualifying unique index and semantic contract exist; otherwise coalesce refresh timing rather than assume concurrency is safe.

Each issue must name its rollback. For a new index, rollback is a later governed drop after proving no dependency. For a dropped index, retain the exact `CREATE INDEX` definition and a bounded restore procedure. Never edit an applied migration.

**Dependencies:** Steps 3–4 for write-path changes; #2043 before index absence acceptance; #1966's date for its four tables.

**Verification gate:** each migration passes repository guards and focused contract tests, applies cleanly to shared preview, preserves representative application workflows, receives an independent exact-head review, and has a separate explicit production authorization before promotion.

### Phase D — enforce intended access efficiently

#### Step 6 — remediate confirmed policy and privileged-object problems

Group by business contract, not advisor rule:

- For a policy repeatedly evaluating stable auth helpers, change direct `auth.uid()`/`auth.role()` calls to a scalar subquery only after an equivalent-policy test proves identical allow/deny behavior.
- Consolidate permissive policies only where the OR-union of commands, roles, USING, and WITH CHECK remains exactly equivalent and understandable.
- Add indexes on RLS predicate columns only where representative plans show repeated scanning and the write/storage cost is justified.
- For an RLS-enabled table with no policy, determine whether “deny all client access” is intentional. If intentional, document and suppress/accept the finding rather than add a permissive policy.
- For a security-definer view, prefer `security_invoker` only when callers should be constrained by their own rights; otherwise retain definer behavior with explicit ownership, grants, and tests.
- For a security-definer function, revoke unintended EXECUTE, move it out of exposed schemas, or redesign it with validated inputs and a pinned safe search path. Trigger-only functions should not remain callable as public RPCs without an explicit reason.
- Pin safe function search paths without breaking extension/operator resolution; test quoted and mixed-case objects.
- Remove a materialized view from the API surface or revoke browser roles unless direct browser reads are an intended contract.

Write behavior tests for anonymous, ordinary authenticated without app access, each intended app role, service role, and admin. Cover SELECT and every mutating command/RPC the object exposes. Use preview fixtures with cleanup and no licensed data.

Leaked-password protection is handled only after Albert authorizes the exact Auth setting change. Verify plan availability, user impact, rollback, and a safe test-account flow before enabling it.

**Dependencies:** Step 2 contract matrix. Independent object families may be separate orchestrator claims when they do not overlap.

**Verification gate:** advisor finding is resolved or explicitly accepted with rationale; all negative and positive access tests pass in preview and after authorized production promotion; no application loses intended access.

**Natural context cut:** start a fresh session after Step 6 and re-read Phases E and Definition of Done.

### Phase E — dated observations, maintenance, replication, and final acceptance

#### Step 7 — finish index, maintenance, and WAL attribution

On or after 2026-09-17, follow #1966 exactly: re-read the same 73 indexes, subtract the 2026-09-03 baseline, and cover the full crawl/import/admin cycle. Classify each as used, not observed, counters unreliable, constraint-owned, or candidate. A candidate still needs code search and representative query-plan testing before a drop issue.

For maintenance, compare planner estimates with safe exact counts only where bounded; otherwise use relation estimates and application-owned inventory. Track autovacuum/analyze start/end, thresholds, scale factors, inserts/updates/deletes, dead tuples, freeze age, and long transactions. Tune per-table settings only when a table repeatedly misses a defined freshness/dead-tuple objective—not because one counter is NULL.

For WAL/Realtime, inventory publications, replication slots, subscriber lag, Realtime channels, and write-heavy application windows. Correlate WAL delta with rebuild/projection/job windows before and after Step 4. Do not disable Realtime, logical replication, or CDC as a tuning shortcut.

**Dependencies:** Step 1 baseline; the calendar gate and #1966. May proceed independently of Step 6 after the observation window closes.

**Verification gate:** the reports use deltas over named windows; every recommended change has a causal link and owner; no conclusion relies solely on lifetime zero/NULL counters.

#### Step 8 — prove the whole result and close the program

Build `docs/verification/database-efficiency/<final-UTC>/final-report.md` with:

- every original advisor/dashboard claim and final disposition;
- before/after calls, rows touched, p50/p95/p99 latency, CPU/IO/WAL where available, dead-tuple trend, table/index bytes, and error/timeout rates over comparable workload windows;
- access matrix before/after with no private row contents;
- every issue, PR, merge commit, preview apply, production authorization, production apply, deployed application SHA, CI run, independent review, and live smoke result;
- remaining accepted risks, deferred findings, and next measurement date;
- rollback outcome for any change that missed its acceptance threshold.

Update this STATUS table as each step lands; never mark a row done from an issue/PR number alone. Retire this handoff only when every open obligation is closed, transferred to an explicitly owned issue, or retained here with a dated reason.

**Dependencies:** all approved work from Steps 4–7.

**Verification gate:** representative live application journeys pass, no access regression exists, measurable resource/latency goals are met or changes are rolled back, and each advisor item is closed, accepted, or separately owned.

## 10. Tests required

### Inventory and tooling tests

- Fixture with NULL/zero cumulative counters must render `unknown`, never `zero activity` or `empty table`.
- Quoted identifiers, expression indexes, partial predicates, INCLUDE columns, invalid indexes, and constraint-owned indexes retain exact identity.
- Advisor census parser preserves rule, severity, metadata, observation time, and remediation URL without storing row data.
- Baseline/delta calculator rejects mismatched object sets, counter decreases without reset evidence, and windows shorter than the named cycle.

### Performance behavior tests

- `sync_asset_effective_tags`: asset tag change, style-group tag propagation, style-group reassignment, deletion, unchanged input/no rewrite, duplicate delivery, and concurrency.
- Rebuild/clear/count functions: stable keyset paging, empty/final page, changed-only input, retry idempotency, concurrent distinct keys, conflicting same key, and preserved final counts.
- Materialized-view scheduling: coalesced requests, failure/retry, freshness boundary, and no per-row refresh regression.
- Any new index: representative `EXPLAIN` plan and preview timing before/after plus insert/update overhead measurement.

### Security contract tests

- Anonymous, authenticated without app access, intended role, service role, and admin for each affected table/view/function.
- SELECT, INSERT, UPDATE, DELETE, and RPC separately where granted.
- Direct trigger-function RPC invocation is denied unless explicitly intended.
- Policy rewrite proves equivalent USING/WITH CHECK truth tables, including NULL identities.
- Security-definer routines have an explicit safe search path, input validation, least-privilege EXECUTE grants, and unchanged intended behavior.

### Existing gates that must remain green

- `bash scripts/check-sql.sh`
- `node --test scripts/check-sql.test.mjs`
- the focused migration contract tests named by each change;
- `.github/workflows/shared-supabase-migrations.yml` validation and preview jobs;
- `.github/workflows/database-contract-tests.yml` only through its authorized route;
- post-apply catalog verification plus application-specific smoke checks.

Do not run protected local Windows suites while shared `windows-*` CI is active. Documentation changes still run the repository's required guards; `AGENTS.md` and `plan_*.md` are rulebook files and are not classified as the lightweight documents-only lane.

## 11. Constraints and gotchas

1. Read `AGENTS.md` and this plan's STATUS table at every fresh session start.
2. Resolve the live orchestrator marker immediately before routing any structural issue; never use a handoff or old chat as the target.
3. Prove the database target immediately before every write. Preview and production refs must never be inferred.
4. Never reuse a migration version or edit a migration applied anywhere. Use a new forward migration above the live maximum.
5. Preview, merge, and production are separately serialized stages. Preview success does not authorize production.
6. No direct DDL, dashboard SQL change, broad privilege edit, or app-repo migration.
7. No bulk staging, destructive Git reset, cleanup of another session's files, or reuse of the dirty shared checkout.
8. No secret values, private rows, licensed data, or raw access responses in this public repo, GitHub, logs, or external reviews.
9. Supabase advisors are versioned heuristics. Preserve the observed timestamp and remediation URL, and re-fetch them before and after each change.
10. Statistics are cumulative and can be lost/reset. Always retain the baseline and compare deltas; NULL is unavailable, not zero.
11. `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY` have transaction and migration-runner constraints. The implementing issue must select the repository's proven operational path rather than paste generic SQL.
12. RLS policy consolidation can silently broaden access because permissive policies OR together. Prove behavior, not textual similarity.
13. Security-definer is sometimes intentional. Removing it can break controlled RPC access; retaining it requires pinned search path, validated inputs, and least privilege.
14. Large-table maintenance can lock or rewrite data. Metadata-only changes still need lock-time and rollback analysis.
15. A lower query mean after counters reset or workload changes is not comparable evidence. Match windows and request shapes.

## 12. Access and environment

- **Canonical repository:** `C:\repos\shared-db`; implementation must use a fresh isolated worktree from current `origin/main`, not the dirty shared checkout.
- **Production API URL:** `https://qsllyeztdwjgirsysgai.supabase.co`, verified read-only 2026-09-03. Re-resolve protected refs with `ai-private-config`; do not hard-code protected identifiers into commands or new scripts.
- **Preview:** Supabase branch `shared-db-schema-rehearsal`; re-resolve its protected ref at execution time.
- **Supabase read access:** the connected Supabase tool can read advisors/catalog and must call `get_project_url` before each session of reads. It is production-bound unless proven otherwise.
- **Supabase CLI credentials:** 1Password vault `vibe_coding`, items named in the `codex-shared-db-change` skill for the CLI token and shared production/preview database passwords. Reference item titles only; never print values.
- **GitHub:** authenticated `gh` for `u2giants/shared-db`. Before the first commit, `git var GIT_COMMITTER_IDENT` must remain `Albert Hazan <u2giants@users.noreply.github.com>`.
- **API security tests:** use existing protected test identities from `vibe_coding`; never create or expose credentials in a plan. If an intended role lacks a safe test identity, record the test blocked rather than substituting an admin identity.
- **Application repos:** locate the current canonical PopDAM/worker/DesignFlow repository from live call sites and each repo's `AGENTS.md`; do not assume an old local folder is current.

---

# Part 4 — Landing it

## 13. Definition of done, risks, rollback, and open questions

### Definition of done

- [ ] All STATUS rows are supported by openable evidence artifacts, commit SHAs, CI run IDs, deployed SHAs, or exact rerunnable commands.
- [ ] Every original dashboard AI and live advisor item is classified as fixed, accepted, not reproduced, superseded, deferred with date, or transferred to a named owner.
- [ ] Unauthorized Data API access is either disproved with catalog+HTTP evidence or fixed with positive and negative live tests.
- [ ] Intended browser/server workflows still work for every affected object and role.
- [ ] Expensive rebuild/projection work is reduced by measured changed-row, call, latency, IO, or WAL deltas—not merely rewritten.
- [ ] Every retained foreign-key/index/policy finding has a rationale; every removal/change has dependency and rollback proof.
- [ ] #1966 is evaluated no earlier than 2026-09-17 and #2196/#2043 are reused rather than duplicated.
- [ ] Each application change is committed, pushed, green in CI, deployed, exact-SHA verified, and live-smoked.
- [ ] Each structural change is previewed, independently reviewed at exact head, merged, explicitly authorized for that production change, applied, catalog-verified, and live-smoked.
- [ ] Final advisor census and comparable workload report are stored without secrets or row data.
- [ ] The plan, AGENTS router, topic evidence, and final handoff are updated; the open handoff is deleted only when issue #2209 is genuinely complete.

### Principal risks and rollback

- **Access outage or privilege escalation:** roll back with a new forward migration restoring the previously captured exact policies/grants/function definition; immediately retest negative and positive controls.
- **Index regression:** retain exact recreation DDL and restore through the governed low-lock path; monitor the affected application journey and query plan.
- **Write amplification worsens:** disable only the newly introduced path via its designed reversible switch or forward migration; do not disable the original capability.
- **Projection/count staleness:** retain the old computation until parity and freshness pass; backfill through bounded affected IDs, not a surprise production full rebuild.
- **Lock or storage growth:** enforce lock timeout, preview size/timing rehearsal, and a stop threshold specific to each issue.
- **False before/after comparison:** reject incomparable windows and recollect; do not claim savings.

### Owner decisions

1. **No decision is needed to perform Steps 1–3 read-only or to implement authorized application fixes through their normal repos.**
2. **Before Step 6 changes Auth leaked-password protection:** Albert must authorize that exact platform setting after impact/availability evidence. Recommendation: enable it if the current plan supports it and the test-account flow passes.
3. **Before every production structural promotion:** Albert must authorize the exact migration/change in the current chat after preview, exact-head review, and risk evidence. Recommendation: decide in bounded batches, with security exposures first and measured performance changes second.
4. If evidence proves a current unauthorized anonymous/authenticated path, raise it immediately rather than waiting for the rest of this program.

### Open technical questions

- Is the reported 181-second effective-tag population recurring, and which job invokes it?
- What freshness guarantees do users require for effective tags, style-group counts, and style-guide materialized views?
- Which of the 426 foreign-key findings participate in measured hot joins, parent maintenance, or cleanup?
- Which of the 22 duplicate-index notices are semantically identical after constraints, predicates, expressions, and INCLUDE columns are considered?
- Which exposed-schema configuration is active in PostgREST, since it was not visible through the read-only SQL setting?
- How much of current WAL is attributable to rebuilds/projections versus Realtime/other consumers?
- Does the Supabase plan support leaked-password protection, and what user enrollment/reset effect would enabling it have?

## Mandatory plan self-audit

1. **Could a brand-new AI session execute this plan without asking for missing context? Yes.** Sections 1–4 define the business outcome, system, trigger, and boundaries; Sections 5–8 preserve current evidence, rejected approaches, and locked/open decisions; Steps 1–8 name outputs, dependencies, and verification gates; Sections 10–13 define tests, access, landing, rollback, and owner gates.
2. **Does the plan carry the investigation's background, nuance, and reasoning, including what was ruled out? Yes.** Sections 5–7 record the reproduced measurements, the non-reproduced 127-table claim, advisor census, existing issues, cumulative-counter limitations, and ten rejected blanket approaches.
3. **Is the ultimate goal clear enough to steer a correct judgment call if a step is wrong? Yes.** Section 1 makes preserved business capability, exact intended access, measurable resource reduction, and evidence-over-advisory the controlling outcome; it explicitly says the goal wins over a conflicting step.

All 13 required sections are present. Concrete artifacts, functions, files, tests, routes, environment proof, secrets-by-location, fresh-session cut points, commit/CI/deploy requirements, and linked plan/handoff discovery are included.
