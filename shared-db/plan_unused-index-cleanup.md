# Plan: drop provably unused large indexes on the shared database
Handoff: [HANDOFF.d/20261105T0203Z-edge-dev3-claude-supabase-assessment-plans.md](HANDOFF.d/20261105T0203Z-edge-dev3-claude-supabase-assessment-plans.md)
Owning issue: popcre/shared-db#popcre/shared-db#5610. Related: #2427 (large-index findings), #1966 (high-churn tables), [plan_database_efficiency_and_api_security.md](plan_database_efficiency_and_api_security.md) Step 7 ("dated index observation" — this plan executes that step for the largest candidates; tick it there when done), [plan_dam-embedding-claim-speed.md](plan_dam-embedding-claim-speed.md) (#5482, house style).

## STATUS (2026-11-04 8:55 PM EST)
| Step | State | Evidence |
|---|---|---|
| 0 Open a trustworthy observation window | ⬜ open | — |
| 1 Re-measure at window end (≥14 days) | ⬜ open | — |
| 2 Code-path proof per drop candidate | ⬜ open | — |
| 3 Migration: drop confirmed candidates | ⬜ open | — |
| 4 Preview rehearsal | ⬜ open | — |
| 5 Land via automatic promotion | ⬜ open | — |
| 6 Live proof (size freed, no regressions) | ⬜ open | — |
| 7 Old DAM claim index follow-up | ⬜ open | — |
Fresh session starts at step 0. Steps 1–6 cannot start before **2026-11-18 8:55 PM EST** (14 days after the window opened).

## 1. Ultimate goal
Albert wants the shared database to cost less and stay fast. Large indexes nobody reads still cost disk, memory (they compete for cache with useful data), backup size, and slow every insert/update on their table. Done means: every index we drop was demonstrably unused over a long, trustworthy window and by every code path we can find, about 1 GB+ of storage is freed, and **no app feature (DAM search, DAM image similarity, style-guide search, HTS ruling search, AI tagging) gets slower or breaks**. A wrongly dropped vector index turns a millisecond search into a full table scan — that is far worse than keeping a useless index. **If a step conflicts with this goal, the goal wins — keep the index, stop, and flag it on #popcre/shared-db#5610.**

## 2. The application
`popcre/shared-db` owns the shared Supabase Postgres used by DesignFlow (`popcre/designflow-*`), POP DAM (`popcre/popdam3`, photo/artwork library), PIM, CRM and HTS tariff ruling search. Schema changes are SQL files in `supabase/migrations/`; CI applies each PR to a preview branch, and the automatic promotion workflow applies merged migrations to production (`docs/production-promotion-procedure.md`). No manual production DDL ever.

## 3. Trigger
A Supabase technician's report (`/home/ahazan/Dropbox/ai/analysis-detail.md` §4, private, on Albert's machine) listed ~30 indexes with zero scans totalling >1.5 GB. Read-only re-check on 2026-11-04 8:53 PM EST (Supabase MCP `execute_sql`) showed **the report's numbers cover only a few hours**: `pg_postmaster_start_time()` = 2026-11-04 12:52:59 PM EST (server restart wipes cumulative statistics; `pg_stat_database.stats_reset` is NULL, so the restart is the reset). Several "unused" indexes in the report are in fact busy.

## 4. Scope
In: deciding keep/drop for the indexes in §6, a forward-only migration dropping the confirmed ones, recorded recreate DDL, preview rehearsal, promotion, live proof.
NOT in: `asset_tags` table bloat/vacuum (see §6 note; belongs on #1966/#2427); foreign-key indexing; duplicate-index findings; any index under 50 MB (do them later in bulk only if this lands cleanly); `REINDEX`; changing any query or function; the ~700 other advisor `unused_index` notices.

## 5. Current state
Nothing built; no branch, PR, or migration. Index definitions and where they were created:
- `dam.dam_asset_image_vectors_vec_siglip_hnsw`, `_vec_dino_hnsw` — `supabase/migrations/20261025163955_dam_image_similarity_vectors.sql` (DAM image similarity, popdam3 #706 GPU embedding work; table currently being filled).
- `public.idx_dam_search_documents_embedding_hnsw` — used by `ORDER BY d.embedding <=> p_query_embedding` in `20261027010904_dam_search_semantic_iterative_scan.sql:108-118`.
- `hts_rag.hts_rag_rulings_search_trgm_idx` — `20261022153149_hts_rag_rulings_precheck_search_indexes.sql` (HTS precheck search, recent). A same-named 16 KB empty copy exists on legacy `public.hts_rag_rulings` (est rows -1, never analyzed).
- `hts_rag.hts_rag_ruling_sentences_hash_idx` — `20261030215400_hts_rag_reasoning_layer.sql` (just shipped; designflow-backend `services/hts-ruling-extract.service.js`, `helpers/hts-rag/fault-line-query.js` read this table).
- `public.idx_style_guide_file_tags_tag_status` — `20260723170000_popsg_file_tags.sql`.
- `public.idx_sgf_directory_path_trgm`, `idx_style_guide_files_tag_search_trgm`, `idx_assets_tags`, `idx_assets_full_text_search` (to_tsvector('simple') refresh functions in `20260928003740`/`20260929040458`/`20260930185929`), `idx_assets_ai_tag_untagged_candidates` (`20260714180000_ai_tagging_keyset_candidates.sql`, `20260714180100_fix_ai_tag_candidate_tier_type.sql`).
- Old `public.dam_search_embedding_claim_idx` (#5482): **not dropped** — 11.8 MB, 9 scans, last 2026-11-04 8:41 PM EST. Its replacement `dam_search_embedding_claim_order_idx` exists and has 118 scans.

## 6. Findings (production, read-only, 2026-11-04 8:53 PM EST; window = ~8 h since 12:52 PM EST restart)
| Index | Size | Scans | Verdict now |
|---|---|---|---|
| idx_sg_search_documents_embedding_hnsw | 686 MB | 401 | **KEEP** — style-guide semantic search, busy |
| idx_assets_relative_path_trgm | 293 MB | 33 | **KEEP** — DAM path search, used |
| asset_tags_forward_asset_id_idx | 216 MB | 20 | **KEEP** — used (bloat question is out of scope) |
| idx_assets_ai_tag_all_candidates | 169 MB | 198 | **KEEP** — AI tagging candidate scan, busy |
| idx_dam_search_documents_embedding_hnsw | 566 MB | 0 | **KEEP** — only index for DAM semantic search `<=>`; zero scans may mean semantic search is rarely called or the planner is choosing a scan; re-evaluate, never drop without EXPLAIN proof |
| dam_asset_image_vectors_vec_siglip_hnsw / _vec_dino_hnsw | 245 MB each | 0 | **KEEP** — just-released DAM image similarity (#706); ~140K vectors loaded (reltuples 139,721) but the search feature may not be live yet; re-evaluate after the feature is live ≥30 days |
| hts_rag.hts_rag_rulings_search_trgm_idx | 355 MB | 0 | **RE-EVALUATE** — recent precheck feature; drop only if 14-day window and code search both show no `%`/`ilike` on `hts_rag_fold_text(...)` |
| hts_rag_ruling_sentences_hash_idx | 116 MB | 0 | **RE-EVALUATE** — shipped 2026-10-30; may serve dedup lookups by `text_hash` |
| idx_style_guide_file_tags_tag_status | 127 MB | 0 | **DROP candidate** |
| idx_sgf_directory_path_trgm | 117 MB | 0 | **DROP candidate** (no `directory_path ilike/%` found in migrations) |
| idx_assets_tags | 85 MB | 0 | **DROP candidate** (no `tags @>`/`&&` found) |
| idx_style_guide_files_tag_search_trgm | 78 MB | 0 | **DROP candidate** (no `tag_search_text ilike/%` found) |
| idx_assets_full_text_search | 66 MB | 0 | **DROP candidate** — verify no query matches its exact expression |
| idx_assets_ai_tag_untagged_candidates | 65 MB | 0 | **DROP candidate** — superseded by `_all_candidates` (same keys, wider predicate), verify function body |
| public.hts_rag_rulings_search_trgm_idx (legacy, empty) | 16 KB | 0 | out of scope (tiny; belongs to legacy-table retirement) |
Drop candidates total ≈ 540 MB; re-evaluate pair adds ≈ 470 MB if they qualify.

`asset_tags` note: report said 12 live / 12.8K dead; now `n_live_tup` 3,865 / `n_dead_tup` 27,265 but `reltuples` ≈ 2.18 M. The live/dead counters were reset by the restart, so the table is **not** nearly empty and its indexes are not unused; earlier `plan_database_efficiency_and_api_security.md` also recorded zero live tuples vs a 2.17 M estimate. Whether autovacuum runs on it is a bloat/vacuum question — out of scope, note it on #1966.

## 7. Rejected approaches
- Drop everything the report listed: rejected — report covered ~8 h; four of its largest are actively used.
- `pg_stat_reset()` to start a clean window: rejected — the restart already gave one, and reset is a production write that wipes evidence other plans rely on.
- `DROP INDEX CONCURRENTLY`: rejected — the promotion pipeline runs migrations in a transaction/pipeline and refuses `CONCURRENTLY` (`docs/production-promotion-procedure.md:284-297`; precedent `20260814193351_pmt_duplicate_name_columns_deprecated.sql:23`). Use plain `DROP INDEX IF EXISTS`; it takes a brief ACCESS EXCLUSIVE lock but does no scanning, so lock time is milliseconds once acquired. Set `lock_timeout` so it fails rather than queues behind long readers.
- Dropping vector indexes because the feature is "low traffic": rejected — rebuilding a 566 MB HNSW index takes many minutes of CPU and blocks writes if done non-concurrently.

## 8. Decisions
Locked (2026-11-04): observation window ≥14 days from 12:52 PM EST 2026-11-04, extended automatically if the server restarts again (restart resets the clock); vector (HNSW) indexes are not dropped in this plan; drops are plain `DROP INDEX IF EXISTS` with `set local lock_timeout = '5s'`; every drop has its recreate DDL in the migration header; one migration for all drops.
Open (implementer judgment): whether the two RE-EVALUATE indexes qualify — criteria: 0 scans over the full window AND no code reference (step 2) AND owning repo's maintainer note on the issue says no planned use.

## 9. Steps
**Step 0 — Open the window (now).** Record in `docs/verification/database-efficiency/<UTC>/unused-index-window-open.md` the output of:
```sql
select pg_postmaster_start_time(), (select stats_reset from pg_stat_database where datname=current_database());
select s.schemaname, s.relname, s.indexrelname, s.idx_scan, s.last_idx_scan, pg_relation_size(s.indexrelid) bytes, pg_get_indexdef(s.indexrelid)
from pg_stat_user_indexes s join pg_index i using (indexrelid)
where not i.indisunique and not i.indisprimary and pg_relation_size(s.indexrelid) > 50*1024*1024 order by bytes desc;
```
Gate: file committed with both timestamps (EST) and every §6 row.

**Step 1 — Re-measure at ≥14 days.** Re-run step 0's queries. If `pg_postmaster_start_time()` changed, the window restarted — wait again. Save as `.../unused-index-window-close.md`. Gate: same postmaster start time; every candidate still `idx_scan = 0`. Any candidate with scans → move to KEEP.

**Step 2 — Code-path proof.** For each surviving candidate: `grep -rn` `supabase/migrations` and `supabase/functions` for the column with `ilike`, `%`, `@>`, `&&`, `to_tsvector('simple'`, `text_hash =`, `tag_id`; run `gh search code --owner popcre "<column>"` (popdam3, designflow-backend, popcrm, poppim). For `idx_assets_full_text_search` confirm no query uses the *identical* tsvector expression and `where is_deleted = false`; for `idx_assets_ai_tag_untagged_candidates` read the latest candidate function and confirm it filters only with the `_all_candidates` predicate. Record each hit/no-hit in `.../unused-index-code-proof.md`. Gate: every drop has a "no reader" line with the searches run.

**Step 3 — Migration** `supabase/migrations/<UTC>_drop_unused_large_indexes.sql`. Header comment: for each index the full `pg_get_indexdef` output (rollback DDL) and its window evidence path. Body:
```sql
set local lock_timeout = '5s';
drop index if exists public.idx_style_guide_file_tags_tag_status;
-- …one line per confirmed candidate, schema-qualified…
```
Gate: `supabase db lint` / repo CI SQL checks pass; no `concurrently` keyword in executable SQL.

**Step 4 — Preview rehearsal.** Open PR (body: `Refs #popcre/shared-db#5610`); CI applies to preview. Run EXPLAIN on preview for representative queries of each affected feature (style-guide tag filter, style-guide path search, DAM full-text search, AI tag candidate claim) and confirm plans don't regress to a Seq Scan on large tables. Gate: CI green and EXPLAIN outputs saved in `.../unused-index-preview.md`.

**Step 5 — Land.** Merge when required checks pass; automatic promotion applies to production. Never run it manually. Gate: promotion workflow run succeeded.

**Step 6 — Live proof.** On production: indexes gone (`select to_regclass('public.<name>')` is NULL), `pg_total_relation_size` of each table dropped by roughly the index size, `pg_stat_statements` for the affected features shows no new slow queries over 24 h. Save `.../unused-index-live-proof.md`; tick checklist on #popcre/shared-db#5610 and Step 7 on the efficiency plan.

**Step 7 — Old DAM claim index.** `dam_search_embedding_claim_idx` still gets scans (9 by 8:41 PM EST). Find which query uses it (EXPLAIN the current claim function and any reset/repair path in `20261101074415_dam_embed_reset_complete.sql`). Drop only if 14-day scans = 0, via the same migration pattern, noting it on #5482.

## 10. Tests
Add `supabase/tests/unused_index_cleanup_contracts.sql` asserting each dropped name is absent (`to_regclass(...) is null`) and each KEEP index in §6 still exists — so a future cleanup can't silently remove a vector index. Existing `supabase test db` suite (including `popdam_image_similarity_contracts.sql`) stays green.

## 11. Constraints
Load `shared-db-change` skill; claim the exact index names on #popcre/shared-db#5610 before writing the migration; `ai-task-gates start --class shared-db`. Production is read-only except via automatic promotion; an open `review-finding` issue blocks promotion. Forward-only migrations; never edit an applied one. Don't hand-edit `types/database.types.ts` (indexes produce no type change). Times in EST. Gotcha: any server restart resets scan counts — always check postmaster start time before trusting `idx_scan`. Gotcha: two indexes share the name `hts_rag_rulings_search_trgm_idx` (public and hts_rag) — always schema-qualify.

## 12. Access
Supabase MCP `execute_sql` (read-only use) on the shared project; `gh` authenticated for `popcre`; CI provides preview branch. No secrets needed in this plan.

## 13. Done, risks, open questions
Done: window evidence files, code proof, migration merged, promotion green, live proof file, contract test green, issue and efficiency plan ticked, this STATUS updated.
Risks: a rare monthly/report query uses a dropped index → slower query; rollback = new forward migration with the recorded `create index` DDL (non-concurrent on 66–127 MB indexes = seconds to a minute of write lock; acceptable off-hours). Open: whether HTS indexes qualify (§8 criteria); whether DAM semantic search really uses its HNSW index (worth an EXPLAIN in a separate issue if 0 scans persist — may be a performance bug, not an unused index).

## Self-audit
1. Fresh session executes without asking? Yes — §5/§6 name every index, file and number; §9 gives SQL, file names and gates; §12 access. Gap fixed: added duplicate-name gotcha and restart-resets-window rule.
2. Background and ruled-out ideas carried? Yes — §3 explains the 8-hour window, §6 shows which report items are busy, §7 records rejected CONCURRENTLY/stat-reset/vector drops with reasons.
3. Goal clear enough for judgment calls? Yes — §1 says "when in doubt keep it", §8 gives explicit criteria for the open RE-EVALUATE pair.
