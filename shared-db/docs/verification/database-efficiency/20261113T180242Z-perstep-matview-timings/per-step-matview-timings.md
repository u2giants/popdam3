---
summary: "Per-step matview refresh timings measured on preview 2026-11-13: file_groups 2.251 s, folders 0.325 s, search 0.020 s (empty queue), all 2.686 s; search-step loaded cost remains an explicit boundary"
kind: proof
status: done
read-when: checking the per-step split of public.refresh_style_guide_matviews(p_run_id, p_search_batch_size, p_step) or Step 3 residual unknowns in plan_database_efficiency_and_api_security.md
---

# Per-step matview refresh timings — preview — 2026-11-13

**Plan / issue:** `plan_database_efficiency_and_api_security.md` Step 3 / popcre/shared-db #2326
**Recorded:** 2026-11-13T18:02:42Z–18:02:48Z (1:02 PM – 1:03 PM EST)
**Session:** MiMo chat (session id unknown) on edge-dev
**Scope:** the four timed `p_step` calls of
`public.refresh_style_guide_matviews(p_run_id uuid, p_search_batch_size integer, p_step text)`
on the **preview** branch only (`shared-db-schema-rehearsal`), executed through the
Supabase Management API `database/query` endpoint (pattern: `scripts/catalog-truth.mjs`).
No production call. No migration re-apply. No row contents, no credentials, no preview
project ref in this artifact (standing rule). Raw captures live beside this file (`q*.json`).

## Method

Each step was timed inside one SQL statement on preview, wall clock measured by the
database itself (`clock_timestamp()` before and after the call), so the figure is
server-side function time, not HTTP round trip:

```sql
select extract(epoch from clock_timestamp()-t0) as seconds, r.*
from (select clock_timestamp() as t0) s,
lateral (select * from public.refresh_style_guide_matviews(
  p_run_id=>null, p_search_batch_size=>5000, p_step=>'<step>')) r;
```

- Steps run in order: `file_groups`, `folders`, `search`, `all` (each its own statement).
- `p_run_id => null` (no crawl run attached), `p_search_batch_size => 5000` (the function's
  default bound shape).
- The four timed calls used the Management API `read_only: false` **on preview only**;
  every context/count query used `read_only: true`.
- Management API HTTP status for all seven queries: 201. No timeout occurred, so the
  pg_cron fallback was not needed.
- API role observed on the read-only context query: `supabase_read_only_user`
  (same role class as the 2026-11-13 residual capture). The `read_only: false` timed
  calls executed successfully on preview.

## Timing results (server-side seconds)

| p_step | seconds | search_documents_synced | preview relation refreshed |
|---|---|---|---|
| `file_groups` | **2.251000** | 0 | `public.style_guide_file_groups` (REFRESH MATERIALIZED VIEW CONCURRENTLY) |
| `folders` | **0.324598** | 0 | `public.style_guide_folders` (REFRESH MATERIALIZED VIEW CONCURRENTLY) |
| `search` | **0.020401** | 0 | bounded `style_guide_search_documents` upsert sync (queue drain) |
| `all` | **2.685723** | 0 | both refreshes plus one search batch |

The `all` figure (2.686 s) is consistent with the sum of the three steps
(2.251 + 0.325 + 0.020 = 2.596 s) plus small per-call overhead — the split accounts
for the whole call.

## Interpretable context (preview row counts)

Counts read before and after the four calls (`q1-counts-before.json`, `q6-counts-after.json`;
unchanged across the window):

| Relation | rows |
|---|---|
| `public.style_guide_file_groups` | 20,610 |
| `public.style_guide_folders` | 379 |
| `public.style_guide_search_documents` | 217,193 |
| `public.style_guide_search_sync_queue` | 0 |

## Boundaries (record explicitly; do not over-read these numbers)

1. **These are PREVIEW numbers on preview-sized data.** Preview holds 20,610 file-group
   rows and 217,193 search documents; production scale differs (Step 2 recorded 22,045
   style-guide file-group rows readable cross-boundary at that time). The split
   *proportions* are informative; the absolute seconds are not production timings.
2. **The `search` figure is an empty-queue drain.** `style_guide_search_sync_queue` held
   0 rows before and after, and every call returned `search_documents_synced = 0`.
   0.020 s is therefore the cost of the step when there is nothing to sync — **not** the
   cost of a loaded upsert sync. The loaded search-step cost remains an explicit named
   boundary (needs a populated queue, i.e. a crawl-window or seeded queue on preview).
3. `p_run_id => null` means no `style_guide_crawl_runs` row was written or accumulated;
   per-run attribution was not in scope of this capture.
4. Production writes and production calls were not performed (read-only boundary intact).

## Reproduction

- Query shapes as in **Method** above against the preview branch of the shared Supabase
  project (project ref from the repository variable `PREVIEW_PROJECT_REF`; never persisted).
- Credential: 1Password `op://vibe_coding/Supabase CLI Personal Access Token/SUPABASE_ACCESS_TOKEN`,
  piped, never printed.
- Raw per-query captures: `q0-context.json`, `q1-counts-before.json`,
  `q2-timed-file_groups.json`, `q3-timed-folders.json`, `q4-timed-search.json`,
  `q5-timed-all.json`, `q6-counts-after.json`.

Posted by MiMo chat unknown on edge-dev
