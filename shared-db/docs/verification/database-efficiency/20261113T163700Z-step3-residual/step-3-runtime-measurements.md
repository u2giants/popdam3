---
summary: "Step 3 residual runtime measurements (2026-11-13): WAL/duration per operation, cleared_count volume, write-side plan boundary re-verified under supabase_read_only_user; per-step split remains unknown"
kind: proof
status: done
read-when: checking what Step 3 rebuild-churn evidence is still unproven or re-measuring runtime cost
---

# Step 3 residual runtime measurements — 2026-11-13

**Plan / issue:** `plan_database_efficiency_and_api_security.md` Step 3 / #2326
**Recorded:** 2026-11-13T16:37Z–16:52Z (11:37 AM – 11:52 AM EST)
**Session:** MiMo chat ses_ffe5e2a67024fffe0TbBld1kjq on edge-dev
**Scope:** read-only production measurements through the Supabase Management API
`database/query` endpoint with `read_only: true` (pattern: `scripts/catalog-truth.mjs`).
No DDL, no DML, no `pg_stat_reset`, no settings change, no row contents, no credentials.
Raw captures live beside this file (`q-*.json`).

## Prior-session closeout receipt (first action of this pickup)

`ai-shared-db-closeout-check --session-id ses_ffe5e43506d64ffeEzis1lhwfS` completed
2026-11-13 11:54 AM EST with exit 0 (raw receipt: `closeout-receipt-prior-session.json`):

```json
{"blocking_claims":[],"blocking_stages":[],"ok":true,"open_claims_checked":12,"open_issues_seen":118,"session_id":"ses_ffe5e43506d64ffeEzis1lhwfS","stages_checked":3}
```

`ok:true`, zero blocking claims, zero blocking stages — the prior session held none
(docs-only), as expected. Earlier attempts the same morning returned `ok:false
"GitHub authentication is unavailable"`; that message is ai-gh's misleading label for a
machine-wide core-budget pause (`ai-gh` exit 75, `quota-pause.core` held until the hourly
window reset). The receipt above is from the first clean run after the pause expired.

## Window facts (read these before comparing counters)

- `pg_stat_statements` was reset **2026-11-06 11:20:19 EST** (`extensions.pg_stat_statements_info.stats_reset`,
  captured in `q0-identity.json`). Every `pg_stat_statements` figure below is a **7-day
  window** (2026-11-06 11:20 EST → 2026-11-13 11:37 EST), not a lifetime counter, and is
  **not** comparable to the 2026-09-04 baseline counters without that reset fact.
- `pg_stat_statements.track = top` (captured in `q-track-settings.json`): statements inside
  plpgsql/sql functions are **not** tracked separately. Only top-level call statements carry
  rows/timing/WAL. This is why per-statement splits cannot come from `pg_stat_statements`.
- Server: PostgreSQL 17.11 (`server_version_num 170011`); `pg_stat_statements` 1.11
  (wal_records/wal_fpi/wal_bytes columns present). No `pg_stat_monitor`, no `auto_explain`
  (`q-extensions.json`) — no extension-borne query-plan capture exists.
- API role: **`supabase_read_only_user`**, not superuser (`q-role.json`). This is the
  concrete cause of the write-side permission boundary (below).

## The five previously open items

### 1–2. `clear_style_group_batch` changed-row count and `cleared_count` production volume

**MEASURED at the level the read-only boundary allows.**

- **Call volume in window: zero.** No top-level `clear_style_group_batch` entry exists in
  `pg_stat_statements` since the 2026-11-06 reset (searched `%clear_style_group%` and the
  top-120 targeted / top-80 global windows, `q-pgss-clear-counts.json`,
  `q-pgss-targeted.json`, `q-pgss-top80.json`). Its production `cleared_count` volume in
  this window is therefore **0 rows across 0 calls**. The September census (287 lifetime
  calls) predates the reset and is not restated as current.
- **Remaining work: 111,736 rows** still satisfy `is_deleted = false AND style_group_id IS NOT NULL`
  as of 2026-11-13 11:37 EST (`q-clear-volume.json`).
- **Per-call changed-row semantics (unchanged):** `cleared_count` ∈ [0, `p_batch_size`]
  (default 200) and **zero no-op rewrites by construction** — the batch requires
  `style_group_id IS NOT NULL` and the UPDATE sets NULL (source proof:
  `20261011T172423Z/step-3-residual-source-reconciliation.md`). Every counted row is a
  real change.
- **Read-side plan (fresh):** `Index Only Scan on idx_assets_clear_style_cursor`
  (index cond `id > $cursor`), estimated 106,920 rows for the keyset window
  (`q-explain-clear-select.json`). The batch scan is index-bounded, confirming the
  September call-graph's keyset conclusion with a dated plan.

Residual: a per-call observed `cleared_count` distribution only exists while the function
runs. Its measurement belongs to popdam3 **#295** (instrument and skip unchanged writes);
it cannot be reconstructed from post-reset telemetry.

### 3. WAL delta and transaction duration

**MEASURED.** Per-operation figures from `pg_stat_statements` over the 7-day window
(`q-pgss-clear-counts.json`, `q-pgss-targeted.json`):

| Operation (top-level call entry) | Calls | Mean ms | Total s | WAL bytes | WAL records |
|---|---|---|---|---|---|
| rebuild batch (PostgREST RPC, `p_last_asset_id, p_batch_size, p_changed_since`) | 4,438 | 1,184 | 5,255 | 6,313,780,256 (5.88 GiB) | 8,546,775 |
| `refresh_style_guide_matviews_job()` | 168 | 3,843 | 646 | 104,660,450 | 193,455 |
| `queue_nightly_rebuild_style_groups()` | 1,010 | 158 | 159 | 12,276,517 | 15,108 |
| counts batch (PostgREST RPC, `p_group_ids uuid[]`) | 1 | 2 | 0.002 | 0 | 0 |
| step overload (PostgREST RPC, `p_run_id, p_search_batch_size, p_step`) | 6 | 12 | 0.07 | 3,528 | 12 |
| `clear_style_group_batch` | 0 | — | — | — | — |

The rebuild path is the dominant WAL producer (≈5.9 GiB / 7 days). The counts batch —
once a rewrite-amplification source — is now effectively dormant (1 call, no WAL), which is
consistent with the #2214 change predicate holding. `clear_style_group_batch` is dormant
in this window.

### 4. Write-side query plans

**Boundary re-verified with a dated, role-attributed record; read-side plans now cover all
five operations.**

- `EXPLAIN` (no ANALYZE — plans, never executes) of the write statements is **refused
  `42501 permission denied`** for `public.assets` (`q-explain-clear-update.json`),
  `public.style_groups` (`q-explain-counts-update.json`) and
  `public.asset_effective_tags` (`q-explain-sync-delete.json`). The refusing principal is
  `supabase_read_only_user` (`q-role.json`) — the Management API's query role. The write-side
  plan gap is a **platform permission boundary**, not a tooling defect, and it cannot be
  closed from this repo's sanctioned read path.
- `EXPLAIN` of `REFRESH MATERIALIZED VIEW CONCURRENTLY public.style_guide_file_groups`
  returns **`Utility Statement`** (`q-explain-matview-refresh.json`) — a utility statement
  has no planner plan. This is a definitive answer to "no query plan at all" for
  `refresh_style_guide_matviews`: there is no planner output to capture; its cost is the
  matview rebuild itself (item 5's timings).
- Read-side plans captured or re-confirmed this session: the `clear_style_group_batch`
  keyset SELECT (above); the `sync_asset_effective_tags` insert-select leg's `assets` join
  (`q-explain-sync-insert-select.json`). `rebuild_style_groups_batch`,
  `refresh_style_group_counts_batch` and `clear_style_group_batch` read-side plans were
  already in the 2026-09-04 call graph.

**Disposition:** the gate's query-plan requirement now has an answer for all five
operations (plan or definitive utility-statement fact). The write-side legs stay
**NOT MEASURED** and are a named unknown; capturing them requires execution rights this
repo's read path does not have (preview instrumentation, per the plan's own clause).

### 5. Per-step matview refresh timings

**PARTIAL — per-run distribution measured; per-step split remains a named unknown.**

- Per-run refresh-stage durations from `public.style_guide_crawl_runs`
  (`refresh_completed_at - refresh_started_at`, `q-crawl-run-recent.json`): 19 completed
  runs sampled 2026-11-13, **157.7 s – 2,658.8 s** (median ≈ 1,931 s). Reconcile stage
  recorded 0.0 s on all sampled runs (its own instrumentation, not re-derived here).
- Step-selection attribution (`refresh_style_guide_matviews_job()` definition,
  `q-job-wrapper-def.json` + `q-refresh-state.json`): when the matview source signature is
  unchanged and the last full refresh is < 6 h old, the job runs **only `p_step='search'`**;
  otherwise `p_step='all'`. `STYLE_GUIDE_REFRESH_STATE` records signature
  `24c5f8a88368a468f0365eb6fb822a97`, last full refresh **2026-11-13 07:07:00 EST**. The
  job's 168 calls at 3.8 s mean are dominated by search-only runs; the crawl-run refresh
  stages above are the full-refresh class.
- The literal **per-step split** (file_groups vs folders vs search) is still **NOT
  MEASURED**. `pg_stat_statements.track=top` cannot see the nested statements; the REFRESH
  is a utility statement. The #3458 step overload (`p_step in all|file_groups|folders|search`)
  is the instrument: four timed calls against preview, one per step, is the defined method
  (the plan authorizes preview instrumentation where telemetry cannot answer). Until that
  run exists, this remains explicitly unknown.

## Acceptance against the Step 3 gate

Gate text: *"every expensive operation has a named caller, trigger/schedule, input size,
changed-row count, query plan, concurrency pattern, and timestamped cost. Any unknown
remains explicitly unknown rather than becoming a proposed fix."*

| Requirement | State after 2026-11-13 |
|---|---|
| named caller | met (2026-09-04 call graph) |
| trigger/schedule | met (2026-09-04 call graph) |
| input size | met (2026-09-04 call graph) |
| changed-row count | **met** — zero no-ops by construction; window volume 0 calls / 111,736 rows remaining; per-call bound `p_batch_size` |
| query plan | **met for all five** (read-side plans + utility-statement fact); write-side legs named unknown (42501, `supabase_read_only_user`) |
| concurrency pattern | met (2026-09-04 call graph) |
| timestamped cost | **met** — WAL bytes/records + mean/total duration per operation, dated 2026-11-13 |

Named unknowns carried forward (explicitly, per the gate's second sentence):

1. Write-side query plan bodies for the three write functions — permission boundary
   (`supabase_read_only_user`), needs preview instrumentation.
2. Per-step matview refresh split (file_groups / folders / search) — needs the four timed
   `p_step` preview calls; per-run distribution is now measured above.
3. Per-call observed `cleared_count` distribution — needs the function to run under
   instrumentation (popdam3 #295); window activity is zero.

## What this does and does not authorize

- This is dated evidence for the Step 3 residual items only. It authorizes no migration,
  no privilege change, no index change, and no application change.
- It supports Step 4's existing app issues (popdam3 #293 cadence coalescing, #294 counts
  serialization, #295 clear instrumentation) with current cost figures: the rebuild path's
  5.9 GiB WAL/7 days is the top write-amplification target; the counts batch is already
  quiet; the clear batch is idle with 111,736 rows still queued.
- Step 5 must not start on the assumption that any named unknown above was measured.

---

*Posted by MiMo chat ses_ffe5e2a67024fffe0TbBld1kjq on edge-dev*
