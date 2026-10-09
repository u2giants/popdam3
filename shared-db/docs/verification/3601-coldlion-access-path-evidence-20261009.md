# Issue #3601 — ColdLion replay proof access-path measurements (read-only)

**Measured:** 2026-10-09, 11:04 AM EDT (America/New_York) — machine edge-dev,
MiMo chat session `ses_ffe5ededdb0d4ffelMcO1HGLB9`.
**Scope:** read-only assessment only. No SQL, index, migration, row, workflow, or
production state was changed. Nothing was seeded anywhere. Production
(`qsllyeztdwjgirsysgai`) was **not** queried for any of the measurements below.

All database calls went through the Supabase Management API with
`read_only: true` (endpoint `/v1/projects/<ref>/database/query/read-only`),
executed as `current_user = supabase_read_only_user` with
`transaction_read_only = on`. Every target was proved before use by querying
`current_database()`, `current_user`, and `transaction_read_only` on that same
target, and non-production identity was proved from the branch inventory
(`GET /v1/projects/qsllyeztdwjgirsysgai/branches`), which maps each branch name
to its own `project_ref`.

## Target inventory (proved 2026-10-09)

| Target | Ref | Branch / parent | Identity result | Verdict |
|---|---|---|---|---|
| Rehearsal preview | `mvpkijzfmfcxhnzqogzs` | branch `shared-db-schema-rehearsal` of parent `qsllyeztdwjgirsysgai` (repo variable `PREVIEW_PROJECT_REF`) | PostgreSQL 17.6, `supabase_read_only_user`, `transaction_read_only=on` | usable; detail tables **empty** |
| designflow-nonprod | `xupnyeifmpsacrqahwwm` | separate non-production project | `supabase_read_only_user`, `transaction_read_only=on` | usable for `sync_run` only; **no** `prepack_detail`/`prod_detail` |
| develop branch | `wxwtyxubjsfvxvjrajbk` | branch `develop` of parent `qsllyeztdwjgirsysgai`, `with_data: true` | **`preview_project_status: INACTIVE` (paused)** — every read-only query returns HTTP 544 after ~15.3 s: `Failed to run sql query: Connection terminated due to connection timeout` | unusable while paused; not resumed (read-only scope) |
| designflow-prod-cutover-rehearsal-20260913 | `dgmebpgczkrxykqqfjev` | branch of parent, `MIGRATIONS_FAILED` | `to_regclass` shows **none** of the four `coldlion` proof tables exist | unusable |
| production | `qsllyeztdwjgirsysgai` | — | not queried under this issue | out of scope |

Exact counts:

- Rehearsal preview: `coldlion.sync_run = 14` (all `/orderHistory`, run dates
  2026-10-02), `prepack_detail = 0`, `prod_detail = 0`, `change_log = 0`.
  `pg_class.relpages = 0` for all four tables.
- designflow-nonprod: `coldlion.sync_run = 1262`
  (859 `/prodHistory` succeeded + 403 `/orderHistory` succeeded),
  `change_log = 0`; `prepack_detail` and `prod_detail` do not exist.

**Representative-data caveat (stated, nothing seeded):** no non-production
target holds rows in `prepack_detail` / `prod_detail`. Per this issue's scope
nothing was seeded and no production query was made, so the detail-table paths
could only be measured at volume indirectly — via the production live-proof
workflow timing recorded below.

## Current index landscape (repo, origin/main, and preview catalog)

- Migration `20260916001944` still declares "No secondary indexes" for the two
  detail tables (lines 208–211): `prepack_detail` has only
  `prepack_detail_pkey (company_code, prepack_code, sequence_no)`; `prod_detail`
  has only `prod_detail_pkey (company_code, pkey)`.
- **Change since the issue was written:** migrations `20261001122410`
  (#3861) and `20261006004845` (#3948) added
  `prod_detail_company_code_prod_order_no_idx (company_code, prod_order_no)`,
  and `20260930212107` / `20261005044103` dropped the old
  `unique (company_code, prod_order_no, prod_line_seq)`. The preview catalog
  shows exactly these three indexes on `prod_detail`. The issue's original
  observation ("the unique index cannot serve the cast predicate") is therefore
  historical; the live question is whether the *new* two-column index serves
  the proof's `prod_order_no::text` predicate — measured below.
- `sync_run` keeps `coldlion_sync_run_endpoint_started_idx (endpoint,
  started_at DESC)` and `coldlion_sync_run_status_started_idx (status,
  started_at DESC)`; `change_log` keeps `coldlion_change_log_run_idx (run_id)`.
- No `run_id` index exists on either detail table.

## Results — rehearsal preview (full committed proof + per-path plans)

Exact committed probe `.github/live-proofs/2863.sql` (byte-identical to
`origin/main`):

- `EXPLAIN (ANALYZE, BUFFERS)`: **Planning 7.016 ms, Execution 1.074 ms**
  (server-side total ≈ 8.1 ms).
- Plain timed run through the Management API: HTTP 201 in **0.421 s** wall,
  returning `[{"passed":false}]` — expected: no `/prepackDetail` or
  `/proddetails` replay candidate exists among the 14 `/orderHistory` runs, so
  every detail sub-plan is `never executed`.

Per-path plans (all `EXPLAIN (ANALYZE, BUFFERS)`, literals bound to a real
`sync_run.id` = `7f77118d-e2e0-405a-a393-ee0dfac14805`):

**(a1) `prepack_detail` by company + `run_id` — Execution 0.159 ms**

```
Aggregate (actual time=0.006..0.007 rows=1)
  -> Index Scan using prepack_detail_pkey on prepack_detail d
       Index Cond: (company_code = 'POP'::text)
       Filter: (run_id = '7f77118d-...'::uuid)
  Buffers: shared hit=2
Execution Time: 0.159 ms
```

The pkey's `company_code` prefix serves the company key; `run_id` is a heap
filter over that company's rows (0 rows here).

**(a2) `prod_detail` by `run_id` — Execution 0.171 ms**

```
Aggregate (actual time=0.020..0.021 rows=1)
  -> Seq Scan on prod_detail d
       Filter: (run_id = '7f77118d-...'::uuid)
Execution Time: 0.171 ms
```

Confirmed: no `run_id` index → seq scan (trivial at 0 rows).

**(b) `prod_detail` `company_code = … AND prod_order_no::text = …` — Execution 0.190 ms**

```
Aggregate (actual time=0.010..0.011 rows=1)
  -> Index Only Scan using prod_detail_company_code_prod_order_no_idx on prod_detail d
       Index Cond: (company_code = 'POP'::text)
       Filter: ((prod_order_no)::text = '123456'::text)
  Heap Fetches: 0
Execution Time: 0.190 ms
```

The cast predicate is planned as a **heap/index Filter, not part of the Index
Cond** — the issue's observation is confirmed live against the new index: the
order key is not usable through the index *as written*; only the
`company_code` prefix is.

Contrast, same predicate without the cast
(`company_code = … AND prod_order_no = 123456`), Execution 0.162 ms:

```
-> Index Only Scan using prod_detail_company_code_prod_order_no_idx
     Index Cond: ((company_code = 'POP'::text) AND (prod_order_no = 123456))
```

**(c) `sync_run` candidate queries** (verbatim proof CTE bodies):

- `/prepackDetail` candidate (incl. detail-count sub-selects): Planning
  3.451 ms, Execution **1.174 ms**; planner uses
  `coldlion_sync_run_status_started_idx` (Index Cond `status = 'succeeded'`),
  `Rows Removed by Filter: 11` of the 14 runs; `NOT EXISTS change_log` runs as
  Index Only Scan on `coldlion_change_log_run_idx`; both detail sub-plans
  `never executed` (0 candidates).
- `/proddetails` candidate: Planning 3.121 ms, Execution **0.322 ms**, same
  status-index drive; detail cast sub-plan sits on the new
  `prod_detail_company_code_prod_order_no_idx` with the cast as Filter.

## Results — designflow-nonprod (sync_run path at 1,262 rows)

This target has real `sync_run` volume but no detail tables, so the two
candidate queries were measured with the detail-count clauses removed (the
detail clauses are measured separately above). Endpoint profile: 859
`/prodHistory` + 403 `/orderHistory` — neither proof endpoint has runs here, so
candidate counts are 0; the plans still exercise the real index/scan choice
over 1,262 rows.

- `/prepackDetail` candidate (sync_run side): Planning 1.969 ms, Execution
  **2.088 ms** — `Index Scan using coldlion_sync_run_endpoint_started_idx`,
  `Index Cond: (endpoint = '/prepackDetail'::text)`, 1 buffer page read;
  `NOT EXISTS (change_log)` planned as seq scan (0-row table on this target).
- `/proddetails` candidate (sync_run side): Planning 1.579 ms, Execution
  **0.234 ms** — same endpoint-prefix index drive.

Both confirm the issue's observation: the existing endpoint/status index prefix
serves these queries; at 1,262 runs the whole candidate scan costs single-digit
milliseconds. `request_params` JSON conditions and `company_code` are filters
only, as documented.

## 15-minute workflow budget — production-volume evidence (no DB query made)

The Shared DB Live Proof workflow executes the same committed `2863.sql`
read-only against production inside its `timeout-minutes: 15` budget. GitHub
Actions metadata (read-only GitHub API, no database access):

- Run `35787289542` (2026-09-22, artifact
  `shared-db-live-proof-2863-b055a4141bf91450adacd3a1383decdef9693402`,
  conclusion **success**, `passed=true` recorded by PR #3515): total wall
  **12 s**; probe step "Run the committed probe read-only against production"
  ran `21:32:53Z → 21:32:53Z` — **≤ 1 s** including Management API round trip
  at full production volume.
- Recent runs of the same workflow (other issues' probes, same budget): 17–25 s
  total on 2026-10-06…10-08; the slowest observed run in the last three weeks
  was 4 m 34 s (2026-09-30, issue #3679's probe).

So the full committed proof — including the detail-table access paths at
production volume, whatever their exact row counts — completes in **≤ 1 s of
probe time inside a 12 s workflow run**, a ≥ 900× margin under the 15-minute
budget. The budget question is answered by measurement, not estimate.

## Finding and decision

1. **No access path is materially expensive.** Measured: sync_run candidates
   ≤ 2.1 ms at 1,262 rows (designflow-nonprod); the exact full proof ≈ 8 ms
   server-side / 0.42 s wall on the rehearsal preview; the same full proof ≤ 1 s
   at production volume in the recorded workflow run.
2. **The 15-minute workflow budget holds with two orders of magnitude of
   margin** (12 s total / ≤ 1 s probe vs 900 s budget, production volume).
3. **The cast observation is confirmed but not costly:** `prod_order_no::text`
   keeps the order key out of the index condition (only `company_code` is an
   Index Cond), yet the company prefix plus small table make the path cheap, and
   the production proof completes in ≤ 1 s as measured above.
4. **Landscape already moved:** #3861/#3948 landed
   `prod_detail_company_code_prod_order_no_idx` in October; the unique index the
   issue cited no longer exists. The remaining theoretical candidates —
   `(run_id)` indexes on `prepack_detail` and `prod_detail` — still have no
   consumer showing cost at volume (detail tables hold 0 rows on every
   available non-production target, and production's own proof run is ≤ 1 s).

**Decision: measured no-change finding. No structural change is supported by
this evidence, so no successor issue is opened; #3601 closes with this
evidence.** If a future populated non-production target ever exists and a
consumer shows real cost there, that would justify a separate claim-first
issue naming the exact index.

Posted by MiMo chat unknown on edge-dev
