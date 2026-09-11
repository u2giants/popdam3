# Step 3 — cross-repository call graph for expensive rebuilds and projection churn

**Plan:** [`plan_database_efficiency_and_api_security.md`](../../../../plan_database_efficiency_and_api_security.md) Step 3
**Tracking issue:** [#2326](https://github.com/u2giants/shared-db/issues/2326) (see also #2213, #2214, #2215)
**Captured:** 2026-09-04, 21:28–21:35 UTC
**Target proved before reading:** `get_project_url` returned `https://qsllyeztdwjgirsysgai.supabase.co` (production, project ref `qsllyeztdwjgirsysgai`)
**Access class:** READ-ONLY. Every statement below is `SELECT`, `EXPLAIN` (no `ANALYZE`), or a catalog read. No DDL, no DML, no `pg_stat_reset`, no settings change. Two `EXPLAIN` attempts that contained a write CTE were **refused by the server** (`permission denied for table assets`) — recorded verbatim in §8.
**Row privacy:** no application row contents are reproduced. Only counts, timings, catalog definitions, and function source are recorded.

> This artifact is written in the `database-efficiency-callers/` directory deliberately. A concurrent agent owns `docs/verification/database-efficiency/<timestamp>/` for Step 1. No file of theirs is edited here.

---

## 0. Measurement window — stated before any number is used

| Fact | Value | Source |
|---|---|---|
| `pg_stat_statements` `stats_reset` | `2026-08-28 21:01:00.960228-04` | Q3 |
| `pg_postmaster_start_time()` | `2026-08-28 21:01:01.043332-04` | Q10 |
| `pg_stat_database.stats_reset` for `postgres` | **NULL** | Q9 |
| Elapsed window at capture | **6 days 20:27:55** (≈ 6.853 days) | Q3, Q10 |

The database-level `stats_reset` is NULL, so `pg_stat_user_tables` counters carry **no explicit reset timestamp of their own**. They are bounded instead by postmaster start, which is within 0.1 s of the `pg_stat_statements` reset: both were produced by the same 2026-08-28 21:01 server restart. `cron.job_run_details` confirms that restart independently (job 9 run at `2026-08-28 21:00:00` failed with `server restarted`, Q17). **Every "per window" rate in this document therefore uses one common 6.853-day window**, and that equivalence is evidence, not assumption.

Two consequences are stated plainly:

- Counters covering only 6.85 days **cannot** describe behaviour before 2026-08-28. Any claim about longer-run history is marked NOT MEASURED.
- `cron.job_run_details` retains history back to 2026-06-20 and is used where a longer view is needed; it is a separate, longer window and is always labelled as such.

`pg_stat_statements` **is available**, in schema `extensions` (Q1, Q4). It is not installed into `public`, which is why an unqualified reference fails; that failure is recorded in §8 so the availability finding cannot be mistaken for an absence.

---

## 1. Executive answer to the three questions Step 3 asks

1. **Is the 181-second `asset_effective_tags` population recurring?** **No — it was a one-off.** `pg_stat_statements` shows that exact statement with `calls = 1`, `total_exec_time = 181,670.6 ms`, `rows = 2,045,705` (Q4). The 181-second figure the dashboard AI reported is a single historical backfill, and it is **the wrong thing to optimise.**
2. **Is there recurring `asset_effective_tags` cost?** **Yes, and it is far larger than the one-off.** In 6.853 days the table took **8,808,328 inserts and 6,762,623 deletes to maintain 2,045,705 live rows** (Q7). That is a churn ratio of **4.3 inserts per live row per week**, and it is delete/insert churn from a row trigger, not a rebuild.
3. **Does `refresh_style_guide_matviews` overlap itself?** **No.** Zero overlapping starts in 7,302 recorded runs (Q16). But it holds an **`AccessExclusiveLock`** 96 times a day on one of the two matviews, because that matview cannot be refreshed concurrently (§5).

The single most consequential finding is not on the plan's list at all, and is stated in §6: **`refresh_style_group_counts_batch` writes unchanged values unconditionally**, and its `updated_at = now()` is itself a trigger key, so it re-fires the DAM search-document projection for every style group every night. This is the mechanism that makes the nightly reconcile job hit its own 30-second statement timeout (Q17).

---

## 2. Function inventory as deployed in production

All five are `SECURITY DEFINER` (Q2). Search paths are pinned. Source was read live from `pg_get_functiondef` (Q5, Q11). `function-definitions.sql` beside this file carries the short definitions verbatim plus the exact queries that reproduce all of them byte-for-byte; the two long plpgsql bodies are deliberately not hand-transcribed, because a retyping error inside an evidence file is worse than a pointer to the authoritative source.

| Function | Language | `prosecdef` | `statement_timeout` | `lock_timeout` |
|---|---|---|---|---|
| `public.rebuild_style_groups_batch(uuid, integer)` | plpgsql | true | `120s` | `0` |
| `public.clear_style_group_batch(uuid, integer)` | plpgsql | true | `120s` | `0` |
| `public.refresh_style_group_counts_batch(uuid[])` | **sql** | true | `30s` | `0` |
| `public.refresh_style_guide_matviews()` | plpgsql | true | (none set) | (none set) |
| `public.sync_asset_effective_tags()` | plpgsql (trigger) | true | (none set) | (none set) |

Note the asymmetry: `refresh_style_group_counts_batch` has a **30-second** ceiling while its own nightly caller routinely needs **75.85 s on average** (Q15). The job survives only because the timeout applies per statement inside a function whose cascade is charged elsewhere — and once, on 2026-08-25, it did not survive (Q17).

---

## 3. The call graph

### 3.1 Repositories searched

| Repository | On-disk path | Real callers found |
|---|---|---|
| `u2giants/shared-db` | `C:\tmp\sdb-step3` (worktree at `origin/main`) | migrations and docs only — no runtime caller |
| PopDAM (`popdam3`) | `C:\repos\popdam3` | **yes — every application caller lives here** |
| PopCRM (`popcrm-web`) | `C:\repos\popcrm-web` | none (matches are inside its vendored `shared-db/` copy only) |
| PopPIM (`poppim-web`) | `C:\repos\poppim-web` | none (vendored copy, plus a generated `database.types.ts`) |
| DesignFlow / PLM (`dflow_plm`) | `C:\repos\dflow_plm` | **none** — verified with vendored copies excluded (G4) |

ColdLion has no call site for any of these five functions; ColdLion is an outbound HTTP integration and does not hold a Postgres connection. Edge functions were enumerated from production, not from disk (Q0): 13 active functions, all deployed from `popdam3`.

### 3.2 `public.rebuild_style_groups_batch(uuid, integer)`

| Attribute | Finding |
|---|---|
| Named caller | `C:\repos\popdam3\apps\worker\src\handlers\style-groups.ts:303` — `client.rpc("rebuild_style_groups_batch", {...})` |
| Invocation | PostgREST RPC from the PopDAM worker, stage 3 (`rebuild_assets`) of a 4-stage bulk operation |
| Scheduled by | pg_cron job **7** `nightly-rebuild-style-groups`, `0 6 * * *`, which calls `queue_nightly_rebuild_style_groups()` — that function only *queues* work into `admin_config.BULK_OPERATIONS` (Q5). The worker polls and executes. |
| Measured frequency | **3,973 calls / 6.853 days ≈ 580 per day** (Q4) |
| Measured cost | mean **2,982 ms**, max **27,346 ms**, total **11,849,392 ms = 3 h 17 m** — the single most expensive statement of the five |
| Batch key / size | keyset cursor `p_last_asset_id`, ordered by `assets.id`; batch size from worker config, default 500 in the function signature |
| Overlap / retry | `queue_nightly_rebuild_style_groups` takes `pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'))` and returns early when status is `running` or `queued` — a genuine single-flight guard. The worker retries by re-reading its cursor from `admin_config`; on RPC error it returns `ok:false` without advancing the cursor. |
| Concurrency | Cron path is serialized by the advisory lock. **An operator-triggered rebuild from the admin UI uses the same `BULK_OPERATIONS` key, so it is serialized too.** No unserialized concurrent path was found. |
| Plan | Selection is keyset-bounded (§4.1). |

### 3.3 `public.clear_style_group_batch(uuid, integer)`

| Attribute | Finding |
|---|---|
| Named caller | `C:\repos\popdam3\apps\worker\src\handlers\style-groups.ts:185` — stage 1 (`clear_assets`) of the same bulk operation |
| Invocation | PostgREST RPC |
| Measured frequency | **287 calls / 6.853 days ≈ 42 per day** (Q4) |
| Measured cost | mean **34,617 ms**, max **62,926 ms**, total **9,935,165 ms = 2 h 46 m** |
| Batch key / size | keyset cursor `p_last_id` on `assets.id`; **adaptive** — the worker halves the batch on statement timeout down to a floor (`clearMinBatch`), lines 220–232 |
| Overlap / retry | shares the `BULK_OPERATIONS` single-flight guard; adaptive halving is a genuine bounded retry |
| Concurrency | serialized as above |
| Plan | keyset-bounded **and** served by a partial index that shrinks as the clear proceeds (§4.1) |

**The important reading of this row:** 34.6 seconds to `UPDATE ... SET style_group_id = NULL` on at most a few hundred rows is not explicable by the scan — the plan is an index-only scan capped by `LIMIT`. The time is the **trigger cascade** on `public.assets` (§6).

### 3.4 `public.refresh_style_group_counts_batch(uuid[])`

Five distinct invocation paths, three of them in application code:

| # | Caller | File / object | Invocation | Frequency |
|---|---|---|---|---|
| 1 | pg_cron job **6** `nightly-reconcile-sg-asset-counts` | `45 3 * * *`, command `SELECT public.refresh_style_group_counts_batch(array_agg(id)) FROM public.style_groups;` | scheduled | 1/day — **passes every style group, currently 10,866** |
| 2 | statement trigger `trg_refresh_sg_counts_on_insert` / `_on_update` / `_on_delete` on `public.assets` | via `refresh_style_group_counts_on_asset_change()` | trigger, `FOR EACH STATEMENT` with transition tables | once per asset-writing statement |
| 3 | PopDAM edge function | `supabase\functions\_shared\admin-handlers\sibling-scan-handlers.ts:320` | RPC | on admin sibling scan |
| 4 | PopDAM edge function | `supabase\functions\_shared\admin-handlers\purge-handlers.ts:78` and `:177` | RPC | on admin purge |
| 5 | PopDAM edge function | `supabase\functions\_shared\admin-handlers\ai-duplicate-handlers.ts:98` | RPC | on AI duplicate resolution |
| 6 | worker stage 4 | `apps\worker\src\handlers\style-groups.ts` (`finalize_stats` stage) | RPC | end of every rebuild |

Measured cost of path 1 only, which `pg_stat_statements` isolates cleanly:

- **7 calls** in the window (7 nights), mean **95,637 ms**, max **116,038 ms**, total **669,463 ms = 11 m 9 s** (Q4).
- Longer view from `cron.job_run_details` (window 2026-06-20 → 2026-09-03, 76 runs): mean **75.85 s**, max **120.01 s**, **1 run not succeeded** (Q15).
- That one failure, 2026-08-25 23:45, is `canceling statement due to statement timeout` with `CONTEXT: SQL statement "insert into public.dam_search_documents(...)"` (Q17). **The reconcile job failed inside the search-document projection, not inside its own aggregation.**

The statement trigger (path 2) is well written: it compares `old_table` to `new_table` and only collects groups where `is_deleted` or `style_group_id` **actually changed** (Q11). Path 2 is not a churn source. The problem is entirely on the callee side (§6).

**Concurrency:** paths 3, 4, 5 and 6 can genuinely run at the same time as each other and as path 1 — they are independent HTTP requests with no shared advisory lock, and `refresh_style_group_counts_batch` sets `lock_timeout = 0` (wait forever). Two callers passing overlapping group id arrays will serialize on row locks in `style_groups` with no timeout ceiling. No deadlock was observed in the window, and none is claimed; the hazard is latency, not corruption, because the `UPDATE ... FROM agg` applies rows in an unspecified order.

### 3.5 `public.refresh_style_guide_matviews()`

| Attribute | Finding |
|---|---|
| Caller 1 | pg_cron job **9** `refresh-style-guide-matviews`, schedule `*/15 * * * *` |
| Caller 2 | `C:\repos\popdam3\supabase\functions\agent-api\index.ts:2945` — `db.rpc("refresh_style_guide_matviews")`, on demand after a style-guide crawl |
| Measured frequency | `pg_stat_statements`: **657 calls** of the cron form in 6.853 days. Expected from `*/15` alone is 96 × 6.853 = **658**. The agent-api form is a *separate* queryid with **1 call**, 7,467 ms (Q4). So the scheduled path is essentially the whole of it, and on-demand refresh is rare. |
| Measured cost (short window) | mean **8,036 ms**, max **63,889 ms**, total **5,279,954 ms = 1 h 28 m** (Q4) |
| Measured cost (long window, 7,302 runs since 2026-06-20) | mean **8.54 s**, max **109.63 s**, 1 not-succeeded (that being the `server restarted` entry) (Q15) |
| Duty cycle | 5,279,954 ms of 592,076,000 ms elapsed = **0.89 %** |
| Overlap | **Zero overlapping starts across all 7,302 runs** (Q16), measured as `start_time < lag(end_time)`. Even the 109.63 s worst case is far inside the 900 s interval. |
| Batch key / size | none — it is an unconditional full refresh of both matviews regardless of whether anything changed |
| Retry | none; pg_cron simply runs again in 15 minutes |

**Blocking reading.** The body is two statements (Q5):

```
REFRESH MATERIALIZED VIEW CONCURRENTLY public.style_guide_file_groups;
REFRESH MATERIALIZED VIEW public.style_guide_folders;
```

The second is **not** concurrent. Catalog check (Q14): `style_guide_folders` is 48 kB and has **zero unique indexes** — so `CONCURRENTLY` is not merely unused, it is **not currently possible**; PostgreSQL requires a unique index on the matview. A non-concurrent refresh takes `AccessExclusiveLock` for its duration, blocking every reader of that matview, **96 times per day**. The view is tiny, so the blocking is short, but it is real and it is unnecessary — adding a unique index would make it eligible.

**NOT MEASURED — per-statement split of the 8.0 s mean between the two `REFRESH` statements.** `pg_stat_statements` records the enclosing `SELECT public.refresh_style_guide_matviews()`, and statements executed inside a plpgsql function body are not separately tracked here (`pg_stat_statements.track` is not set to `all`). Splitting it would require either changing a production setting or a preview reproduction, and neither is authorized by this read-only step.

**NOT MEASURED — actual lock-wait time inflicted on readers of `style_guide_folders`.** That needs `pg_locks` sampling synchronized to a refresh, or `log_lock_waits`; both are beyond a read-only snapshot. The *existence* of the exclusive lock is a catalog-and-source fact, not a measurement, and is stated as such.

### 3.6 `public.sync_asset_effective_tags()` — what populates `asset_effective_tags`

There is **no scheduled job and no application RPC** that populates this table. It is maintained exclusively by three row-level triggers (Q6):

| Trigger | Table | Events |
|---|---|---|
| `asset_tags_effective_tags_sync` | `public.asset_tags` | `AFTER INSERT OR DELETE OR UPDATE` — **every column** |
| `style_group_tags_effective_tags_sync` | `public.style_group_tags` | `AFTER INSERT OR DELETE OR UPDATE` — **every column** |
| `assets_effective_tags_sync` | `public.assets` | `AFTER INSERT OR DELETE OR UPDATE OF style_group_id, is_deleted` |

Plus the one-off historical backfill statement recorded in §1.

**Concurrency:** the function takes `pg_advisory_xact_lock` on hashed `aet_asset:` / `aet_group:` keys, acquired in sorted order. The in-source comment attributes this to the #1664 review. It is correct and deadlock-safe by construction, and it means concurrent writers touching the same asset or group serialize — deliberately.

---

## 4. Query plans

Plans were captured with `EXPLAIN` only. `EXPLAIN ANALYZE` was never used, because it **executes** the statement and these statements write.

### 4.1 `clear_style_group_batch` — keyset-bounded, correctly indexed

Statement (the readable selection half of the function's CTE):

```sql
EXPLAIN SELECT a.id FROM public.assets a
WHERE a.is_deleted = false AND a.style_group_id IS NOT NULL
  AND a.id > '00000000-0000-0000-0000-000000000000'::uuid
ORDER BY a.id ASC LIMIT 200;
```

Plan (Q12):

```
Limit  (cost=0.42..19.58 rows=200 width=16)
  ->  Index Only Scan using idx_assets_clear_style_cursor on assets a  (cost=0.42..8737.57 rows=91198 width=16)
        Index Cond: (id > '00000000-0000-0000-0000-000000000000'::uuid)
```

Supporting index (Q13):

```
CREATE INDEX idx_assets_clear_style_cursor ON public.assets USING btree (id)
  WHERE ((is_deleted = false) AND (style_group_id IS NOT NULL))
```

**Verdict: no full scan, and no accumulating dead prefix.** Both residual predicates are in the index *predicate*, so there is no `Filter` line and rows already cleared leave the index entirely. This is the well-behaved one. It is precisely why the 34.6-second mean cannot be blamed on the plan.

### 4.2 `refresh_style_group_counts_batch` — aggregation is index-bounded

Statement (the `agg` CTE, with the nightly job's own "all groups" argument):

```sql
EXPLAIN SELECT sg.id, COUNT(a.id)::integer, MAX(a.modified_at)
FROM public.style_groups sg
LEFT JOIN public.assets a ON a.style_group_id = sg.id AND a.is_deleted = false
WHERE sg.id = ANY(ARRAY(SELECT id FROM public.style_groups))
GROUP BY sg.id;
```

Plan (Q13b):

```
GroupAggregate  (cost=983.10..1142.15 rows=10 width=28)
  Group Key: sg.id
  InitPlan 1
    ->  Index Only Scan using style_groups_pkey on style_groups  (cost=0.29..982.39 rows=10865 width=16)
  ->  Nested Loop Left Join  (cost=0.70..158.70 rows=125 width=40)
        ->  Index Only Scan using style_groups_pkey on style_groups sg  (cost=0.29..19.50 rows=10 width=16)
              Index Cond: (id = ANY ((InitPlan 1).col1))
        ->  Index Scan using assets_style_group_id_active_idx on assets a  (cost=0.42..13.81 rows=11 width=40)
              Index Cond: (style_group_id = sg.id)
```

**Verdict: the read side is fully index-driven — no sequential scan.** The planner's `rows=10` for the `ANY` arm is a known estimation weakness for array membership (the true value is 10,866), but the *access method* is right either way. **The 95-second nightly cost is therefore not a read problem.** It is the write side, which §6 explains.

### 4.3 Plans that could not be captured

`EXPLAIN` was attempted on the complete `clear_style_group_batch` CTE including its `UPDATE`, and refused:

```
ERROR:  42501: permission denied for table assets
```

**NOT MEASURED — plans for the writing halves of `clear_style_group_batch`, `rebuild_style_groups_batch`, and `refresh_style_group_counts_batch`.** The read-only identity used for this step has no write privilege on `public.assets` or `public.style_groups`, and PostgreSQL requires write permission to *plan* a write even under bare `EXPLAIN`. This is the safety boundary working as designed and it is recorded rather than worked around. Obtaining these plans needs the preview branch, which is Step 5's territory.

---

## 5. Write amplification, measured

All figures from `pg_stat_user_tables` (Q7, Q18) over the common 6.853-day window established in §0.

| Table | Live rows | Inserts | Updates | Deletes | HOT updates | Writes per live row | Total size |
|---|---:|---:|---:|---:|---:|---:|---:|
| `asset_effective_tags` | 2,045,705 | **8,808,328** | 0 | **6,762,623** | 0 | **7.6** | 521 MB |
| `assets` | 145,746 | 7,023 | **1,478,880** | 0 | 739,983 | **10.2** | 3,248 MB |
| `style_groups` | 10,866 | 32,563 | **1,392,386** | 32,520 | 852,120 | **128.1** | 41 MB |
| `dam_search_documents` | 146,007 | 39,586 | **3,437,857** | 32,520 | 215,191 | **23.5** | 731 MB |
| `style_guide_files` | 296,608 | 2,233 | 1,565,455 | 0 | 0 | 5.3 | 841 MB |
| `asset_tags` | (see note) | 0 | 0 | 0 | 0 | — | 1,180 MB |
| `style_group_tags` | **0** | 0 | 0 | 0 | 0 | — | 32 kB |

Notes on the last two rows, because both are easy to misread:

- `asset_tags` shows all-zero counters and a NULL `last_autoanalyze`, yet a direct `count(*)` returns **2,173,392 rows, all `status='active'`** (Q8). The counters are zero because the table received **no writes in this window**, not because it is empty. Reporting "0 rows" from the statistics view would have been exactly the error recorded in memory as *"Never call a field dead from thin days"*; the direct count is the authority here.
- `style_group_tags` genuinely contains **0 rows** (Q8), and `asset_effective_tags` contains **0 rows with `scope='style_group'`** (Q10). Two independent reads agree. **The entire `style_group_tags` branch of `sync_asset_effective_tags` is currently dead code in production**, and all 2,045,705 effective tags come from the `asset` scope.

---

## 6. The mechanism: why cheap-looking statements cost minutes

Three findings, each traced from source and confirmed by counters. None of them is a scan problem, which is why the plans in §4 all look healthy.

### 6.1 `refresh_style_group_counts_batch` writes unchanged values, then re-fires a projection

The function's `UPDATE public.style_groups` has **no predicate comparing the new aggregate to the stored one** (Q5). Every group in `p_group_ids` is rewritten whether or not its `asset_count` or `latest_file_date` moved, and every rewrite sets `updated_at = now()`.

`updated_at` is itself a trigger key (Q19):

```
CREATE TRIGGER trg_dam_search_style_groups_refresh
  AFTER INSERT OR DELETE OR UPDATE OF sku, folder_path, ..., updated_at, latest_file_date
  ON public.style_groups FOR EACH ROW
  EXECUTE FUNCTION trg_refresh_dam_style_group_search_document()
```

So the nightly "reconcile counts" job unconditionally rewrites **all 10,866 style groups** and thereby unconditionally rebuilds **10,866 DAM search documents** — every night, for a table whose counts mostly did not change. This is the direct cause of the 2026-08-25 failure, whose error context names `insert into public.dam_search_documents` (Q17), and it is consistent with `style_groups` showing **128 updates per live row per week**.

**NOT MEASURED — what fraction of those 10,866 nightly updates are true no-ops.** Answering it requires either comparing stored counts to recomputed counts at a single instant (a large read this step did not run) or instrumenting the function in preview. It is left explicitly unknown rather than estimated, per the plan's verification gate. What *is* measured is that the function performs **zero** such comparisons.

### 6.2 The nightly rebuild rewrites `style_group_id` on every asset twice, and each write cascades

The bulk operation clears `style_group_id` on every grouped asset (stage 1) and then reassigns it (stage 3). `public.assets` carries **14 triggers** (Q19). Three of them fire on exactly the columns the rebuild touches:

- `assets_effective_tags_sync` — `UPDATE OF style_group_id, is_deleted`, which **deletes every effective tag for the asset and reinserts them**;
- `set_assets_updated_at` — bumps `updated_at`, which is a key of…
- `trg_dam_search_assets_refresh` — `UPDATE OF ..., style_group_id, is_deleted, updated_at`, rewriting the asset's search document.

The `assets` branch of `sync_asset_effective_tags` is unconditional (Q5): on `UPDATE` it runs `delete from public.asset_effective_tags e where e.asset_id = old.id` and then re-inserts the full tag set from `asset_tags`, **with no comparison of the old set to the new one**. Setting `style_group_id` to `NULL` and back to the same value therefore destroys and rebuilds every tag row for that asset twice per night — while `style_group_tags` is empty, so the group-scoped half of the recomputation cannot even change anything.

The arithmetic corroborates the mechanism: 2,045,705 live tag rows × 2 rewrites per night × 6.853 nights ≈ 28 M, against 6.76 M observed deletes. The observed figure is the **lower** number, which is what you would expect if not every night ran a full rebuild in this window — so the counters are consistent with the mechanism without being inflated by it. The mechanism is established by source and trigger definition; the exact per-night attribution is **NOT MEASURED**, because `pg_stat_user_tables` counters are cumulative and cannot be sliced by time without sampling over several days.

**This is the answer to "is the 181 s recurring".** The one-off backfill cost 181 seconds once. The trigger churn it left behind costs **millions of row versions every week**, forever. Optimising the backfill would save nothing.

### 6.3 `clear_style_group_batch`'s 34.6-second mean is trigger time, not scan time

Combining §4.1 (index-only scan, `LIMIT`-capped, partial index that shrinks) with §6.2 (each updated row fires a full tag delete+reinsert plus a search-document rewrite) gives the only reading consistent with both: the time is spent in the cascade, not in finding the rows. The adaptive batch-halving in the worker (`style-groups.ts:220–232`) is treating the symptom — it shrinks the batch until the cascade fits inside 120 seconds.

---

## 7. Concurrency summary

| Path | Can run concurrently with itself? | With others? | Guard |
|---|---|---|---|
| Nightly rebuild (clear/delete/rebuild/finalize) | **No** | — | `pg_advisory_xact_lock(hashtext('BULK_OPERATIONS'))` + status check in `queue_nightly_rebuild_style_groups` |
| `refresh_style_guide_matviews` (cron) | **No overlap observed in 7,302 runs** | yes, with everything | none in the function; interval (900 s) far exceeds max runtime (109.6 s) |
| `refresh_style_guide_matviews` (agent-api) | yes | yes | **none** — an on-demand call during a cron refresh would queue on the matview locks |
| `refresh_style_group_counts_batch` (4 RPC paths + cron + trigger) | **yes** | yes | **none**; `lock_timeout = 0` means an unbounded wait on overlapping group ids |
| `sync_asset_effective_tags` | serialized per asset / per group | — | sorted `pg_advisory_xact_lock` on hashed keys (correct, deadlock-safe by construction) |

---

## 8. Every statement and search actually run

Verbatim. Statements are numbered as cited above. All ran against project ref `qsllyeztdwjgirsysgai` via the Supabase MCP `execute_sql` tool on 2026-09-04 between 21:28 and 21:35 UTC.

**Q0** — `list_edge_functions` (MCP tool, no SQL). Returned 13 ACTIVE functions, all with `entrypoint_path` under `popdam3`.

**Q1**
```sql
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_stat_statements','pg_cron','pg_net','pgmq') ORDER BY 1;
```

**Q2**
```sql
SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosecdef, l.lanname
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
WHERE p.proname IN ('rebuild_style_groups_batch','clear_style_group_batch','refresh_style_group_counts_batch','refresh_style_guide_matviews','sync_asset_effective_tags') ORDER BY 1,2;
```

**Q3** (first attempt, **failed** — recorded because the failure is what proves *where* the extension lives, not that it is absent)
```sql
SELECT stats_reset, now() AS now_utc, now()-stats_reset AS window FROM pg_stat_statements_info;
-- ERROR: 42P01: relation "pg_stat_statements_info" does not exist
```
Resolution:
```sql
SELECT e.extname, n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_stat_statements';
-- -> extensions
SELECT stats_reset, now() AS now_utc, (now()-stats_reset)::text AS window FROM extensions.pg_stat_statements_info;
```

**Q4**
```sql
SELECT queryid, calls, round(total_exec_time::numeric,1) AS total_ms, round(mean_exec_time::numeric,2) AS mean_ms,
       round(max_exec_time::numeric,1) AS max_ms, rows, left(regexp_replace(query,'\s+',' ','g'),150) AS q
FROM extensions.pg_stat_statements
WHERE query ILIKE '%asset_effective_tags%' OR query ILIKE '%style_group_counts_batch%'
   OR query ILIKE '%refresh_style_guide_matviews%' OR query ILIKE '%rebuild_style_groups_batch%'
   OR query ILIKE '%clear_style_group_batch%' OR query ILIKE '%style_guide_file_groups%'
   OR query ILIKE '%style_guide_folders%'
ORDER BY total_exec_time DESC LIMIT 30;
```
(A prior identical statement against unqualified `pg_stat_statements` failed with `42P01`; same cause as Q3.)

**Q5**
```sql
SELECT p.proname, pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('sync_asset_effective_tags','refresh_style_guide_matviews','refresh_style_group_counts_batch','queue_nightly_rebuild_style_groups');
```

**Q6**
```sql
SELECT c.relname AS table_name, t.tgname, p.proname AS func, pg_get_triggerdef(t.oid) AS def
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
WHERE NOT t.tgisinternal AND p.proname IN ('sync_asset_effective_tags','refresh_style_guide_matviews','refresh_style_group_counts_batch','rebuild_style_groups_batch','clear_style_group_batch') ORDER BY 1,2;
```

**Q7**
```sql
SELECT relname, n_live_tup, n_dead_tup, n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd,
       last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
       pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_stat_user_tables
WHERE relname IN ('asset_effective_tags','assets','asset_tags','style_group_tags','style_groups','style_guide_files') ORDER BY relname;
```

**Q8**
```sql
SELECT (SELECT count(*) FROM public.asset_tags) AS asset_tags_rows,
       (SELECT count(*) FROM public.asset_tags WHERE status='active') AS asset_tags_active,
       (SELECT count(*) FROM public.style_group_tags) AS sgt_rows,
       (SELECT count(*) FROM public.asset_effective_tags) AS aet_rows;
```

**Q9**
```sql
SELECT datname, stats_reset, (now()-stats_reset)::text AS window FROM pg_stat_database WHERE datname = current_database();
-- stats_reset: NULL
```

**Q10**
```sql
SELECT pg_postmaster_start_time() AS pg_start, (now()-pg_postmaster_start_time())::text AS uptime,
       (SELECT count(*) FROM public.asset_effective_tags WHERE scope='style_group') AS aet_scope_group;
```

**Q11**
```sql
SELECT p.proname, pg_get_functiondef(p.oid) AS def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('rebuild_style_groups_batch','clear_style_group_batch','refresh_style_group_counts_on_asset_change');
```

**Q11b** — cron trigger discovery
```sql
SELECT c.relname AS tbl, t.tgname, p.proname, pg_get_triggerdef(t.oid) AS def
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
WHERE NOT t.tgisinternal AND pg_get_functiondef(p.oid) ILIKE '%refresh_style_group_counts_batch%' ORDER BY 1,2;
```

**Q12**
```sql
EXPLAIN SELECT a.id FROM public.assets a
WHERE a.is_deleted = false AND a.style_group_id IS NOT NULL AND a.id > '00000000-0000-0000-0000-000000000000'::uuid
ORDER BY a.id ASC LIMIT 200;
```

**Q12-refused** — recorded in full because a refused measurement must not look like an unattempted one
```sql
EXPLAIN (COSTS ON, VERBOSE OFF, FORMAT TEXT)
WITH batch AS (
  SELECT a.id FROM public.assets a
  WHERE a.is_deleted = false AND a.style_group_id IS NOT NULL
    AND a.id > '00000000-0000-0000-0000-000000000000'::uuid
  ORDER BY a.id ASC LIMIT 200
), upd AS (
  UPDATE public.assets a SET style_group_id = NULL FROM batch b WHERE a.id = b.id RETURNING a.id
) SELECT count(*) FROM upd;
-- ERROR:  42501: permission denied for table assets
```

**Q13**
```sql
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='assets' AND indexname IN ('idx_assets_clear_style_cursor')
UNION ALL
SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='assets' AND indexdef ILIKE '%style_group_id%';
```

**Q13b**
```sql
EXPLAIN SELECT sg.id, COUNT(a.id)::integer, MAX(a.modified_at)
FROM public.style_groups sg LEFT JOIN public.assets a ON a.style_group_id = sg.id AND a.is_deleted = false
WHERE sg.id = ANY(ARRAY(SELECT id FROM public.style_groups)) GROUP BY sg.id;
```
(A first form using `= ANY((SELECT array_agg(id) ...))` failed with `42883: operator does not exist: uuid = uuid[]` and was corrected to `ARRAY(SELECT ...)`.)

**Q14**
```sql
SELECT c.relname, c.relkind, pg_size_pretty(pg_total_relation_size(c.oid)) AS size,
       (SELECT count(*) FROM pg_index i WHERE i.indrelid=c.oid AND i.indisunique) AS unique_indexes
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('style_guide_file_groups','style_guide_folders');
```

**Q15**
```sql
SELECT jobid, count(*) AS runs, min(start_time) AS first, max(end_time) AS last,
       round(avg(EXTRACT(epoch FROM end_time-start_time))::numeric,2) AS avg_s,
       round(max(EXTRACT(epoch FROM end_time-start_time))::numeric,2) AS max_s,
       count(*) FILTER (WHERE status<>'succeeded') AS not_succeeded
FROM cron.job_run_details WHERE jobid IN (6,7,9) GROUP BY jobid ORDER BY jobid;
```

**Q15b** — the job catalogue
```sql
SELECT jobid, schedule, jobname, active, left(command, 300) AS command FROM cron.job ORDER BY jobid;
```

**Q16**
```sql
WITH r AS (
  SELECT jobid, start_time, end_time, status,
         lag(end_time) OVER (PARTITION BY jobid ORDER BY start_time) AS prev_end
  FROM cron.job_run_details WHERE jobid IN (6,9)
)
SELECT jobid, count(*) FILTER (WHERE start_time < prev_end) AS overlapping_starts, count(*) AS total
FROM r GROUP BY jobid ORDER BY jobid;
```

**Q17**
```sql
SELECT jobid, start_time, status, left(return_message,200) AS msg
FROM cron.job_run_details WHERE jobid IN (6,9) AND status <> 'succeeded' ORDER BY start_time DESC LIMIT 5;
```

**Q18**
```sql
SELECT relname, n_live_tup, n_dead_tup, n_tup_ins, n_tup_upd, n_tup_del, n_tup_hot_upd,
       pg_size_pretty(pg_total_relation_size(relid)) AS total
FROM pg_stat_user_tables WHERE relname IN ('dam_search_documents','render_queue','style_guide_render_queue') ORDER BY relname;
```

**Q19**
```sql
SELECT c.relname AS tbl, t.tgname, p.proname, pg_get_triggerdef(t.oid) AS def
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
WHERE NOT t.tgisinternal AND c.relname IN ('style_groups','assets') ORDER BY 1,2;
```

### Searches run

**G1** — ripgrep over `C:\repos\popdam3`, pattern:
`rebuild_style_groups_batch|clear_style_group_batch|refresh_style_group_counts_batch|refresh_style_guide_matviews|sync_asset_effective_tags|queue_nightly_rebuild_style_groups`

**G2** — same pattern (less `queue_nightly_...`) over `C:\repos\popcrm-web`. 10 files, **all** under its vendored `shared-db/` copy or generated types.

**G3** — same over `C:\repos\poppim-web`. 11 files, all vendored copy or `src\lib\database.types.ts` (generated).

**G4** — over `C:\repos\dflow_plm`. The unfiltered run returned 250 files and **hit the 250-file cap**, so it cannot by itself prove absence. All 250 paths contained `shared-db`, verified by `grep -c 'shared-db' <results> -> 250` and `grep -v 'shared-db' <results> -> (no rows)`. A capped result is not proof, so a second, uncapped run was made with the vendored copies excluded:
```
rg -l --glob '!**/shared-db/**' --glob '!**/node_modules/**' \
  'refresh_style_group_counts_batch|refresh_style_guide_matviews|rebuild_style_groups_batch|clear_style_group_batch|asset_effective_tags' .
```
It returned **no matches, exit 0**. DesignFlow/PLM has no caller.

**G5** — over the shared-db worktree at `origin/main` (`C:\tmp\sdb-step3`). This ripgrep run **timed out at 20 s** and returned no usable list, so it contributes nothing on its own. The shared-db repository was nevertheless covered successfully by **G6** below, which completed and found matches only in migrations and documentation — consistent with a repository that has no deployed runtime, and with production `pg_stat_statements` (Q4) attributing every call to a PostgREST RPC form or a pg_cron command, both already accounted for above.

**G6** — a combined sweep across all seven repositories (`shared-db popdam3 popcrm-web poppim-web dflow_plm infrastructure oracle`), run for each of seven patterns:
```
grep -rn --binary-files=without-match --exclude-dir=.git --exclude-dir=node_modules \
     --exclude-dir=dist --exclude-dir=.next -l "$pat" \
     shared-db popdam3 popcrm-web poppim-web dflow_plm infrastructure oracle
```
for `$pat` in `rebuild_style_groups_batch`, `clear_style_group_batch`, `refresh_style_group_counts_batch`, `refresh_style_guide_matviews`, `sync_asset_effective_tags`, `asset_effective_tags`, `dam_search_documents`.

This run exceeded its foreground timeout and was moved to the background; it **later completed with exit code 0**. Filtering its 289 lines of output for any path outside the two repositories already accounted for:
```
grep -v -E 'shared-db|popdam3' <output>   ->  only the seven section headers, no file paths
```
**Every matching file in all seven repositories lies under `shared-db` or `popdam3`.** This run was *not* subject to a file-count cap, so unlike G4 it is positive evidence of absence for `infrastructure` and `oracle` as well — neither contains any reference to these objects. G6 independently corroborates G1–G5 and is the strongest of the searches; it is reported last only because it finished last.

---

## 9. Verification-gate status against the plan's Step 3 wording

The gate reads: *"every expensive operation has a named caller, trigger/schedule, input size, changed-row count, query plan, concurrency pattern, and timestamped cost. Any unknown remains explicitly unknown rather than becoming a proposed fix."*

| Requirement | `rebuild_style_groups_batch` | `clear_style_group_batch` | `refresh_style_group_counts_batch` | `refresh_style_guide_matviews` | `sync_asset_effective_tags` |
|---|---|---|---|---|---|
| Named caller | ✅ worker:303 | ✅ worker:185 | ✅ 6 paths | ✅ cron 9 + agent-api:2945 | ✅ 3 triggers |
| Trigger / schedule | ✅ cron 7 → queue → worker | ✅ same op | ✅ cron 6 + statement triggers | ✅ `*/15 * * * *` | ✅ row triggers |
| Input size | ✅ keyset, 500 default | ✅ keyset, adaptive | ✅ 10,866 groups nightly | ✅ full refresh, no key | ✅ 1 row per event |
| Changed-row count | ⚠️ NOT MEASURED (needs write-side instrumentation) | ⚠️ NOT MEASURED | ⚠️ NOT MEASURED (no-op fraction) | n/a — full refresh | ⚠️ NOT MEASURED per night |
| Query plan | ⚠️ read side only | ✅ read side; write side refused | ✅ read side; write side refused | n/a | n/a |
| Concurrency | ✅ advisory-locked | ✅ advisory-locked | ✅ **unguarded**, documented | ✅ no overlap in 7,302 runs | ✅ advisory-locked |
| Timestamped cost | ✅ 3 h 17 m / window | ✅ 2 h 46 m / window | ✅ 11 m 9 s / window | ✅ 1 h 28 m / window | ✅ via table counters |

**Step 3's gate is met for caller, schedule, input size, concurrency, and cost on all five functions.** It is **not** met for changed-row counts, and the write-side plans are blocked by the read-only boundary. Both gaps are recorded as NOT MEASURED with their exact cause, and neither has been converted into a proposed fix here. Closing them requires preview instrumentation, which belongs to Step 4/5, not to a read-only trace.

No fix is proposed by this document. The mechanisms in §6 are findings; turning them into changes is Step 4 (application-owned) and Step 5 (structural), each with its own authorization.
