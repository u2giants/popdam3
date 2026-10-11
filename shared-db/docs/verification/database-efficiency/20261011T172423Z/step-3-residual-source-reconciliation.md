# Step 3 residual — repository-source reconciliation (no database access)

**Plan / issue:** `plan_database_efficiency_and_api_security.md` Step 3 residual / #2326
**Recorded:** 2026-10-11T17:24:23Z
**Scope of this artifact:** repository evidence only. Migration history, function
bodies, and prior verification docs. No database connection, no row values, no
preview or production touch. Read-only local search across `popcre/shared-db`.

## Why this artifact exists

The Step 3 closeout (`docs/verification/database-efficiency/20260910T140913Z/step-3-closeout.md`)
and the 2026-10-10 provenance trace
(`docs/verification/database-efficiency/20261010T025122Z/step-1-provenance-and-step-3-embedding-trace.md`)
left four residual items explicitly NOT MEASURED:

1. `clear_style_group_batch`'s changed-row count
2. Every write-side query plan
3. WAL delta and transaction duration
4. Per-statement split and reader lock-wait time for the matview refresh

This note reconciles those four against **later migration history and current
function bodies already in this repository**. Two of the four are narrowed or
structurally retired by source facts that post-date the 2026-09-04 call-graph
capture. Two remain open as runtime measurements. Nothing here is a runtime
measurement and nothing here is a proposed fix.

---

## Finding 1 — `clear_style_group_batch` cannot rewrite unchanged rows

**Status of the "does it rewrite unchanged rows?" question: answered NO by
source construction. Status of "how many rows does a production call change?":
still NOT MEASURED (volume).**

Authoritative body (`supabase/ci-bootstrap/010_pre_adoption_baseline.sql:2815`,
duplicate `:4723`; no later migration replaces this function — provenance chain
in `20261010T025122Z` Part A):

```sql
WITH batch AS (
  SELECT a.id
  FROM public.assets a
  WHERE a.is_deleted = false
    AND a.style_group_id IS NOT NULL
    AND a.id > v_start_id
  ORDER BY a.id ASC
  LIMIT p_batch_size
),
upd AS (
  UPDATE public.assets a
  SET style_group_id = NULL
  FROM batch b
  WHERE a.id = b.id
  RETURNING a.id
)
```

The batch predicate requires `style_group_id IS NOT NULL`. The UPDATE sets
`style_group_id = NULL`. Every row the statement touches therefore changes from
non-NULL to NULL. The function cannot select a row whose `style_group_id` is
already NULL, so it cannot perform a no-op rewrite. The returned `cleared_count`
is, by construction, the changed-row count for that call.

What this does **not** close:

- The production volume of `cleared_count` across the measured 287 calls /
  6.853 days (call-graph §3.3) is still NOT MEASURED. That is a runtime
  counter, not a source fact. PopDAM popdam3#295 is the owning issue for
  measuring it and for any skip-unchanged optimization; the skip-unchanged
  half is now known to be a no-op on this function (there is nothing to skip).
- The 34.6 s mean cost remains explained as trigger cascade (call-graph §6.3),
  not as unchanged-row rewrites.

**Disposition:** the changed-row *semantics* question is closed as "zero no-op
rewrites, by construction". The changed-row *volume* stays open as a runtime
measurement under popdam3#295.

---

## Finding 2 — matview reader lock-wait is structurally retired since #2212

**Status: RETIRED as a live concern for readers of either matview. The call-graph
NOT MEASURED entry describes a pre-2026-09-05 deployment shape that no longer
exists.**

Call-graph line 151 recorded:

> NOT MEASURED — actual lock-wait time inflicted on readers of `style_guide_folders`.
> … The *existence* of the exclusive lock is a catalog-and-source fact.

That exclusive lock came from the 0-arg baseline form
(`supabase/ci-bootstrap/010_pre_adoption_baseline.sql:3805`):

```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY public.style_guide_file_groups;
REFRESH MATERIALIZED VIEW public.style_guide_folders;   -- NOT concurrent
```

Migration `supabase/migrations/20260905104802_popsg_bounded_reconcile_pdf_text_and_search.sql`
(#2212, PR #2339) drops the 0-arg form and replaces it with
`(p_run_id uuid default null, p_search_batch_size integer default 5000)`. Its
body states, verbatim in the migration comment:

> BOTH concurrently. style_guide_folders became eligible in this migration when
> `sgfolders_licensor_property_uidx` was created; before it, this second refresh
> took an ACCESS EXCLUSIVE lock and blocked every reader.

and executes:

```sql
refresh materialized view concurrently public.style_guide_file_groups;
refresh materialized view concurrently public.style_guide_folders;
```

Later replacements keep both CONCURRENTLY:
`20260917005221_popsg_refresh_search_sync_queue.sql:110-111`,
`20260928003740` / `20260929040458` / `20260930185929` (step-split overload).

`REFRESH MATERIALIZED VIEW CONCURRENTLY` takes SHARE UPDATE EXCLUSIVE and does
not block SELECTs of the matview. Reader lock-wait on `style_guide_folders` /
`style_guide_file_groups` during refresh is therefore no longer possible in the
deployed form. Measuring "actual lock-wait inflicted on readers" for the
pre-#2212 shape is measuring a retired deployment.

**Disposition:** the lock-wait residual is closed as **structurally retired**,
not as "measured and found small". No runtime lock-wait sampling is required for
this item unless a future change reintroduces a non-concurrent REFRESH. The
`20260930185929` contract asserts both plain-column non-partial unique indexes
are present so CONCURRENTLY stays legal.

---

## Finding 3 — per-statement split of the matview refresh is structurally available; per-step timings still open

**Status: the split exists in the deployed function since the #3458 step
overload. The measured time of each step is still NOT MEASURED.**

Call-graph line 149 recorded:

> NOT MEASURED — per-statement split of the 8.0 s mean between the two `REFRESH`
> statements. `pg_stat_statements` records the enclosing
> `SELECT public.refresh_style_guide_matviews()`, and statements executed inside
> a plpgsql function body are not separately tracked here.

Two later changes alter that picture without measuring it:

1. **#3458 step overload** (`20260928003740`, reissued `20260929040458` and
   `20260930185929`): `refresh_style_guide_matviews(p_run_id, p_search_batch_size, p_step)`
   with `p_step in ('all','file_groups','folders','search')`. Each REFRESH and
   the search drain is a separate RPC statement when called with a single step,
   so a caller can time them independently. The legacy `(uuid,integer)` overload
   remains for existing callers and still does both REFRESHes in one statement.
2. **Both REFRESHes are CONCURRENTLY** (Finding 2), so the two statements are
   now symmetric in lock behavior; the historical "first concurrent, second
   exclusive" split is gone.

What is still NOT MEASURED: the production wall-clock of
`file_groups` vs `folders` vs `search` under the step overload, and any reader
wait that remains on underlying source tables (not on the matviews) during a
CONCURRENTLY refresh. Those need runtime counters after popdam3 starts calling
the step overload (popdam3#293 / shared-db#3458 callers).

**Disposition:** the per-statement *capability* is closed as available. The
per-statement *timing* stays open as a runtime measurement owned by the
application caller (popdam3) plus optional `pg_stat_statements` capture once the
step form is in use.

---

## Finding 4 — residuals that remain open with no local advance

These cannot be closed from repository sources and are **not** claimed here:

| Residual | Why still open | Where it is owned |
|---|---|---|
| Write-side query plans for `clear_style_group_batch`, `rebuild_style_groups_batch`, `refresh_style_group_counts_batch` | PostgreSQL requires write privilege to plan a write; the read-only identity correctly refused (call-graph lines 231, 237). Needs preview instrumentation. | Step 5 (structural), shared-db preview |
| WAL delta and transaction duration for rebuild/projection windows | Requires sampled WAL / `pg_stat_statements` totals over a window; cumulative counters cannot be sliced offline. | Step 7 (and Step 4 post-deploy deltas) |
| Per-step timing of the matview refresh (Finding 3) | Capability exists; counters do not. | popdam3 callers of the step overload |
| `cleared_count` production volume (Finding 1) | Semantics closed; volume is a runtime counter. | popdam3#295 |

---

## PopDAM ownership snapshot (2026-10-11)

Checked live via `gh` at record time. These are application-side and are not
worked from this repository:

| Issue | Title | State | Activity |
|---|---|---|---|
| [popdam3#293](https://github.com/u2giants/popdam3/issues/293) | Coalesce style-guide matview refresh cadence | OPEN | No assignee, no comments as of 2026-10-10. Not started. |
| [popdam3#294](https://github.com/u2giants/popdam3/issues/294) | Serialize/coalesce overlapping `refresh_style_group_counts_batch` callers | OPEN | App half landed: PR [#325](https://github.com/u2giants/popdam3/pull/325) merged 2026-10-11 (single-flight + coalescing). DB half filed as [shared-db#4174](https://github.com/popcre/shared-db/issues/4174) (advisory-lock serialization) — structural, not done here. |
| [popdam3#295](https://github.com/u2giants/popdam3/issues/295) | Measure `clear_style_group_batch` changed-row count and skip unchanged writes | OPEN | No assignee, no comments. Finding 1 above retires the skip-unchanged half; the volume measurement remains. |
| [popdam3#97](https://github.com/u2giants/popdam3/issues/97) | Finish and safely enable PopDAM hybrid search (embedding lease/error path) | OPEN | Blocker watch on shared-db#3457 (closed). Needs owner recheck and continue. Traced in `20261010T025122Z` Part B. |

Related shared-db structural ticket (not Step 4-8 implementation):
[shared-db#4174](https://github.com/popcre/shared-db/issues/4174) advisory-lock
serialization for the counts refresh — claim-first structural work when picked up.

---

## What this artifact does not do

- Does not mark any Step 3 row done in the plan STATUS table beyond the two
  source-level dispositions above (Finding 1 semantics, Finding 2 lock-wait).
- Does not implement Steps 4-8. Those stay PopDAM / structural.
- Does not close #2326.
- Does not touch production or preview.
