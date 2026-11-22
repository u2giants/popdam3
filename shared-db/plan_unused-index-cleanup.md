---
summary: "Issue #5610 complete: three zero-scan large indexes dropped via PR #6907 (~277 MB freed), KEEP indexes intact, 30.5h live proof passed."
kind: plan
status: done
read-when: reviewing the completed #5610 large-index cleanup or its Step 6 live proof
---

**November 21 closeout:** Steps 0–7 are complete. Three verified zero-scan indexes (`public.idx_assets_full_text_search`, `public.idx_sgf_directory_path_trgm`, `public.idx_style_guide_files_tag_search_trgm`) were removed via [PR #6907](https://github.com/popcre/shared-db/pull/6907) (`20261225050100`, preview run `44802202957`, production apply run `44802910645`), freeing **277,151,744 bytes (~277 MB)** while preserving all protected, vector, active, and HTS KEEP indexes. Step 6 live proof ([`unused-index-live-proof.md`](docs/verification/database-efficiency/20261122T0208Z/unused-index-live-proof.md)) verified 30.5 continuous post-delivery hours (978/978 2xx, 0 errors, faster than pre-release baseline across every active route), live read-only `EXPLAIN (ANALYZE, BUFFERS)`, and intact app access.

# Plan: drop provably unused large indexes on the shared database
Historical assessment handoff (write-once; current state is this plan and #5610): (handoff retired 2026-11-12; see docs/handoff-review-2026-11-08.md)
Owning issue: popcre/shared-db#5610. Related: #2427 (large-index findings), #1966 (high-churn tables), [plan_database_efficiency_and_api_security.md](plan_database_efficiency_and_api_security.md) Step 7 ("dated index observation" — this plan executes that step for the largest candidates; ticked there), [plan_dam-embedding-claim-speed.md](plan_dam-embedding-claim-speed.md) (#5482, house style).

## STATUS (2026-11-21 complete — all steps delivered and live-proved)
| Step | State | Evidence |
|---|---|---|
| 0 Open a trustworthy observation window | ✅ done | [Restart/new-window receipt](docs/verification/issue-5610-index-observation/20261106-second-restart-window.md), November 6, 2026, 11:25:52.885243 AM EST; both earlier windows invalidated |
| 1 Re-measure at window end (≥14 days) | ✅ done 2026-11-20 | [Post-cutoff catalog receipt](https://github.com/popcre/shared-db/issues/5610#issuecomment-7047117200) (Nov 20, 1:12 PM EST): unchanged postmaster/reset/OIDs, all candidates at 0 scans; 3 candidates ≥50 MiB (277,020,672 bytes); `idx_assets_tags` retained (<50 MiB at 28,418,048 bytes) |
| 2 Code-path proof per drop candidate | ✅ done 2026-11-20 | [November 17 audit](docs/verification/issue-5610-index-observation/20261117-consumer-audit.md) + [post-cutoff refresh](https://github.com/popcre/shared-db/issues/5610#issuecomment-7047183724): all 9 consumers, 18 DesignFlow refs, open PRs/issues, production routines/views/RLS; zero current or planned readers |
| 3 Migration: drop confirmed candidates | ✅ done 2026-11-20 | [PR #6907](https://github.com/popcre/shared-db/pull/6907) (`4f81c0510884364bee4fb92da83489b2863ddffa`), `supabase/migrations/20261225050100_drop_verified_unused_indexes_5610.sql` + `supabase/tests/unused_index_cleanup_contracts.sql` |
| 4 Preview rehearsal | ✅ done 2026-11-20 | Preview run [44802202957](https://github.com/popcre/shared-db/actions/runs/44802202957) + isolated two-pass contract replay (all 7 preservation/absence assertions passed) |
| 5 Land via automatic promotion | ✅ done 2026-11-20 | Production apply run [44802910645](https://github.com/popcre/shared-db/actions/runs/44802910645); independent catalog check at 2:37 PM EST confirmed 3 absent, 4 protected KEEP intact, 277,151,744 bytes freed |
| 6 Live proof (size freed, no regressions) | ✅ done 2026-11-21 | [`unused-index-live-proof.md`](docs/verification/database-efficiency/20261122T0208Z/unused-index-live-proof.md) (Nov 21, 9:08 PM EST): 30.5h Logs API 978/978 2xx (faster than baseline on all active routes), live `EXPLAIN (ANALYZE, BUFFERS)`, structural RPC proof, and intact app access |
| 7 Old DAM claim index decision | ✅ done (KEEP) | Opening snapshot proved 18 scans; retained and verified present in live catalog |
Resume at step 1. Opening snapshot found reads on `idx_style_guide_file_tags_tag_status` (72), `idx_assets_ai_tag_untagged_candidates` (2), and old `dam_search_embedding_claim_idx` (18): KEEP all three; no removal is authorized. All four original candidates remain zero-scan (historical size ~329 MiB); three remain in the removal scope, subject to the full observation and code-path proof, while assets tags is retained below the size cutoff. Execution and acceptance for this scope are tracked on #5610. The session executing its next step records its exact scope and result there. The end-of-window measurement and any removal/delivery/live-proof steps cannot complete before **November 20, 2026, 11:25:52.885243 AM EST** (fourteen days from the measured new opening November 6 at 11:25:52.885243 AM EST; full continuity and all nine then-current consumer proofs remain required). The original November 18 cutoff and November 6 morning opening are invalid after the two recorded restarts. Current positive-reader inspection may proceed now; refresh all nine consumers at the final decision.

**November 17 execution checkpoint, 4:44:17.332395 PM EST production catalog:** the four original candidate OIDs/full definitions, postmaster identity and database-reset identity remain unchanged, all valid/ready with zero scans. Three remain within the current removal scope: directory trigram, style-guide tag-search trigram and assets full-text. Assets tags is currently 28,311,552 bytes, below the 50 MiB cutoff; preserve it. Its executable compatibility containment path is not observed live index use, and normal tag filtering uses effective-tag data. The HTS folded-expression trigram index has a supported current regexp reader and stays KEEP. The sentence-hash index stays retained/not admitted: active hash-based quote-resolution design remains, no current SQL hash lookup was found, and no actual owning-maintainer no-planned-use note exists. Neither HTS index was included in the November 6 eleven-index opening, so neither inherits that interval. The [audit and exact catalogs](docs/verification/issue-5610-index-observation/20261117-consumer-audit.md) distinguish materialized-view directory reads, search-document full-text reads and cache projections from base-index readers. No migration/removal or final official probe exists; no completed no-safe-drops result or live acceptance is claimed. The coordinator owns the three timed candidate decisions and all subsequent justified delivery/proof on this same issue.


## Shared asset-index work with #5747

The asset candidates in this plan also appear in [the broader assets-bloat plan](plan_assets-bloat-permanent-fix.md), Step 3. Their work is performed once on [#5610](https://github.com/popcre/shared-db/issues/5610). Its evidence, keep/drop decision, any migration and tests, and production/live proof supply the result consumed by [#5747](https://github.com/popcre/shared-db/issues/5747).

| Scope | Execution and acceptance record |
|---|---|
| `public.idx_assets_tags` and `public.idx_assets_full_text_search` | #5610, under this plan's existing ≥50 MB scope and complete observation/consumer criteria. #5747 links the same result. |
| Listed style-guide indexes and the existing conditional HTS evaluation | #5610, unchanged by the asset overlap. |
| Other `public.assets` indexes in #5747's wider inventory, including indexes below this plan's size cutoff | #5747 Step 3. Reuse the inventory and reader findings once; keep its residual decisions outside #5610's listed scope. |

The session executing the audit records this split on the existing issues before acting. The broader audit may proceed alongside the style-guide work. Each shared index has one decision and one delivery/live-proof record. Historical positive KEEP decisions and vector protections apply throughout. A verdict for the shared pair does not finish #5747's remaining inventory, and finishing the assets portion does not finish #5610's style-guide/HTS scope.

The current measured opening and conditional earliest date for unchanged #5610 candidates remain November 6, 2026, 11:25:52.885243 AM EST and November 20, 2026 at the same time. A date alone authorizes no removal. Refresh postmaster/statistics identity, per-index OID/definition and monotonic counters, actual size, and all then-current consumer/planned-use evidence at the decision. A rebuild invalidates that index's old identity; it does not by itself reset unrelated candidates' observations. `idx_assets_ai_tag_untagged_candidates` remains KEEP, including after its separate #6011 cover-tier rebuild (`20261110192227_dam_cover_tier_comp_files.sql`).

## 1. Ultimate goal
Albert wants the shared database to cost less and stay fast. Large indexes nobody reads still cost disk, memory (they compete for cache with useful data), backup size, and slow every insert/update on their table. Done means: every index we drop was demonstrably unused over a long, trustworthy window and by every code path we can find, the storage occupied by genuinely eligible indexes is freed, with no removal quota, and **no app feature (DAM search, DAM image similarity, style-guide search, HTS ruling search, AI tagging) gets slower or breaks**. A wrongly dropped vector index turns a millisecond search into a full table scan — that is far worse than keeping a useless index. **If a step conflicts with this goal, the goal wins — keep the index, stop, and flag it on popcre/shared-db#5610.**

## 2. The application
`popcre/shared-db` owns the shared Supabase Postgres used by DesignFlow (`popcre/designflow-*`), POP DAM (`u2giants/popdam3`, photo/artwork library), PIM, CRM and HTS tariff ruling search. Schema changes are SQL files in `supabase/migrations/`; the supported workflow rehearses merged-main migrations on the configured preview, and automatic promotion applies them to production (`docs/production-promotion-procedure.md`). No manual production DDL ever.

## 3. Trigger
A Supabase technician's report (`/home/ahazan/Dropbox/ai/analysis-detail.md` §4, private, on Albert's machine) listed ~30 indexes with zero scans totalling >1.5 GB. Read-only re-check on 2026-11-04 8:53 PM EST (Supabase MCP `execute_sql`) showed **the report's numbers cover only a few hours**: `pg_postmaster_start_time()` = 2026-11-04 12:52:59 PM EST (server restart wipes cumulative statistics; `pg_stat_database.stats_reset` is NULL, so the restart is the reset). Several "unused" indexes in the report are in fact busy.

## 4. Scope
In: deciding keep/drop for the indexes in §6, a forward-only migration dropping the confirmed ones, recorded recreate DDL, preview rehearsal, promotion, live proof.
NOT in: `asset_tags` table bloat/vacuum (see §6 note; belongs on #1966/#2427); foreign-key indexing; duplicate-index findings; any index under 50 MB (do them later in bulk only if this lands cleanly); `REINDEX`; changing any query or function; the ~700 other advisor `unused_index` notices.

## 5. Current state
Opening observation was delivered by [PR #5617](https://github.com/popcre/shared-db/pull/5617), merged as `c51d1966c5dec4effcc313f945baec2847d15f7e`. The [opening snapshot](docs/verification/database-efficiency/20261105T0335Z/unused-index-window-open.md) records November 4, 2026, 10:35 PM EST. No drop migration or index removal has been made. The November 5, 2026, 1:46:38.291291 PM EST restart invalidated that original window. A second restart November 6, 2026, 11:20:19.434455 AM EST invalidated the measured 8:59:18 AM EST successor opening too. Issue #5610 records the new measured opening November 6, 2026, 11:25:52.885243 AM EST, earliest eligibility November 20, 2026, 11:25:52.885243 AM EST, and owns the subsequent verification for its listed candidates. The original November 18 cutoff is no longer sufficient. [The successor receipt](docs/verification/issue-5610-index-observation/20261106-second-restart-window.md) preserves all eleven exact current OIDs, definitions, bytes and counts from the exact November 6, 11:25:52.885243 AM EST collection; previous receipts remain preserved.

Historical positive KEEP decisions remain binding despite reset counters and supersede the historical candidate labels below: `public.idx_style_guide_file_tags_tag_status` (72 scans), `public.idx_assets_ai_tag_untagged_candidates` (2 scans), and `public.dam_search_embedding_claim_idx` (18 scans). The four original observed candidates are `public.idx_sgf_directory_path_trgm`, `public.idx_assets_tags`, `public.idx_style_guide_files_tag_search_trgm`, and `public.idx_assets_full_text_search`: historical opening size 345,194,496 bytes (about 329 MiB), still conditional on the full observation and code-path proof. A restart or statistics reset invalidates the interval. The current 28,311,552-byte assets.tags index (November 17 checkpoint) is below this plan's 50 MiB removal threshold: retain its observation identity, but it is not currently eligible for removal under this scope; apply actual then-current size at the decision. [Fresh positive-reader inspection](https://github.com/popcre/shared-db/issues/5610#issuecomment-6690134767) pins all nine considered consumers and explicit saturation/HTTP429/limited-scope caveats. It found neither a new proven candidate reader nor comprehensive absence; refresh full consumer/planned-use proof at the final decision.

Historical index definitions and creation sources:
- `dam.dam_asset_image_vectors_vec_siglip_hnsw`, `_vec_dino_hnsw` — `supabase/migrations/20261025163955_dam_image_similarity_vectors.sql` (DAM image similarity, popdam3 #706 GPU embedding work; table currently being filled).
- `public.idx_dam_search_documents_embedding_hnsw` — used by `ORDER BY d.embedding <=> p_query_embedding` in `20261027010904_dam_search_semantic_iterative_scan.sql:108-118`.
- `hts_rag.hts_rag_rulings_search_trgm_idx` — `20261022153149_hts_rag_rulings_precheck_search_indexes.sql` (HTS precheck search, recent). A same-named 16 KB empty copy exists on legacy `public.hts_rag_rulings` (est rows -1, never analyzed).
- `hts_rag.hts_rag_ruling_sentences_hash_idx` — `20261030215400_hts_rag_reasoning_layer.sql` (just shipped; designflow-backend `services/hts-ruling-extract.service.js`, `helpers/hts-rag/fault-line-query.js` read this table).
- `public.idx_style_guide_file_tags_tag_status` — `20260723170000_popsg_file_tags.sql`.
- `public.idx_sgf_directory_path_trgm`, `idx_style_guide_files_tag_search_trgm`, `idx_assets_tags`, `idx_assets_full_text_search` (to_tsvector('simple') refresh functions in `20260928003740`/`20260929040458`/`20260930185929`), `idx_assets_ai_tag_untagged_candidates` (`20260714180000_ai_tagging_keyset_candidates.sql`, `20260714180100_fix_ai_tag_candidate_tier_type.sql`).
- Old `public.dam_search_embedding_claim_idx` (#5482): **not dropped** — 11.8 MB, 9 scans, last 2026-11-04 8:41 PM EST. Its replacement `dam_search_embedding_claim_order_idx` exists and has 118 scans.

## 6. Historical findings (production, read-only, 2026-11-04 8:53 PM EST; window = ~8 h since 12:52 PM EST restart)
| Index | Historical size | Historical scans | Historical verdict and current override |
|---|---|---|---|
| idx_sg_search_documents_embedding_hnsw | 686 MB | 401 | **KEEP** — style-guide semantic search, busy |
| idx_assets_relative_path_trgm | 293 MB | 33 | **KEEP** — DAM path search, used |
| asset_tags_forward_asset_id_idx | 216 MB | 20 | **KEEP** — used (bloat question is out of scope) |
| idx_assets_ai_tag_all_candidates | 169 MB | 198 | **KEEP** — AI tagging candidate scan, busy |
| idx_dam_search_documents_embedding_hnsw | 566 MB | 0 | **KEEP** — only index for DAM semantic search `<=>`; zero scans may mean semantic search is rarely called or the planner is choosing a scan; re-evaluate, never drop without EXPLAIN proof |
| dam_asset_image_vectors_vec_siglip_hnsw / _vec_dino_hnsw | 245 MB each | 0 | **KEEP** — just-released DAM image similarity (#706); ~140K vectors loaded (reltuples 139,721) but the search feature may not be live yet; re-evaluate after the feature is live ≥30 days |
| hts_rag.hts_rag_rulings_search_trgm_idx | 355 MB | 0 | **RE-EVALUATE** — recent precheck feature; drop only if 14-day window and code search both show no `%`/`ilike` on `hts_rag_fold_text(...)` |
| hts_rag_ruling_sentences_hash_idx | 116 MB | 0 | **RE-EVALUATE** — shipped 2026-10-30; may serve dedup lookups by `text_hash` |
| idx_style_guide_file_tags_tag_status | 127 MB | 0 | Former DROP candidate; **current KEEP**, 72 scans at the opening snapshot |
| idx_sgf_directory_path_trgm | 117 MB | 0 | **DROP candidate** (no `directory_path ilike/%` found in migrations) |
| idx_assets_tags | 85 MB | 0 | **DROP candidate** (no `tags @>`/`&&` found) |
| idx_style_guide_files_tag_search_trgm | 78 MB | 0 | **DROP candidate** (no `tag_search_text ilike/%` found) |
| idx_assets_full_text_search | 66 MB | 0 | **DROP candidate** — verify no query matches its exact expression |
| idx_assets_ai_tag_untagged_candidates | 65 MB | 0 | Former DROP candidate; **current KEEP**, 2 scans at the opening snapshot; the earlier supersession inference does not authorize removal |
| public.hts_rag_rulings_search_trgm_idx (legacy, empty) | 16 KB | 0 | out of scope (tiny; belongs to legacy-table retirement) |
Historical candidate total was ≈ 540 MB; the four-candidate historical opening total was about 329 MiB (§5). The historical re-evaluate pair adds ≈ 470 MB only if its existing criteria are later met. These measurements are preserved evidence, not a current removal authorization.

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
**Step 0 — Opening/continuity record.** Both earlier openings are invalidated; the new measured opening and exact eleven-index identity baseline are in the November 6 receipt above. Do not reset statistics or substitute restart time for measured opening. On a further reset/restart, invalidate and reopen a full measured fourteen-day interval on the same issue. Original query instructions follow. Record in `docs/verification/database-efficiency/<UTC>/unused-index-window-open.md` the output of:
```sql
select pg_postmaster_start_time(), (select stats_reset from pg_stat_database where datname=current_database());
select s.schemaname, s.relname, s.indexrelname, s.idx_scan, s.last_idx_scan, pg_relation_size(s.indexrelid) bytes, pg_get_indexdef(s.indexrelid)
from pg_stat_user_indexes s join pg_index i using (indexrelid)
where not i.indisunique and not i.indisprimary and pg_relation_size(s.indexrelid) > 50*1024*1024 order by bytes desc;
```
Gate: file committed with both timestamps (EST) and every §6 row.

**Step 1 — Re-measure at ≥14 days.** Re-run step 0's queries. If `pg_postmaster_start_time()` or the statistics-reset identity changed, the observation is invalid — restart the full interval. Save as `.../unused-index-window-close.md`. Gate: unchanged postmaster and reset identities with monotonic counters; every candidate still `idx_scan = 0`. Any candidate with scans → move to KEEP.

**Step 2 — Code-path proof.** For each surviving candidate: `grep -rn` `supabase/migrations` and `supabase/functions` for the column with `ilike`, `%`, `@>`, `&&`, `to_tsvector('simple'`, `text_hash =`, `tag_id`; run `gh search code "<column>" --repo u2giants/popcrm-web --repo u2giants/popdam3 --repo u2giants/poppim-web --repo popcre/designflow-bff --repo popcre/designflow-frontend --repo popcre/designflow-backend --repo popcre/designflow-item-master --repo popcre/designflow-tracking --repo popcre/designflow-data-syncing` (all nine current `.github/workflows/sync.yml` targets; re-read that matrix at execution and include every then-current consumer, with DesignFlow under `popcre`). A failed, truncated or inaccessible repository search is missing evidence, never a no-reader result. For `idx_assets_full_text_search` confirm no query uses the *identical* tsvector expression and `where is_deleted = false`; the three proven KEEP indexes in §5 are excluded from this drop-candidate proof. Record each hit/no-hit in `.../unused-index-code-proof.md`. Gate: every drop has a "no reader" line with the searches run.

**Step 3 — Migration** `supabase/migrations/<UTC>_drop_unused_large_indexes.sql`. Header comment: for each index the full `pg_get_indexdef` output (rollback DDL) and its window evidence path. Body:
```sql
set local lock_timeout = '5s';
drop index if exists public.idx_sgf_directory_path_trgm;
-- …one line per confirmed candidate, schema-qualified…
```
Gate: `supabase db lint` / repo CI SQL checks pass; no `concurrently` keyword in executable SQL.

**Step 4 — Preview rehearsal.** Open PR (body: `Refs popcre/shared-db#5610`) and pass required checks; after merge, the supported merged-main workflow rehearses the exact allowlisted migration on the configured preview. Do not persist a pre-merge migration manually. Under the current rehearsal ownership rules, run EXPLAIN on preview for representative queries of each affected feature (style-guide tag filter, style-guide path search, DAM full-text search, AI tag candidate claim) and confirm plans don't regress to a Seq Scan on large tables. Gate: CI green and EXPLAIN outputs saved in `.../unused-index-preview.md`.

**Step 5 — Land.** Merge when required checks pass; automatic promotion applies to production. Never run it manually. Gate: promotion workflow run succeeded.

**Step 6 — Live proof.** On production: indexes gone (`select to_regclass('public.<name>')` is NULL), `pg_total_relation_size` of each table dropped by roughly the index size, `pg_stat_statements` for the affected features shows no new slow queries over 24 h. Save `.../unused-index-live-proof.md`; tick checklist on popcre/shared-db#5610 and Step 7 on the efficiency plan.

For the no-regression evidence, preserve explicit pre- and post-delivery windows. Use the [statement capture](docs/verification/issue-5610-index-observation/search-performance-capture.sql) and [comparison](scripts/compare_issue_5610_performance.py) only when database and statement identities are continuous. Use the [API request capture](docs/verification/issue-5610-index-observation/search-request-capture.sql) in the [Supabase logs query venue](https://supabase.com/docs/guides/observability/advanced-log-filtering) over comparable windows of at most 24 hours each. It reports request totals, status coverage, server errors and origin timing in the source units for exact routes. These aggregates do not isolate predicates within shared routes and cannot prove health for missing routes, missing fields or absent traffic. Confirm relevant app access and representative plans separately. Neither capture authorizes a removal or substitutes for its live proof.

**Step 7 — Old DAM claim index.** Current KEEP: `dam_search_embedding_claim_idx` has 18 scans in the opening snapshot (the earlier historical measurement was 9 by November 4, 2026, 8:41 PM EST). It cannot satisfy this observation window's zero-scan condition and is not in the current drop set. Any query-use follow-up on #5482 remains separate from removal authorization.

## 10. Tests
Add `supabase/tests/unused_index_cleanup_contracts.sql` asserting each dropped name is absent (`to_regclass(...) is null`) and each KEEP index in §6 still exists — so a future cleanup can't silently remove a vector index. Existing `supabase test db` suite (including `popdam_image_similarity_contracts.sql`) stays green.

## 11. Constraints
Load `shared-db-change`, read [current-workflow.md](docs/agents/current-workflow.md), document exact index scope on popcre/shared-db#5610, start the shared-db task class and use an owned current-upstream worktree with the surviving version/lock/promotion tooling. Retired author-claim/admission commands are not a delivery step. Production is read-only except via automatic promotion; an open `review-finding` issue blocks promotion. Forward-only migrations; never edit an applied one. Don't hand-edit `types/database.types.ts` (indexes produce no type change). Times in EST. Gotcha: any server restart resets scan counts — always check postmaster start time before trusting `idx_scan`. Gotcha: two indexes share the name `hts_rag_rulings_search_trgm_idx` (public and hts_rag) — always schema-qualify.

## 12. Access
Supabase MCP `execute_sql` (read-only use) on the shared project; `gh` authenticated for `popcre`; CI provides preview branch. No secrets needed in this plan.

## 13. Done, risks, open questions
Done: window evidence files, code proof, migration merged, promotion green, live proof file, contract test green, issue and efficiency plan ticked, this STATUS updated.
Risks: a rare monthly/report query uses a dropped index → slower query; rollback = new forward migration with the recorded `create index` DDL (non-concurrent on 66–127 MB indexes = seconds to a minute of write lock; acceptable off-hours). Open: whether HTS indexes qualify (§8 criteria); whether DAM semantic search really uses its HNSW index (worth an EXPLAIN in a separate issue if 0 scans persist — may be a performance bug, not an unused index).

## Self-audit
1. Fresh session executes without asking? Yes — §5/§6 name every index, file and number; §9 gives SQL, file names and gates; §12 access. Gap fixed: added duplicate-name gotcha and restart-resets-window rule.
2. Background and ruled-out ideas carried? Yes — §3 explains the 8-hour window, §6 shows which report items are busy, §7 records rejected CONCURRENTLY/stat-reset/vector drops with reasons.
3. Goal clear enough for judgment calls? Yes — §1 says "when in doubt keep it", §8 gives explicit criteria for the open RE-EVALUATE pair.
