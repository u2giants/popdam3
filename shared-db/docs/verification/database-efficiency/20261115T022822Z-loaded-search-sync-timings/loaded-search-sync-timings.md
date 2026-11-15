---
summary: "Loaded search-sync cost on preview 2026-11-14: 100/1,000/5,000 queued rows cost 0.148/0.676/3.122 s of real upsert sync; pdf-text D-weight path unmeasured."
kind: proof
status: done
read-when: checking the loaded cost of the refresh_style_guide_matviews p_step 'search' queue drain, Step 3 residual unknowns in plan_database_efficiency_and_api_security.md, or the loaded-search boundary named in the 2026-11-13 per-step matview timing capture
---

# Loaded search-sync cost — preview — 2026-11-14

**Plan / issue:** `plan_database_efficiency_and_api_security.md` Step 3 / popcre/shared-db #2326
**Recorded:** 2026-11-15T02:28:22Z–02:28:39Z (2026-11-14, 9:28 PM EST)
**Session:** MiMo chat "shared-db #2326 claim-first Step 3 pickup" (ses_ffe5e230) on edge-dev
**Scope:** the `p_step => 'search'` call of
`public.refresh_style_guide_matviews(p_run_id uuid, p_search_batch_size integer, p_step text)`
on the **preview** branch only (`shared-db-schema-rehearsal`), with
`public.style_guide_search_sync_queue` seeded to a known load and every seeded row's
search document made stale so the drain performs real upsert work. Executed through
the Supabase Management API `database/query` endpoint (pattern: `scripts/catalog-truth.mjs`).
No production call. No migration. No counter reset (the #1966 observation window is
undisturbed). No row contents, no credentials, no preview project ref in this artifact
(standing rule). Raw captures live beside this file (`q*.json`, `s*.json`, `t*.json`,
`c*.json`).

This closes boundary 2 of
`20261113T180242Z-perstep-matview-timings/per-step-matview-timings.md`
("the loaded search-step cost remains an explicit named boundary"): the loaded upsert-sync
cost is now measured. The 2026-11-13 capture is left unedited as the dated record of the
empty-queue split it measured.

## Method

Timing is the same as the 2026-11-13 capture: server-side wall clock, measured by the
database itself (`clock_timestamp()` before and after the call), so the figure is
server-side function time, not HTTP round trip. Each call is its own statement:

```sql
select extract(epoch from clock_timestamp()-t0) as seconds, r.*
from (select clock_timestamp() as t0) s,
lateral (select * from public.refresh_style_guide_matviews(
  p_run_id=>null, p_search_batch_size=>5000, p_step=>'search')) r;
```

- `p_run_id => null` (no crawl run attached), `p_search_batch_size => 5000` in every
  timed call — the caller's actual bound shape (`u2giants/popdam3`
  `complete-style-guide-crawl`). With N queued candidates and a 5000 bound, each call
  drains the whole seeded load in one statement, as a change-night caller would.
- All write statements (seeding and the timed calls) used the Management API
  `read_only: false` **on preview only**; every context/count query used
  `read_only: true`. Management API HTTP status for all fourteen queries: 201. No
  timeout occurred, so the pg_cron fallback was not needed.
- API role observed: `supabase_read_only_user` on the read-only context query;
  `current_user = session_user = postgres` on the write-context query
  (`q0b-write-role.json`). All three touched relations have RLS enabled
  (`q0c-catalog.json`); the writes ran as the `postgres` session.
  `style_guide_search_documents` and `style_guide_search_sync_queue` show zero internal
  triggers, so the seeding UPDATE fired no extra work.

## Seeding — what "loaded" means here

A queued file is a drain candidate only when its document is missing or stale
(`d.source_identity is distinct from md5(...)`, or `is_active` mismatch). A queue full of
up-to-date documents would drain as another empty pass. So each scenario seeds **both**
halves of the real change-night condition, in one statement:

```sql
with target as (
  select d.style_guide_file_id
    from public.style_guide_search_documents d
    join public.style_guide_files f on f.id = d.style_guide_file_id
   where f.is_active
   order by md5(d.style_guide_file_id::text)   -- deterministic pseudo-random spread
   limit N
),
stale as (
  update public.style_guide_search_documents d
     set source_identity = 'mimo-2326-loaded-stale'
    from target t where d.style_guide_file_id = t.style_guide_file_id
  returning 1
),
queued as (
  insert into public.style_guide_search_sync_queue (style_guide_file_id)
  select style_guide_file_id from target
  on conflict (style_guide_file_id) do update set queued_at = excluded.queued_at
  returning 1
)
select (select count(*) from stale) as stale_updated,
       (select count(*) from queued) as queued_rows, ...;
```

- `order by md5(style_guide_file_id::text)` spreads the seeded ids across the id space
  instead of taking the physically first N rows (which would sit in hot cache and
  understate the cost).
- The staleness branch exercised is the `source_identity` mismatch branch — the one a
  changed file takes. The drain recomputes the correct `source_identity`, rewrites the
  full document row (including `search_vector` weights A/B/C) and retires the queue
  entry.
- Seeding is self-healing: every scenario's post-count query proved
  `stale_markers_left = 0` and `queue_rows = 0`, and `search_documents` stayed
  217,193 throughout (`c1-*.json`, `q9-final.json`). Nothing on preview was left
  changed.

## Timing results (server-side seconds)

| queue rows seeded (N) | seconds | `search_documents_synced` | per row |
|---|---|---|---|
| 100 | **0.147996** | 100 | 1.480 ms |
| 1,000 | **0.675761** | 1,000 | 0.676 ms |
| 5,000 | **3.122495** | 5,000 | 0.624 ms |

For contrast, the empty-queue drain measured 2026-11-13: **0.020401 s** with
`search_documents_synced = 0`. A loaded full-caller-batch (5,000 rows) therefore costs
about **153×** the empty pass and about **3.1 s**, versus the 8 s authenticator ceiling
the steppable split exists to stay under.

Two-point fit on the 1,000 and 5,000 rows: **~0.06 s fixed + ~0.61 ms per queued row**.
The per-row figure falls slightly as N grows (1.48 → 0.62 ms), consistent with fixed
per-statement overhead amortizing over the batch.

## Interpretable context (preview row counts)

Counts read before and after the scenario loop (`q1-counts-before.json`, `q9-final.json`;
unchanged across the window):

| Relation | rows |
|---|---|
| `public.style_guide_files` (active) | 217,193 |
| `public.style_guide_search_documents` | 217,193 |
| `public.style_guide_search_sync_queue` | 0 (before and after; seeded loads fully drained) |
| `public.style_guide_pdf_text` | **2** |

Document-row scale is representative of production (the 2026-09-15 crawl reported
217,047 files), so the queue-scan and upsert row counts are production-shaped.

## Boundaries (record explicitly; do not over-read these numbers)

1. **These are PREVIEW numbers.** The absolute seconds are not production timings; the
   per-row shape and the 5,000-row batch figure are the interpretable part.
2. **The pdf-text D-weight path is NOT in these numbers.** Preview holds only **2**
   `style_guide_pdf_text` rows (`seeded_with_pdf_text = 0` in all three seeds), so the
   `setweight(to_tsvector('simple', left(coalesce(t.extracted_text, ''), 200000)), 'D')`
   rebuild — plausibly the dominant production cost for PDF-heavy change nights — did
   not run for any seeded row. Production loaded cost with real extracted text remains
   unmeasured and is the surviving unknown of this boundary.
3. **Staleness was seeded by a `source_identity` marker**, not by real identity-input
   changes to `style_guide_files` (which would also fire the enqueue trigger and alter
   file metadata). The upsert path exercised is the one a changed file takes; the
   trigger-enqueue path itself was not timed.
4. **The retire-only path is not separately measured.** Queue entries that are already
   satisfied (e.g. deactivated files) are removed by the same call's retire delete
   without upserting; a deactivation-heavy night pays a different, smaller cost.
5. `p_run_id => null` means no `style_guide_crawl_runs` row was written or accumulated.
6. Production writes and production calls were not performed (read-only boundary
   intact). WAL delta and dead-tuple attribution were not measured; no statistics
   counter was reset.
7. A preview apply in flight while this ran would contend for the same rows; no such
   activity was observed (all fourteen statements returned 201 on first attempt).

## Reproduction

- Query shapes as in **Method** and **Seeding** above against the preview branch of the
  shared Supabase project (project ref from the repository variable
  `PREVIEW_PROJECT_REF`; never persisted).
- Credential: 1Password
  `op://vibe_coding/Supabase CLI Personal Access Token/SUPABASE_ACCESS_TOKEN`,
  piped, never printed.
- Raw per-query captures: `q0-context.json`, `q0b-write-role.json`, `q0c-catalog.json`,
  `q1-counts-before.json`, then per scenario N ∈ {100, 1000, 5000}
  (`s1-seed-n<N>.json`, `t1-timed-search-n<N>.json`, `c1-counts-after-n<N>.json`),
  then `q9-final.json`.

Posted by MiMo chat "shared-db #2326 claim-first Step 3 pickup" (ses_ffe5e230) on edge-dev
