---
summary: "public.assets immediately after the governed production repack (#5747): total 3,496 MB to 532 MB, heap 196 MB, measured read-only 2026-11-05."
kind: proof
status: done
read-when: confirming the result of the assets table repack
---

# public.assets after repack (popcre/shared-db#5747 Step 4 / Step 7, immediate reading)

Captured read-only on production `qsllyeztdwjgirsysgai`, 9:52-9:56 PM EST 2026-11-05, minutes after
the governed production repack (run https://github.com/popcre/shared-db/actions/runs/42151590867:
preflight passed 9:41 PM EST, outcome complete 9:47 PM EST; preview run 42150067190 complete 9:30 PM EST).
Same queries as `baseline.md`. The plan's 24-hour and 7-day readings follow as separate files.

| Measure | Before (6:31 PM EST) | After (9:52 PM EST) |
|---|---|---|
| Heap | 2,122,317,824 B (2,024 MB), 259,072 pages | 205,717,504 B (196 MB), 24,808 pages |
| Indexes | 1,410,039,808 B (1,345 MB) | 351,264,768 B (335 MB) |
| TOAST | 131,129,344 B (125 MB) | 1,040,384 B (1 MB) |
| Total | 3,666,231,296 B (3,496 MB) | 558,153,728 B (532 MB) |
| Live row bytes (`sum(pg_column_size)`) | 192,839,464 B | 193,038,136 B |
| Rows | reltuples 151,540 | count(*) 152,234 (normal ingest) |
| Index / constraint / user trigger count | 46 / 8 / 25 | 46 / 8 / 25 |
| ACL | `{postgres=arwdDxtm/postgres,anon=…,authenticated=…,service_role=…}` | identical |
| Database size | 32,832,771,763 B | 29,910,423,219 B |

Leftover objects in schema `repack`: only the extension's own views `primary_keys`, `tables`.
Dead tuples 1,317; HOT 104,895 / 186,926 updates (56.1%, cumulative since stats reset; Step 2 owns this).
Largest indexes now (MB): relative_path_trgm 45.8, ai_tag_all_candidates 44.8, full_text_search 42.0,
relative_path_unique 31.6, facet_counts 26.4, embed_stale_cover 19.7, filename_trgm 14.3, tags 13.5.

Step 4 done criterion met: heap 196 MB ≤ 400 MB with index/trigger/constraint/ACL counts unchanged.
## Search test set (same set hash 13cdb9a02949, version 2026-11-04)

Before: https://github.com/u2giants/popdam3/actions/runs/42089911882 (2:01 PM EST). After: https://github.com/u2giants/popdam3/actions/runs/42153147056 (9:54-10:10 PM EST, label after-assets-repack-5747).

| Engine | Passed before → after | p50 ms before → after | p95 ms before → after |
|---|---|---|---|
| PopDAM | 108/119 → 112/119 | 4,138 → 4,325 | 7,894 → 9,941 |
| PopSG guides | 48/65 → 48/65 | 2,777 → 2,297 | 4,756 → 6,677 |
| PopSG files | 54/65 → 54/65 | 2,659 → 1,945 | 3,494 → 4,643 |

Pass counts held or rose (no result lost). PopDAM latency did not improve on this first post-repack run,
taken minutes after the rewrite (new relation files, cold cache) and alongside other production work.
The 24-hour reading is the fair latency comparison; the exact-count probe (plan Step 5) remains the main
remaining PopDAM cost.
