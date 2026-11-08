# public.assets 24-hour reading (popcre/shared-db#5747 Step 7)

Captured read-only on production `qsllyeztdwjgirsysgai` at 7:51 AM EST 2026-11-08 (about 58 h after the
production repack completed 9:47 PM EST Nov 5; the 24 h slot was missed and this reading stands in for it).
Same queries as `after.md`.

| Measure | After repack (9:52 PM EST Nov 5) | 24 h reading (7:51 AM EST Nov 8) |
|---|---|---|
| Heap | 205,717,504 B (196 MB), 24,808 pages | 292,282,368 B (279 MB), 35,679 pages |
| Indexes | 351,264,768 B (335 MB) | 690,479,104 B (658 MB) |
| TOAST | 1,040,384 B (1 MB) | 1,040,384 B (1 MB) |
| Total | 558,153,728 B (532 MB) | 983,982,080 B (938 MB) |
| Live row bytes (`sum(pg_column_size)`) | 193,038,136 B | 217,709,208 B |
| Rows (`count(*)`) | 152,234 | 184,383 (+32,149 ingest) |
| Heap / live bytes | 1.07 | **1.34** (limit 2.0) |
| Index / constraint / user trigger count | 46 / 8 / 25 | 46 / 8 / 26 |
| ACL | `{postgres=arwdDxtm/postgres,anon=…,authenticated=…,service_role=…}` | identical |
| Database size | 29,910,423,219 B | 32,806,188,723 B |

Dead tuples 1,196; last autovacuum 7:34 AM EST Nov 8. HOT 76 / 155,760 updates since stats reset — expected
after Step 2 (remaining writes change GIN-indexed `tags`; HOT criterion recorded as not meaningful on #5747).
The +1 trigger is `zz_assets_refresh_default_visible_flags`, added by Step 5's exact-count flag (PR #5866), not drift.

Largest indexes now (MB): ai_tag_all_candidates 113.1, relative_path_trgm 87.0, relative_path_unique 57.7,
full_text_search 56.3, facet_counts 47.2, embed_stale_cover 39.8, ai_tag_untagged_candidates 26.4,
filename_trgm 25.3. Index growth (335 → 658 MB) outpaces the 21% row growth; GIN/trigram indexes under
tag churn. Not a heap-ratio breach; Step 3 index audit (re-check on or after 2026-11-18) should weigh it.

Heap criterion met: 279 MB ≤ 400 MB and heap ≤ 2x live bytes.

## Search test set

Run https://github.com/u2giants/popdam3/actions/runs/42482253754 (label issue-5747-step7-24h, 7:52-7:58 AM EST Nov 8).
Previous: 42429205132 (Nov 7, after PR #5891).

| Engine | Passed | p50 ms | p95 ms |
|---|---|---|---|
| PopDAM | 118/119 (held) | 1,797 | 4,377 |
| PopSG guides | 48/65 | 880 | 2,272 |
| PopSG files | 54/65 | 868 | 2,261 |

Only miss: com-075 ("star wars toy chest"), the known relevance case. PopDAM typical now 1.8 s (< 3 s).
Another unlabeled Search test set run (42482172267) overlapped this one, so p95 may be inflated.

24-hour criteria met: heap ≤ 2x live bytes; pass count held at 118/119. Next: 7-day reading due 9:47 PM EST Nov 12.
