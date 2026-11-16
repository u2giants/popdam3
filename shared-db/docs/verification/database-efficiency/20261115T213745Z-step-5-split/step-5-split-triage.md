---
summary: "Step 5 split 2026-11-15: four justified db-work issues (#6409/#6410/#6411/#6412); four families no-change with dated rationale; FK question answered"
kind: proof
status: done
read-when: checking what Step 5 of plan_database_efficiency_and_api_security.md justified, why a candidate family produced no issue, or which objects the four structural db-work issues own
---

# Step 5 split triage — structural performance candidates, 2026-11-15

**Plan / issue:** `plan_database_efficiency_and_api_security.md` Step 5 (Phase C) / #2326
**Recorded:** 2026-11-15 (4:37 PM EST)
**Session:** MiMo chat ses_ffe5e1ee on edge-dev (takeover of the stalled Steps 5-8 claim; see #2326 claim comment 2026-11-15 4:25 PM EST)

## What this document is

The plan's Step 5 turns each **justified** structural change into its own `db-work` issue with exact
objects, a named rollback, and preview proof — and does not open issues for candidates the evidence
does not justify. This is that triage, dated. Nothing here is implemented yet: the four issues below
are the split; their migrations follow through claim-first on each issue.

Evidence sources (all privacy-safe; no row contents, no credentials, no preview ref):

1. Step 1 captures `docs/verification/database-efficiency/20260904T212459Z/run1/`
   (`indexes.json` 3,388 definitions; `foreign-keys.json` 1,081 constraints;
   `advisors-performance.json` rule census; `pg-stat-statements-top300.json`).
2. Step 3 residual captures `docs/verification/database-efficiency/20261113T163700Z-step3-residual/`
   (7-day `pg_stat_statements` window 2026-11-06 → 2026-11-13, `q-pgss-top80.json`; explain captures).
3. Live read-only Management API catalog query, 2026-11-15 (production, `read_only: true`):
   current definitions and constraint ownership of every duplicate-index candidate plus the full
   `public.style_groups` index list. Raw capture retained session-side only (contains object names
   only; not committed because it is reproducible from the query below).
4. Repository sources: contract tests (`dam_order_list_contract.sql`,
   `opa_property_character_landing_contracts.sql`), the proven drop-index migration pattern
   (`20261022191243_retire_dam_search_documents_text_indexes.sql`), the opa normalize migration
   (`20260814040000_opa_property_character_normalize.sql`), `ci-bootstrap/010_pre_adoption_baseline.sql`.

Reproduce the live check (production, read-only):

```sql
select n.nspname, c.relname, i.relname, ix.indisunique, ix.indisprimary,
       pg_get_indexdef(ix.indexrelid), con.conname, con.contype
from pg_index ix
join pg_class i on i.oid = ix.indexrelid
join pg_class c on c.oid = ix.indrelid
join pg_namespace n on n.oid = c.relnamespace
left join pg_constraint con on con.conindid = ix.indexrelid
where (n.nspname, c.relname) in (
  ('app','quote_auth_token'),('dflow','quote_auth_token'),('dflow_prod','quote_auth_token'),
  ('app','RolePermissions'),('dflow','RolePermissions'),('dflow_prod','RolePermissions'),
  ('dflow','GridLayout'),('dflow_prod','GridLayout'),('plm','GridLayout'),
  ('dflow','StandardizedDetail'),('dflow_prod','StandardizedDetail'),('plm','StandardizedDetail'),
  ('dflow','item_prod_order_detail_associations'),('dflow_prod','item_prod_order_detail_associations'),
  ('plm','item_prod_order_detail_associations'),
  ('dflow','licensingMilestone'),('dflow_prod','licensingMilestone'),('plm','licensingMilestone'),
  ('plm','opa_property_character'),('plm','production_order'),('public','app_access'),('public','style_groups')
)
order by 1,2,3;
```

## Verdict by candidate family (plan Step 5 list)

### Family 1 — rebuild/projection functions: NO ISSUE, named residual

Changed-row questions for the expensive functions were closed by the independently governed
migrations #2213 (effective-tag set comparison), #2214 (unchanged-count predicate) and #2408
(guarded rebuild); the Step 4 closure audit (2026-11-13) retired the app-side amplification.
The write-side plan bodies of the rebuild path remain **NOT MEASURED** behind the permanent
platform boundary (EXPLAIN of DML refused `42501` to `supabase_read_only_user` — re-verified
2026-11-13, `step-3-runtime-measurements.md`). Without plan bodies no supporting-index or
re-shaping change can be justified by the plan's own criterion ("only after Step 3 proves the
benefit"). **No structural change opened.** The rebuild path's measured residual cost
(4,438 calls / 1,184 ms mean / 5.88 GiB WAL per 7 days) stays a Step 8 before/after subject.

### Family 2 — foreign keys: ONE ISSUE (#6412), the rest rejected with dated evidence

The plan's open question — "Which of the 426 foreign-key findings participate in measured hot
joins, parent maintenance, or cleanup?" — is now answered:

- **Parent maintenance is ~absent.** Of 433 unindexed FK findings (2026-09-04 capture; advisor
  said 426 — the capture supersedes), exactly **one** has any parent-row DELETE churn
  (`auth.saml_relay_states.flow_state_id`, 11 deletes, 0.0 MB child). Parent UPDATE counts are
  cumulative row updates, not key-column RI checks, and the delete signal is the clean one.
  No FK is justified by parent maintenance.
- **Measured hot joins name one candidate.** The 7-day `pg_stat_statements` window
  (2026-11-06 → 2026-11-13, top 80) shows `assets LEFT JOIN LATERAL style_groups ...`
  (PostgREST FK embed) at **954,427 calls/week ~1 ms mean**, and the 2026-09-04 top-300 shows
  the reverse embed `style_groups LEFT JOIN LATERAL assets` (79+3 calls, 119–241 ms). The join
  key is `style_groups.primary_asset_id = assets.id` — FK
  `style_groups_primary_asset_id_fkey`, **unindexed**. Live catalog 2026-11-15: no index on
  `public.style_groups` leads with `primary_asset_id` (17 indexes checked). → **#6412**.
- **Cleanup/queue paths are dormant or unmeasured.** `clear_style_group_batch` is dormant
  (0 calls in every measured window). `processing_queue.asset_id` (unindexed FK to `assets`)
  has **zero** statements in either pgss window. Not justified.
- The remaining ~430 findings sit on cold landing tables (`plm.dcp_metadata_asset` 1.3 GB but
  zero measured joins on its unindexed FK columns, `ingest.raw_record`, `pim.product` ×5,
  `plm.wb_*`, etc.) with no measured join or maintenance driver. Per the locked rejection
  ("do not add all 426"), **no issue**. They remain advisor findings classified
  *deferred-no-measured-driver*, re-eligible only with new dated join evidence.

### Family 3 — duplicate indexes: THREE ISSUES (#6409, #6410, #6411)

All 22 advisor `duplicate_index` findings were compared field-by-field (`indexdef`, uniqueness,
predicate, expression, INCLUDE, validity, constraint ownership) and re-verified live 2026-11-15.
Every pair is a definition-identical twin. Constraint-owned twin always kept; plain twin dropped.
Prerequisite #2043 (catalog-verifier absence assertions) is **CLOSED** — absence acceptance is
available. Keeper names pinned by contract tests where they exist
(`dam_order_list_contract.sql` → `production_order_number_idx`;
`opa_property_character_landing_contracts.sql` → `idx_opa_property_character_character_id`).

- **#6409** — 18 unique-index twins where the keeper is the constraint-owned index
  (`quote_auth_token_pkey` ×3, `GridLayout_pkey` ×3, `StandardizedVersionDetail_pkey` ×3,
  `RolePermissions_unique_role_user_element` ×3, `item_prod_order_detail_associations_unique_pair`
  ×3, `unique_item_stage` ×3). Rollback DDL retained per index in the issue.
- **#6410** — 3 plain-index twins (`plm_production_order_number_idx`,
  `plm_opa_property_character_character_idx`, `app_access_user_id_idx`), with a preview-proof-gated
  optional extension for the second `app_access` twin (both are prefix-redundant with
  `app_access_user_id_app_key (user_id, app)` — only provable by preview EXPLAIN).
- **#6411** — the one pair where **both** sides are constraint-owned:
  `plm.opa_property_character` PK `opa_property_character_pkey` vs UNIQUE constraint
  `plm_opa_property_character_pair_key`, identical `(licensed_property_id, character_id)`.
  The 2026-08-14 normalize migration added the UNIQUE for duplicate-load protection already
  provided by the PK. Dropping a constraint needs the ON CONFLICT contract proof the issue names;
  status `needs-evidence` until that proof lands. Serialized after #6410 (same table).

One census correction recorded: the 2026-09-04 capture lists
`unique_item_stage_dflow_prod_1774369813518` on `dflow_prod."licensingMilestone"`; live
2026-11-15 shows `unique_item_stage_designflow_1774369813518` (same columns, constraint-owned).
Live is authoritative; the keeper name in #6409 follows live.

### Family 4 — unused indexes: NO ISSUE (locked deferral + Step 7 work)

The four #1966 tables stay deferred to the Step 7 dated delta by locked decision 2026-09-03.
For all other tables the plan requires "a dated workload window covering rare admin/import jobs"
before any drop; lifetime `idx_scan = 0` remains untrustworthy (counters lost/reset — the
program's `pg_stat_statements` itself reset 2026-11-06). The classification pass is Step 7's
deliverable ("Complete the dated index observation"), not Step 5's. **No issue.**

### Family 5 — fillfactor: NO ISSUE (#2196 done)

#2196 (`public.dam_search_documents`) is CLOSED and its change landed. The plan forbids
duplicating or broadening it; no other table has the required row-width / free-slot / HOT-eligibility
evidence. **No issue.**

### Family 6 — materialized views: NO ISSUE (already landed)

Concurrent refresh with its qualifying unique index landed inside #2212's migration
(`20260905104802`); refresh cadence coalescing landed via #4192 / popdam3 #293 (~28 h/week →
~1.3 h/week, audited 2026-11-13). Loaded search-sync cost is measured (PR #6329) and under its
ceiling. No further structural change is justified; the pdf-text D-weight path stays a named
Step 3 unknown (preview cannot host it). **No issue.**

## Dependency order for the filed issues

1. **#6412** (new index, independent) — smallest risk, measurable win, no dependency.
2. **#6409** (18 unique-twin drops, one migration) — independent of the others.
3. **#6410** (3 plain-twin drops) — independent; serialize its `plm.opa_property_character` drop
   before #6411.
4. **#6411** (opa pair constraint) — after #6410 and after its ON CONFLICT preview proof.

Each issue carries its own exact objects, rollback DDL, preview-proof plan, and
```db-work-scope``` block (`route: claim-first`). Implementation is claim-first per §0.0-D.

## Anti-collision check performed 2026-11-15

Open `db-claim` blocks on in-flight issues (incl. #6356's nine claim blocks, #6335/#6346's
`20261113223432` side_rows work, the #6269/#6178 core.property claims, the #5683 claims) name
**none** of the objects in #6409/#6410/#6411/#6412. PRs #6335/#6346 (other sessions) touch a
data fix-forward, not these indexes. Claim before implementing.

## Named unknowns kept open (do not treat as measured)

- Write-side query-plan bodies of the rebuild path (`42501` platform boundary).
- Per-call `cleared_count` distribution (moot while `clear_style_group_batch` is dormant).
- PDF-text D-weight path in loaded search-sync (preview cannot host it).
- The ~430 unindexed FK findings' join sites in application code (Step 1 capture item) — this
  triage answered the measured-cost question from database telemetry; a full app-repo query-site
  census remains open as context, not as a blocker.
