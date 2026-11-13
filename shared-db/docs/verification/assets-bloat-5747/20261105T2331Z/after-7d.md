---
summary: "public.assets 7-day recheck (#5747 Step 7): heap 390 MB vs 223 MB live (1.83, limit 2.0); PopDAM 119/119, p50 1.0 s - search-speed half confirmed."
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

## 7-day recheck — one-shot automation reading (4:58 AM EST Nov 13, 2026)

The one-shot scheduled workflow (`.github/workflows/assets-bloat-5747-step7-7d.yml`, run
[43405540788](https://github.com/popcre/shared-db/actions/runs/43405540788)) posted a second 7-day
reading on #5747 at 4:58 AM EST Nov 13 — GitHub's backlogged scheduler flushed the `47 2 13 11 *`
cron (due 9:47 PM EST Nov 12) seven hours late. Measures table exactly as posted in that comment:

| Measure | After repack (Nov 5) | 24 h (Nov 8) | 7-day (this reading) |
|---|---|---|---|
| Heap | 196 MB | 279 MB | 390 MB |
| Indexes | 335 MB | 658 MB | 831 MB |
| TOAST | 1 MB | 1 MB | 1 MB |
| Total | 532 MB | 938 MB | 1,222 MB |
| Live row bytes | 193,038,136 B | 217,709,208 B | 222,769,472 B |
| Rows (`count(*)`) | 152,234 | 184,383 | 186,657 |
| Dead tuples | 1,317 | 1,196 | 2,980 |
| Heap / live bytes | 1.07 | 1.34 | **1.83** (limit 2.0) |

Heap criterion: MET (heap ≤ 2× live bytes). Database read at `2026-11-13 04:58:54.68999-05`
(server clock). Rows +30 and indexes +6 MB versus the 9:51 PM reading above — ordinary ingest,
no structural drift (index / constraint / trigger counts and ACL unchanged).

### Search-speed half — confirmed

That comment left the paired Search test set as an expectation only ("pass counts are expected to
hold vs the 24 h reading, PopDAM 118/119"). The paired popdam3 one-shot (`search-eval.yml`
`schedule`, same `47 2 13 11 *` cron, label `issue-5747-after-7d`) produced **no run**: the
schedule entry was removed (u2giants/popdam3#994, merged 2026-11-13 03:26:42Z) before GitHub's
scheduler flushed it, and that PR names the manual stand-in taken at the due slot — run
https://github.com/u2giants/popdam3/actions/runs/43355019011 (label `issue-5747-step7-7d`,
9:51-9:57 PM EST Nov 12), the same run recorded in the Search test set section above.

| Criterion (plan Steps 5/7) | Target | Observed (43355019011) | Verdict |
|---|---|---|---|
| Pass counts must not drop | ≥ 118/119 | 119/119 (com-075 now passes) | MET |
| Broad search under 3 s | p50 < 3 s | p50 1,024 ms; p95 2,172 ms | MET |
| Exact totals unchanged | judged total cases pass | 119/119, `failed_case_ids` empty | MET |

Search-speed half of the 7-day recheck: **MET** — the automation comment's expected pass counts
hold (119/119 vs 118/119) and broad search is under the 3 s target. The nearest later scored runs
in the same window hold the same pass count (43365823149, 11:29 PM EST Nov 12: 119/119, p50 1.0 s;
43386845973, 2:35 AM EST Nov 13: 119/119, p50 1.6 s).
