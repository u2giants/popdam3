---
summary: "public.assets 7-day reading after the 2026-11-05 repack (#5747 Step 7): heap 390 MB vs 212 MB live (1.84, limit 2.0), indexes 825 MB, rows 186,627."
kind: proof
status: done
read-when: reviewing assets table regrowth after the 5747 repack
---

# public.assets 7-day reading (popcre/shared-db#5747 Step 7)

Captured read-only on production `qsllyeztdwjgirsysgai` at 9:51 PM EST 2026-11-12 (7 days after the
production repack completed 9:47 PM EST Nov 5). Same queries as `after.md` / `after-24h.md`.

| Measure | After repack (9:52 PM EST Nov 5) | 24 h reading (7:51 AM EST Nov 8) | 7-day reading (9:51 PM EST Nov 12) |
|---|---|---|---|
| Heap | 205,717,504 B (196 MB), 24,808 pages | 292,282,368 B (279 MB), 35,679 pages | 408,748,032 B (390 MB), 49,896 pages |
| Indexes | 351,264,768 B (335 MB) | 690,479,104 B (658 MB) | 864,919,552 B (825 MB) |
| TOAST | 1,040,384 B (1 MB) | 1,040,384 B (1 MB) | 1,114,112 B (1 MB) |
| Total | 558,153,728 B (532 MB) | 983,982,080 B (938 MB) | 1,274,920,960 B (1,216 MB) |
| Live row bytes (`sum(pg_column_size)`) | 193,038,136 B | 217,709,208 B | 222,630,712 B |
| Rows (`count(*)`) | 152,234 | 184,383 | 186,627 (+2,244) |
| Heap / live bytes | 1.07 | 1.34 | **1.84** (limit 2.0) |
| Index / constraint / user trigger count | 46 / 8 / 25 | 46 / 8 / 26 | 46 / 8 / 26 |
| ACL | `{postgres=arwdDxtm/postgres,anon=…,authenticated=…,service_role=…}` | identical | identical |
| Database size | 29,910,423,219 B | 32,806,188,723 B | 36,625,225,395 B |

Dead tuples 35,118; last autovacuum 6:55 AM EST Nov 12. Updates since stats reset 585,012 (HOT 342), so
about 429k updates in the 110 h since the 24 h reading (~3,900/h, in line with the post-Step 2 rate).

Largest indexes now (MB; 24 h reading in brackets): relative_path_trgm 129.0 [87.0],
ai_tag_all_candidates 114.6 [113.1], full_text_search 72.9 [56.3], facet_counts 71.5 [47.2],
relative_path_unique 66.8 [57.7], embed_stale_cover 49.9 [39.8], filename_trgm 37.9 [25.3], tags 26.9.

**Trend, not yet a breach.** Live data grew 2% since the 24 h reading, but the heap grew 40% (279 → 390 MB,
~24 MB/day) and indexes 25% (658 → 825 MB; 2.5x the post-repack size). At this rate heap/live passes 2.0
(~445 MB) in about two days. The weekly health check (`db-bloat-weekly.yml`, next run 6:00 AM EST Mon
Nov 16) opens a governed repack PR by itself when heap/live > 2.0, so no manual action is taken here. The
repack fixes the symptom; the steady ~3,900 updates/h that rewrite rows (and GIN/trigram index entries)
is the cause, and belongs with Step 3 (index audit, re-check on or after 2026-11-18) and any further
writer work.

Heap criterion at 7 days: met (390 MB ≤ 400 MB; heap ≤ 2x live bytes), with little margin.

## Search test set

Run https://github.com/u2giants/popdam3/actions/runs/43355019011 (label issue-5747-step7-7d, 9:51-9:57 PM EST Nov 12).
Previous: 42482253754 (24 h reading).

| Engine | Passed | p50 ms | p95 ms |
|---|---|---|---|
| PopDAM | **119/119** (was 118/119) | 1,024 | 2,172 |
| PopSG guides | 65/65 (was 48/65) | 1,104 | 3,343 |
| PopSG files | 65/65 (was 54/65) | 1,037 | 2,357 |

No PopDAM failures (`failed_case_ids` empty); com-075 ("star wars toy chest"), the expected miss, now passes.
PopDAM typical 1.0 s, p95 2.2 s (both < 3 s). PopSG gains are outside #5747's scope; their cause was not
investigated here and is not claimed.

7-day criteria met: heap ≤ 2x live bytes (1.84) and PopDAM pass count ≥ 118/119 (119/119). Heap ratio is
trending toward 2.0; the weekly health check is the designed response.
