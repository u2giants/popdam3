---
summary: "Nov 18 #5747 Step 3 close-out: 839 MB indexes, 390 MB heap, ratio 1.82; 14-day gate incomplete, no drops; #5747 stays open with the remainder recorded"
kind: proof
status: done
read-when: closing popcre/shared-db#5747 or deciding the Nov 20 residual assets index candidates
---

# public.assets Step 3 index re-check and close-out (popcre/shared-db#5747)

Independent read-only re-measure on production `qsllyeztdwjgirsysgai` at **9:11–9:14 AM EST
2026-11-18** (database clock `2026-11-18 09:11:41.675815-05`), Supabase Management API
`database/query` with `read_only: true` (token read from 1Password vault `vibe_coding` via
`op read`; value never printed). This is the second Nov 18 reading: it independently confirms
the 9:01 AM EST re-check recorded in
[`../20261118T1403Z/index-recheck.md`](../20261118T1403Z/index-recheck.md) (PR #6682,
popcre/shared-db) — every index size and scan counter below agrees with that record, which
consumers should read for the preliminary reader-evidence notes. Nothing here duplicates or
concludes #5610's shared-pair work.

Queries (each one statement, `read_only: true`):

- identity/sizes: `pg_postmaster_start_time()`, `pg_stat_database.stats_reset`,
  `pg_relation_size('public.assets')`, `sum(pg_relation_size(indexrelid))` over
  `pg_stat_user_indexes` for `relid='public.assets'::regclass`, `pg_database_size`
- per index: `indexrelname`, `pg_relation_size(indexrelid)`, `idx_scan`, `last_idx_scan`,
  `contype` via `pg_constraint.conindid`, `pg_get_indexdef(indexrelid)`
- table: `pg_stat_user_tables` (`n_tup_ins`, `n_tup_upd`, `n_tup_hot_upd`, `n_live_tup`,
  `n_dead_tup`, `last_autovacuum`), `pg_constraint`/`pg_trigger` counts, `relacl`
- live bytes: `select count(*), sum(pg_column_size(a)) from public.assets a`

## Verdict: no drops today; #5747 does not close

Counters restart with the server and `stats_reset` is NULL. Postmaster start is
**2026-11-06 11:20:19 AM EST**, so **11 d 21 h 51 m** are observable at the reading — below the
plan's ≥14-day gate. That matches #5610's measured opening (Nov 6, 11:25:52.885243 AM EST), so
the earliest unchanged-candidate decision for both scopes is **2026-11-20 11:25 AM EST**,
provided the postmaster start time is unchanged then. No drop, no claim, and no migration were
made. The old November 18 date stays invalid (recorded restarts).

## Totals at the reading

| Measure | After repack (9:52 PM EST Nov 5) | 7-day (9:51 PM EST Nov 12) | Weekly (6:05 AM EST Nov 16) | This reading (9:11 AM EST Nov 18) |
|---|---|---|---|---|
| Heap | 205,717,504 B (196 MB) | 408,748,032 B (390 MB) | 408,748,032 B (390 MB) | 408,748,032 B (390 MB) |
| Indexes | 351,264,768 B (335 MB) | 864,919,552 B (825 MB) | 876,765,184 B (836 MB) | 879,763,456 B (839 MB) |
| Live row bytes | 193,038,136 B | 222,630,712 B | 223,972,040 B | 225,020,160 B |
| Rows (`count(*)`) | 152,234 | 186,627 | 187,380 | 187,811 |
| Heap / live bytes | 1.07 | 1.84 | 1.82 | **1.82** (limit 2.0) |
| Index / constraint / user trigger count | 46 / 8 / 25 | 46 / 8 / 26 | 46 / 8 / 26 | 46 / 8 / 26 |
| ACL | `{postgres=arwdDxtm/postgres,anon=…,authenticated=…,service_role=…}` | identical | identical | identical |
| Database size | 29,910,423,219 B | 36,625,225,395 B | 36,683,749,043 B | 40,471,754,419 B |

Dead tuples 11,606; last autovacuum 11:00 AM EST Nov 16. Since the Nov 6 restart: 30,460
inserts, 674,722 updates, 658 HOT (0.1% — expected: the remaining writes change GIN-indexed
`tags`, recorded on #5747 at Step 2).

## Index inventory and Step 3 dispositions (46 indexes)

Rules applied (plan Step 3 + `plan_unused-index-cleanup.md` §5): constraint-backed indexes are
never dropped; any index with scans in the trustworthy interval is KEEP; positive historical
KEEP decisions and vector protections bind (`idx_assets_ai_tag_untagged_candidates`, KEEP per
#6011); the shared pair is decided once on #5610; a zero-scan residual needs its own complete
reader/constraint/planned-use proof **and** a ≥14-day interval before any drop. Sizes in MiB;
`scans` = `idx_scan` since the Nov 6 restart.

| index | MiB | scans | role | disposition |
|---|---|---|---|---|
| idx_assets_relative_path_trgm | 129.0 | 31 | gin trgm, DAM path search | KEEP |
| idx_assets_ai_tag_all_candidates | 122.9 | 5,755 | AI tagging candidate scan | KEEP |
| idx_assets_full_text_search | 73.4 | 0 | gin to_tsvector partial | out-of-scope → #5610 shared pair |
| idx_assets_facet_counts | 72.5 | 439 | facet counts | KEEP |
| assets_relative_path_unique | 67.9 | 1,212,955 | unique constraint | KEEP (constraint) |
| idx_assets_embed_stale_cover | 49.9 | 24,395,459 | embedding refresh | KEEP |
| idx_assets_filename_trgm | 38.0 | 2,641 | filename search | KEEP (was zero-scan Nov 5) |
| idx_assets_tags | 27.0 | 0 | gin (tags) | out-of-scope → #5610 shared pair (below its 50 MiB cutoff; broader reconsideration stays here) |
| idx_assets_tag_visible_facets | 26.4 | 2 | facet load | KEEP (was zero-scan Nov 5) |
| idx_assets_ai_tag_untagged_candidates | 26.0 | 4 | tagging queue | KEEP (positive decision #6011) |
| idx_assets_quick_hash | 23.2 | 61,733 | dedupe lookup | KEEP |
| idx_assets_primary_sort_tier | 15.7 | 11,335 | ordering | KEEP (was zero-scan Nov 5) |
| idx_assets_program_trgm | 15.4 | 3 | program search | KEEP (was zero-scan Nov 5) |
| assets_style_group_changed_at_idx | 14.4 | 2,092 | style-group cursor | KEEP (was zero-scan Nov 5) |
| idx_assets_pdf_not_deleted | 12.4 | 0 | partial pdf | residual candidate → carry to Nov 20 decision |
| idx_assets_ai_tagged_at | 9.6 | 0 | partial ai-tagged | residual candidate → carry to Nov 20 decision (possible readers found) |
| assets_style_group_id_active_idx | 9.2 | 32,348,624 | active lookup | KEEP |
| assets_pkey | 9.2 | 1,180,839 | primary key, 17 FKs | KEEP (constraint) |
| idx_assets_customer_trgm | 9.1 | 2 | customer search | KEEP (was zero-scan Nov 5) |
| idx_assets_tag_rls_visible_ids | 8.2 | 7,976 | RLS helper | KEEP |
| idx_assets_modified_at | 6.0 | 19 | range filter | KEEP (was zero-scan Nov 5) |
| idx_assets_clear_style_cursor | 5.9 | 147,774 | cursor | KEEP |
| idx_assets_file_created_at | 4.9 | 10 | range filter | KEEP (was zero-scan Nov 5) |
| idx_assets_product_material_gin | 4.3 | 0 | gin (product_material) | residual candidate → carry to Nov 20 decision |
| idx_assets_stage | 3.8 | 0 | btree (stage) | residual candidate → carry to Nov 20 decision (possible reader: DAM stage filter) |
| idx_assets_customer | 3.7 | 10 | btree (customer) | KEEP (was zero-scan Nov 5) |
| idx_assets_workflow_status | 3.7 | 0 | btree (workflow_status) | residual candidate → carry to Nov 20 decision (possible reader: `get_filter_counts`) |
| idx_assets_file_type | 3.7 | 3 | btree (file_type) | KEEP (was zero-scan Nov 5) |
| idx_assets_licensor_id | 3.6 | 13,780 | FK-style lookup | KEEP |
| idx_assets_program | 3.6 | 4 | btree (program) | KEEP (was zero-scan Nov 5) |
| idx_assets_is_deleted | 3.6 | 1,704 | filter | KEEP (was zero-scan Nov 5) |
| idx_assets_property_id | 3.5 | 148,212 | FK-style lookup | KEEP |
| idx_assets_compat_audit | 3.4 | 0 | partial ai audit | residual candidate → carry to Nov 20 decision (possible reader: ai-sentinel stats) |
| idx_assets_style_group_id | 3.3 | 303,100 | FK-style lookup | KEEP |
| idx_assets_status | 3.3 | 13 | btree (status) | KEEP (was zero-scan Nov 5) |
| idx_assets_sku_division_active | 3.3 | 136,062 | SKU assignment | KEEP |
| idx_assets_is_licensed | 3.3 | 3 | filter | KEEP (was zero-scan Nov 5) |
| idx_assets_product_subtype_id | 3.1 | 1 | FK-style lookup | KEEP (was zero-scan Nov 5) |
| assets_ungrouped_style_cursor_idx | 2.4 | 73,564 | cursor | KEEP |
| idx_assets_tag_pending_facets | 2.1 | 6 | facet queue | KEEP (was zero-scan Nov 5) |
| idx_assets_ai_tag_tagged_groups | 1.6 | 2 | grouping | KEEP (was zero-scan Nov 5) |
| idx_assets_pdf_rescan_candidates | 1.2 | 3 | rescan queue | KEEP (was zero-scan Nov 5) |
| idx_assets_licensing_pdf_backfill_candidates | 1.2 | 190 | backfill queue | KEEP (was zero-scan Nov 5) |
| assets_customer_id_idx | 0.9 | 503 | FK-style lookup | KEEP |
| idx_assets_thumbnail_error_pattern | 0.2 | 1 | error triage | KEEP |
| idx_assets_has_product_material | 0.2 | 413 | filter | KEEP |

Tally: 38 KEEP (incl. 2 constraint-backed), 2 out-of-scope on #5610, 6 residual candidates
carried to the Nov 20 decision. Residual candidate bytes: **38,969,344 B (37.2 MiB)**. 22 of the
28 indexes that were zero-scan on Nov 5 now show reads and are KEEP; nothing else may drop
today. Each residual candidate still needs its own refreshed full nine-consumer
reader/constraint/planned-use proof at the decision (preliminary notes are in PR #6682's
re-check; four of the six already show possible readers).

## Growth weighing (335 → 658 → 825 → 839 MB)

Total index bytes: 335 MB (Nov 5, post-repack) → 658 MB (Nov 8) → 825 MB (Nov 12) → 836 MB
(Nov 16) → **839 MB (now)**. The repack rebuilt every index fully packed; since then 674,722
non-HOT updates (writes that change GIN-indexed `tags`) split those pages and trigram GIN
(`relative_path_trgm`, one entry per three-character path fragment) and the wide covering
`ai_tag_all_candidates` grew most per update, while rows rose 23%. Growth has **plateaued**:
+14 MB in the last six days versus +167 MB in one early 24 h window. This is steady working
density, not a leak. **No rebuild is proposed**: a reindex would only re-pack pages that the
same write stream splits again, and the governed weekly health check (`db-bloat-weekly.yml`,
#5886) continues to watch heap/live. Index reduction stays with Step 3's drop candidates, which
are gated to Nov 20.

## §13 close-out evaluation

| §13 item | Status | Evidence |
|---|---|---|
| heap ≤ 400 MB | MET | 390 MB now; byte-identical Nov 12 → Nov 16 → now |
| heap ≤ 2x live bytes for 7 days | MET | 1.82 now (limit 2.0); 1.84 at the 7-day reading, 1.82 at the Nov 16 weekly |
| HOT ratio ≥ 70% | RETIRED by recorded evidence | After Step 2 the remaining writes change GIN-indexed `tags`; 0% HOT is expected and the criterion was retired with the daily bloat job (plan Step 6; recorded on #5747) |
| broad-search total < 3 s; Search test set typical < 3 s with unchanged pass count | MET (last scored run) | u2giants/popdam3 run 43355019011 (Nov 12): PopDAM 119/119, p50 1.0 s, p95 2.2 s; later runs in the window hold 119/119 |
| all PRs merged | NOT MET | the Nov 18 re-check evidence PR (#6682) is still open at this writing |
| migrations promoted; popdam3 writers deployed | MET | recorded in plan STATUS Steps 1–5 |
| STATUS table updated with artifacts | NOT MET | the Step 3 row update rides in open PR #6682 |
| handoff updated | NOT MET | owed at final close-out |
| Step 3 complete (plan gate for close) | NOT MET | the 14-day interval is incomplete (11 d 21 h); six residual candidates and the shared pair have no final keep/drop/out-of-scope disposition yet, and no removals have been delivered. Merely linking #5610 does not finish the step |

**Close-out verdict: #5747 stays open.** Exactly what remains:

1. **2026-11-20, 11:25 AM EST** (only if the postmaster start is unchanged): final keep/drop
   decisions on the six residual zero-scan candidates (38,969,344 B) after refreshing each
   one's full nine-consumer reader/constraint/planned-use proof; the shared pair
   (`idx_assets_tags`, `idx_assets_full_text_search`) is decided and executed once on #5610 and
   its result is linked here.
2. Any qualifying removals: one migration with per-index evidence and recreate DDL, contract
   tests asserting the absence plus retained constraint/KEEP indexes
   (`supabase/tests/unused_index_cleanup_contracts.sql` shared with #5610), preview + automatic
   promotion, and a ≥24 h no-regression proof recorded once per removed index.
3. Land the open evidence PRs (this record and #6682), then the final STATUS table touch and
   handoff update, then close #5747 with live proof against §13.

Posted evidence for this reading: this file (PR from `mimo/5747-step3-closeout`). No production
object was changed; all reads used `read_only: true`.
