---
summary: "Issue #5609 post-restart opening at pg_stat_statements.max=40000 (dealloc=0); 24h window opens 2026-11-22 12:05:15 AM EST."
kind: proof
status: open
read-when: "evaluating the post-restart #5609 24-hour live acceptance window after 2026-11-23 12:05:15 AM EST"
---

# November 22 post-restart opening — ACTIVE 24-hour window

Owner: coordinator of [#5609](https://github.com/popcre/shared-db/issues/5609). This is an active post-restart observation opening, not completed acceptance. The same issue retains its unchecked live-proof item until the 24-hour check passes all original thresholds.

## Capacity increase and controlled restart

Executed through the governed workflow `.github/workflows/apply-pgss-capacity-restart.yml` (shipped in PR #6949 and PR #6957; admitted by `popcre/ai-devops` PR #2737 and PR #2746) inside the authorized New York weekend maintenance window (Friday 6:00 PM through Sunday 5:00 AM EST), after [#5610](https://github.com/popcre/shared-db/issues/5610) live evidence was secured:

- Preview-only rehearsal: [run 44987440957](https://github.com/popcre/shared-db/actions/runs/44987440957) (succeeded).
- Preview-and-production execution: [run 44987587373](https://github.com/popcre/shared-db/actions/runs/44987587373) at `a4f86648cbea` — preview passed in 26s, production passed in 2m12s (completed Sunday, November 22, 2026, 12:04 AM EST).

## Post-restart read-only verification and opening capture

Captured via read-only Management API query (`supabase_read_only_user`, `transaction_read_only = on`) with no DDL/DML, statistics reset, synthetic workload, or application writes:

- **Opening capture timestamp (EST):** Sunday, November 22, 2026, **12:05:15.0098 AM EST**
- **Earliest 24-hour eligibility (EST):** Monday, November 23, 2026, **12:05:15.0098 AM EST**
- **Effective capacity:** `pg_stat_statements.max = 40000`, `context = postmaster`, `pending_restart = false`
- **Postmaster start time (EST):** Sunday, November 22, 2026, **12:04:17.092474 AM EST**
- **Statement stats reset (EST):** Sunday, November 22, 2026, **12:04:17.022455 AM EST** (`db_reset = NULL`)
- **Evictions (`dealloc`):** **`0`**
- **Current `pg_stat_statements` entries:** **`123 / 40,000`** (0.3% utilized)

### Functional and structural verification

- **Primary thumbnail drift:** **`0`** mismatches (`style_groups` vs `assets`).
- **Surviving protected index (`#5610`):** `public.idx_assets_tags` (OID `17966`, table OID `17809`, definition MD5 `ef912b57eaaac8358f8a3326e8e12198`, `valid = true`, `ready = true`).
- **`public.assets` triggers:** `26` non-internal triggers present; all `5/5` re-scoped UPDATE triggers carry `IS DISTINCT FROM` predicates (`trg_dam_search_assets_refresh`, `trg_sync_primary_on_thumbnail`, `trg_sync_designer_to_style_group`, `trg_sync_cover_description_to_style_group`, `trg_auto_queue_render`).

### Exact opening baseline vector

- **Complete unfiltered `public.assets` PostgREST update prefix (`with pgrst_source as (update "public"."assets"%`):** **`0`** rows (fresh post-restart baseline; zero pre-existing calls or families).
- **Table counters:** `public.assets` (OID `17809`): `n_tup_upd = 0`, `n_tup_hot_upd = 0`, `n_live_tup = 0`, `n_dead_tup = 0`; `public.dam_search_documents` (OID `713489`): `n_tup_upd = 0`.

## Frozen acceptance contract (unchanged)

At or after **Monday, November 23, 2026, 12:05:15.0098 AM EST**, verify:

- At least **24 real hours** elapsed and at least **100 genuine calls** across the complete unfiltered `public.assets` PostgREST update prefix.
- Unchanged postmaster start time (`2026-11-22 12:04:17.092474 AM EST`), unchanged statement reset (`2026-11-22 12:04:17.022455 AM EST`), and **`dealloc = 0`**.
- Weighted mean runtime strictly below **81.80826627638924305 ms/call**, weighted WAL strictly below **29548.5825136248835 bytes/call**, and search document update rate strictly below **8829/5050.846546 per second**.
- All unchanged functional checks (3 post-opening metadata matches, 10 exact trigger bindings, original image/read access, and 0 thumbnail drift).
- All prior invalidated windows (`20261117-new-opening.md` and earlier) remain preserved as historical records.
