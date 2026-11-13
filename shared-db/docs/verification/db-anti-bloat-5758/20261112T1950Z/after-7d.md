---
summary: "Issue 5758 Step 8 seven-day after-measurement: ColdLion flapping collapsed, hts_rag guards live-proven, bloat findings routed to weekly check."
kind: proof
status: done
read-when: comparing post-fix production state against the 2026-11-05 baseline before closing #5758 Step 8
---

# #5758 Step 8 after-measurement — 7 days (read-only production survey)

Read 2026-11-12 2:39 PM EST (2026-11-12T19:39:20Z) through the pooler
(`aws-1-us-east-1.pooler.supabase.com:6543`, user `postgres.qsllyeztdwjgirsysgai`).
SELECT-only; no writes were made. Baseline for every comparison:
[../20261105T2318Z/baseline.md](../20261105T2318Z/baseline.md) (2026-11-05 6:18 PM EST).

Counter-window caveat (recorded beside every reading per plan §11):
`pg_stat_database.stats_reset` is NULL (never database-wide reset), but
`extensions.pg_stat_statements` was reset **2026-11-06 16:20:19Z**
(`pg_stat_statements_info`: dealloc=37, stats_reset as stated). Per-table
`pg_stat_user_tables` counters are inconsistent with both windows (see §F), so
only `pg_stat_statements` numbers and table-contents queries are used for
verdicts; ambiguous per-table counters are routed to the weekly check (#5886).

## Headline results vs baseline

### A. Step 1 — ColdLion description flapping: collapsed and holding

Nightly `change_log` `updated` rows (table contents, exact):

| day (UTC) | item_merch_group | item_header | all kinds |
|---|---|---|---|
| 2026-11-03 | 44 | 33 | — |
| 2026-11-04 | 18,582 | 4,139 | — |
| 2026-11-05 | 43,415 | 9,000 | 53,088 |
| 2026-11-06 | **0** | 1,213 | 9,995 |
| 2026-11-07 | 1,607 | 3,709 | 5,834 |
| 2026-11-08 | 0 | 0 | — |
| 2026-11-09 | 0 | 0 | 7 |
| 2026-11-10 | 30 | 579 | 651 |
| 2026-11-11 | 122 | 372 | 591 |
| 2026-11-12 | 0 | 2 | 38 |

Post-landing days average ~430 `updated` rows/day across **all** tables vs
~30,000/day for the two flapping tables alone before (gate: >90% drop on the
second nightly run — measured here over a full week: **>98%** and stable).
The rows that remain are real ERP changes, not description flapping: the
newest-3,000 `item_header` sample shows **0/3,000** description-only rows
(baseline: 2,981/3,000); the `item_merch_group` newest-3,000 sample
(1,240/3,000 desc-only) still reaches back into pre-fix days because
post-fix volume is only tens of rows per day.

Label resolution gate held: **68,278 of 252,576** item_merch_group slots have
no `merch_group_detail` match (baseline: 68,289 of 252,269) — unchanged within
noise; codes-only + join resolves everything it did at baseline.

### B. Step 2 — rotation: correct, mass thinning starts 2026-11-15

`change_log` now: **1,012,333 rows, 1,032 MB heap, 1,364 MB total**
(baseline: 1,000,290 / 1,009 MB / 1,322 MB). Growth since the fix is ~430
rows/day, so the heap is effectively frozen until tier deletion begins. The
table's oldest entry is 2026-09-14; the first rows cross the 2-month tier on
**2026-11-14**, so the Sunday 2026-11-15 3:00 AM EST run
(`cron.job` 18 `coldlion-change-log-rotation`, `0 8 * * 0` UTC, active) is
the first with weekly-thinning work to do. First run evidence (2026-11-08):
`cron.job_run_details` succeeded (2 runs observed, return messages "3 rows" /
"1 row"); per-table counters credit **5,073 deletes**; `load-masters`
latest-per-key readers unaffected (newest-entry rule verified at landing).
`hts-rag-ingest-jobs-retention` (job 22, `15 8 * * 0` UTC, active) is
scheduled; no `completed` jobs older than 30 days existed yet at landing.

### C. Step 3b — hts_rag zero-churn guards: live and demonstrably no-op

`pg_stat_statements` (window 2026-11-06 16:20:19Z → read). Statements are
identified by `queryid`:

| queryid | calls | rows | statement (guard tail) |
|---|---|---|---|
| 2351805783924082538 | 3,866 | 3,866 | `update … set raw_json = …, pdf_url = … where ruling_number = $3 and (raw_json is distinct from cast($4 as jsonb) or pdf_url is distinct from …)` |
| -2095444286952926507 | 266 | **10** | guarded extraction update (`category is distinct from :category or hs_era … or extract_version …`; tracked text degenerate) |
| 491124427337006103 | 3,498 | **0** | same guarded family |
| 9050399060618203454 | 93 | **0** | same guarded family |
| -3996444388310845164 | 9 | **0** | same guarded family |

The guarded statements are the exact text added by designflow-backend PR
#372 (merged 2026-11-08 11:29 AM EST, `108a9ed14`; guards in
`helpers/hts-rag/ruling-source.js` and `services/hts-ruling-structure.service.js`
— confirmed present on `main`, `develop`, and `sandbox-albert`). **Zero-churn
behavior is proven on live production**: 3,600 tracked guarded-extraction
calls updated 0 rows (unchanged re-fetch issues no UPDATE that matches), and
the 266-call variant updated 10. The 3,866 raw_json updates all carried
genuinely different payloads (CBP harvest backfill, see §E).

Legacy **unguarded** statements also executed inside the same stats window —
`queryid` -1871266354024110901 (raw_json, 66,880 calls = 66,880 rows),
7425131636557887862 (extraction, 62,216), -5989764895343355110
(`fetched_at`-only, 13,349 — the Step-4-design leftover, not a 3b target).
Their text can only come from pre-#372 code. Timing evidence that they are
history, not a live path: identical totals across three same-evening
snapshots (19:39:20Z, 19:44:35Z, 19:45:48Z) while both worker roles
(`designflow_hts_prod_worker`, `designflow_hts_alsand_worker`) sat idle, and
all three remote branches carry the guards. The stats window opens before
the merge, so it cannot split pre/post deploy. **Conclusive close-out:**
the next full ingest observed with the unguarded totals still frozen and
only guarded statements growing. A 6-hour watcher automation is recorded on
#5758 to capture it.

### D. Steps 3a/4 — PopSG search rows: queue state off the wide row

`public.style_guide_search_documents`: 4,230 updates in the current counter
state, **0 HOT** (window caveat applies; baseline cumulative was 197,739).
`public.style_guide_search_embedding_jobs` (Step 4 side table): 2,892
inserts, **0 updates**, 2,892 deletes — lease/attempt/error state never
touches the wide row; the retention path is cleaning finished jobs.

### E. New findings routed to Step 6 / the weekly check (#5886)

- **`hts_rag.hts_rag_rulings` index bloat: 3,284 MB total on a 179 MB heap**
  (est_rows ~180k after the CBP harvest added 41,970 rulings). The window's
  top writers are the harvest backfill: 1,577,487 `hts_rag_ruling_sentences`
  inserts, 457,978 `hts_rag_ruling_codes`, plus the rulings update burst —
  153,228 updates at 9 HOT (0.006%). This is the textbook case for the
  Step 7 allowlist (table already appears in the plan's §3 initial
  allowlist). No action in this PR; the governed route decides.
- **Ambiguous per-table counters**: `public.style_guide_files` (1,335,968
  upd), `public.dam_search_documents` (1,027,988 upd), `public.assets`
  (561,878 upd) show large per-table update counts that do **not** appear as
  writers in the clean `pg_stat_statements` window (top statement there is
  13,349 rows). Either the writes predate 2026-11-06 16:20Z inside the
  per-table counters' longer history, or they come from many small statement
  variants. The Monday 2026-11-16 weekly reading, with its own full clean
  week of counters, attributes them; recorded here so the comparison is not
  lost.

### F. Step 3d — item_import_unresolved quarantine: still rebuilt each sweep

`plm.item_import_unresolved` current rows 26,429 (baseline 26,504); counters
529,591 inserts / 529,667 deletes (cumulative) — the per-sweep
delete-all/insert-all is still in place, i.e. the conditional Step 3d diff
rewrite was **not** landed. Item-master sweeps themselves: 2026-11-10 8:20
PM EST run updated 3,929 rows; 2026-11-11 and 11-12 AM runs updated 0–8; the
11-12 8:47 AM EST run updated 2,492 (PM sweeps carry real ERP edits; AM
sweeps near-zero — matching the baseline pattern, so no new
always-changing-column signal).

---

## Full survey output

Read at: 2026-11-12T19:39:20.996Z (2026-11-12, 2:39:20 PM EST)
`pg_stat_statements` window: stats_reset **2026-11-06T16:20:19.263Z**;
`pg_stat_database.stats_reset`: NULL.

### User tables over 50 MB (heap/live/index bytes, per-table counters — window caveat §F applies)

| tbl | total MB | heap MB | est_rows | live est MB | n_tup_ins | n_tup_upd | n_tup_hot_upd | n_tup_del | idx_count |
|---|---|---|---|---|---|---|---|---|---|
| hts_rag.hts_rag_rulings | 3284 | 179 | 180k | 151 | 41970* | 153228 | 9 | 0 | 10 |
| public.style_guide_search_documents | 2377 | 460 | 231k | 258 | 1581 | 4230 | 0 | 0 | 14 |
| public.dam_search_documents | 2350 | 462 | 156k | 226 | 45 | 1027989 | 236132 | 0 | 6 |
| plm.nbcu_asset_metadata_value | 2031 | 837 | 2421k | 843 | 0 | 0 | 0 | 0 | 2 |
| coldlion.change_log | 1364 | 1032 | 1012k | 972 | 7129 | 0 | 0 | 5073 | 4 |
| hts_rag.hts_rag_ruling_sentences | 1285 | 855 | 2482k | 513 | 0 | 0 | 0 | 0 | 3 |
| plm.nbcu_asset | 1284 | 726 | 232k | 426 | 0 | 0 | 0 | 0 | 12 |
| public.asset_tags | 1273 | 487 | 2179k | 416 | 39680 | 0 | 0 | 34668 | 6 |
| dam.dam_asset_image_vectors | 1273 | 344 | 142k | 252 | 42 | 0 | 0 | 0 | 4 |
| plm.dcp_metadata_asset | 1272 | 307 | 375k | 324 | 0 | 0 | 0 | 0 | 7 |
| public.assets | 1212 | 390 | 152k | 252 | 29261 | 561878 | 342 | 0 | 46 |
| public.style_guide_files | 976 | 280 | 301k | 447 | 0 | 1335968 | 172131 | 0 | 23 |

\* rulings insert count cross-checked against the 41,970-row INSERT statement
in `pg_stat_statements`; 49 tables over 50 MB were read in total; rows 13–49
are unchanged-in-place from the baseline list (no table left the list; sizes
within ±10% except as discussed above). Raw JSON of all 49 rows is archived
in this session's scratch reading (`5758-after-out.json`, sections B1–B16).

### Top UPDATE/INSERT statements by rows (pg_stat_statements, window 2026-11-06 16:20Z →)

| calls | rows | ms | q |
|---|---|---|---|
| 1,577,487 | 1,577,487 | 713,695 | insert into hts_rag.hts_rag_ruling_sentences (…) |
| 457,978 | 457,978 | 589,775 | insert into hts_rag.hts_rag_ruling_codes (…) |
| 841×6 | 252,300×6 | ~1,400 | insert into _stage_item_merch_group (…) [ColdLion staging] |
| 1 | 251,978 | 61,013 | insert into coldlion.item_merch_group (…) [singleStatement staging swap] |
| 104,376 | 104,376 | — | hts_rag.hts_rag_product_attributes |
| 87,088 | 87,088 | — | hts_rag.hts_rag_heading_decisions |
| 55,707 | 75,179 | — | hts_rag.hts_rag_ruling_current_codes |
| 66,880 | 66,880 | 2,078,655 | update hts_rag.hts_rag_rulings set raw_json=…, pdf_url=… where ruling_number=$3 (unguarded, pre-#372 code) |
| 62,216 | 62,216 | 1,894,183 | update hts_rag.hts_rag_rulings set category=…, extracted_at=now() where ruling_number=$4 (unguarded, pre-#372) |
| 56,970 | 56,970 | — | hts_rag.hts_rag_ruling_products |
| 49,689 | 49,670 | 22,937 | UPDATE hts_rag_ruling_ingest_jobs SET status/claim/lease… (queue by design) |
| 44,784 | 44,784 | 14,279 | UPDATE hts_rag_ruling_ingest_jobs SET status/error_code/completed… (queue by design) |
| 41,970 | 41,970 | 1,193,843 | INSERT INTO hts_rag.hts_rag_rulings (…) [CBP harvest new rulings] |
| 38,778 / 37,917 / 33,147 / 23,182 / 23,019 | same | — | hts_rag product_components / extractions / decision_tests / ruling_links |
| 1 | 26,542 | 3,575 | insert into coldlion.item_detail (…) |
| 16,158 | 16,158 | 11,149 | update public.style_tracker_rows set source_workbook_id… |
| 13,823 | 13,823 | — | INSERT INTO hts_rag.hts_rag_ruling_ingest_jobs |
| 13,349 | 13,349 | 743,587 | UPDATE hts_rag.hts_rag_rulings SET "fetched_at"=$1 (unguarded, Step-4 leftover) |

The ColdLion staging-table pattern (`_stage_item_merch_group` bulk insert +
single-statement swap, 252k rows per nightly run) is the loader's
`load-masters` path working as designed post-#5814; it does not write
`change_log` for unchanged rows (§A).

### pg_cron jobs (relevant)

| jobid | jobname | schedule | active |
|---|---|---|---|
| 18 | coldlion-change-log-rotation | 0 8 * * 0 (Sun 3:00 AM EST) | true |
| 22 | hts-rag-ingest-jobs-retention | 15 8 * * 0 (Sun 3:15 AM EST) | true |

Rotation run history observed: 2026-11-08 08:00:00Z succeeded (42.9 s) and a
08:15 follow-up succeeded; no violations of the newest-entry or 7-day rules
were observed at landing or since.

### Sessions at read time (evidence for §C)

Two HTS worker roles connected through Supavisor, both idle at read:
`designflow_hts_prod_worker` (backends from 19:05Z) and
`designflow_hts_alsand_worker` (19:29Z); last statements were ingest-job
claim/complete queries. No active hts_rag writer mid-flight.

---

## Verdict per plan gate

| Gate | Result |
|---|---|
| Step 1: nightly `updated` rows down >90% | **PASS, week-proven (>98%)** |
| Step 1: labels still resolve (unmatched = baseline) | **PASS** (68,278 vs 68,289) |
| Step 2: rotation scheduled; readers keep newest per key | **PASS** (first thinning work 2026-11-15) |
| Step 3b: unchanged re-fetch issues no UPDATE | **Live-proven on the guarded path; conclusive close-out on next full ingest (watcher recorded)** |
| Step 4: queue state off wide rows | **PASS** (jobs table 0 updates) |
| Step 8 (this file): 7-day reading | **done**; 30-day reading due ~2026-12-05 |

Not passed / not landed, explicitly: Step 3d quarantine diff (open by plan
condition), Step 5 index-audit snapshot 2 (due ≥ 2026-11-20), Step 8 30-day
reading, plan D4 owner decision (surfaced to the owner when he next engages).
