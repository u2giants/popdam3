---
summary: "Nov 18 public.assets index re-check (#5747 Step 3): 12-day window below 14-day gate; no drops; six zero-scan candidates (~34 MB) carry to Nov 20."
kind: proof
status: done
read-when: deciding #5747 Step 3 residual assets index drops
---

# public.assets index re-check (popcre/shared-db#5747 Step 3)

Read-only on production via Supabase MCP `execute_sql` at 9:01 AM EST 2026-11-18
(database clock `2026-11-18 09:01:25 EST`).

Queries:

- `select pg_postmaster_start_time(), (select stats_reset from pg_stat_database where datname=current_database()), count(*), sum(pg_relation_size(indexrelid)) from pg_stat_user_indexes where relid='public.assets'::regclass`
- `select i.indexrelid, i.indexrelname, pg_relation_size(i.indexrelid)/1048576, i.idx_scan, i.last_idx_scan, c.contype from pg_stat_user_indexes i left join pg_constraint c on c.conindid=i.indexrelid where i.relid='public.assets'::regclass`
- `select n_tup_upd, n_tup_hot_upd, n_tup_ins, n_live_tup, n_dead_tup from pg_stat_user_tables where relid='public.assets'::regclass`

## Verdict: no drops today

Counters restart with the server. Postmaster start is **2026-11-06 11:20:19 AM EST**
(`stats_reset` NULL), so 11 days 22 hours are observable — under the plan's
≥14-day gate. This matches #5610's measured opening (Nov 6, 11:25:52 AM EST).
Earliest residual decision: **2026-11-20 11:25 AM EST**, the same moment as #5610,
provided the postmaster start time is unchanged then. No claim and no migration
were made.

46 indexes, 839 MB. Heap 390 MB, 191,049 live rows. Constraint-backed (never drop):
`assets_pkey` (primary key + 17 foreign keys), `assets_relative_path_unique`.

## Zero scans since Nov 6 restart

Shared pair owned by #5610 (not decided here): `idx_assets_full_text_search` 73 MB,
`idx_assets_tags` 27 MB.

Residual #5747 candidates (~34 MB total), with readers found so far:

| index | MB | reader evidence (preliminary) |
|---|---|---|
| idx_assets_pdf_not_deleted | 12 | no `file_type='pdf'` hit in shared-db migrations or popdam3 `apps`/`supabase` |
| idx_assets_ai_tagged_at | 9 | possible readers: popdam3 `admin-handlers/ai-tagging-handlers.ts` (`ai_tagged_at is not null`), migrations ordering by `primary_sort_tier, ai_tagged_at` |
| idx_assets_product_material_gin | 4 | no `@>`/`&&`/`?` on `product_material` found |
| idx_assets_workflow_status | 3 | possible reader: `get_filter_counts` (`workflow_status = ANY(...)`) |
| idx_assets_compat_audit | 3 | possible reader: `20260702220336_ai_sentinel_stats_exact_match.sql` counts `file_type='ai' and not is_deleted` |
| idx_assets_stage | 3 | stage filter in DAM filter functions (to confirm) |

The Nov 20 decision must still refresh the full nine-consumer search (plan_unused-index-cleanup.md Step 2 list).

Former zero-scan indexes that now show reads (KEEP): `idx_assets_relative_path_trgm` 31,
`idx_assets_filename_trgm` 2,641, `idx_assets_primary_sort_tier` 11,335,
`idx_assets_tag_visible_facets` 2, `idx_assets_customer_trgm` 2, `idx_assets_program_trgm` 3,
`idx_assets_file_type` 3, `idx_assets_is_licensed` 3, `idx_assets_pdf_rescan_candidates` 3,
`idx_assets_ai_tag_untagged_candidates` 4 (KEEP per #6011), `idx_assets_tag_pending_facets` 6,
`idx_assets_file_created_at` 10, `idx_assets_modified_at` 19, `idx_assets_status` 13,
`idx_assets_customer` 10, `idx_assets_program` 4, `idx_assets_product_subtype_id` 1,
`idx_assets_thumbnail_error_pattern` 1, `idx_assets_ai_tag_tagged_groups` 2,
`idx_assets_is_deleted` 1,704, `idx_assets_licensing_pdf_backfill_candidates` 190,
`assets_style_group_changed_at_idx` 2,092. All other indexes are busy (hundreds to millions of scans).

## Growth

Total index size: 335 MB (Nov 5 repack) → 658 MB (Nov 6) → 825 MB (Nov 12) → 836 MB (Nov 16) → 839 MB (now).
Growth was fast in the first week and has **plateaued since Nov 12** (+14 MB in 6 days).

| index | Nov 5 | Nov 6 | Nov 12 | Nov 18 |
|---|---|---|---|---|
| idx_assets_relative_path_trgm | 45.8 | 87.0 | 129.0 | 128 |
| idx_assets_ai_tag_all_candidates | 44.8 | 113.1 | 114.6 | 122 |
| idx_assets_full_text_search | 42.0 | 56.3 | 72.9 | 73 |
| idx_assets_facet_counts | 26.4 | 47.2 | 71.5 | 72 |
| assets_relative_path_unique | 31.6 | 57.7 | 66.8 | 67 |
| idx_assets_embed_stale_cover | 19.7 | 39.8 | 49.9 | 49 |
| idx_assets_filename_trgm | 14.3 | 25.3 | 37.9 | 38 |

Why: the repack rebuilt every index fully packed. Since Nov 6 the table took 674,590 updates
with only 658 HOT (0.1%; the remaining writes change GIN-indexed `tags`), so every update adds
entries to all 46 indexes and splits the packed pages until they reach their normal working
density. Trigram GIN (`relative_path_trgm`, ~one entry per three-character path fragment) and the
wide covering `ai_tag_all_candidates` (includes `thumbnail_url, filename, relative_path`) grow
most per update. Rows also rose ~21% (30,460 inserts). The flat last six days show steady state,
not a leak; the weekly health check (#5886) still watches heap/live.
