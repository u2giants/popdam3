---
summary: "public.assets weekly health reading (#5747): heap 390 MB vs 214 MB live (1.82, limit 2.0) - below threshold, no repack; heap flat since Nov 12."
kind: proof
status: done
read-when: reviewing assets table regrowth after the 5747 repack
---

# public.assets weekly health reading (popcre/shared-db#5747)

Captured read-only on production at 6:05 AM EST 2026-11-16 (Supabase Management API
`database/query`, `read_only: true`; database clock `2026-11-16 06:03:55.100016-05`). Same
measures as `after-7d.md`.

| Measure | After repack (9:52 PM EST Nov 5) | 24 h (7:51 AM EST Nov 8) | 7-day (9:51 PM EST Nov 12) | Weekly (6:05 AM EST Nov 16) |
|---|---|---|---|---|
| Heap | 205,717,504 B (196 MB), 24,808 pages | 292,282,368 B (279 MB), 35,679 pages | 408,748,032 B (390 MB), 49,896 pages | 408,748,032 B (390 MB), 49,896 pages |
| Indexes | 351,264,768 B (335 MB) | 690,479,104 B (658 MB) | 864,919,552 B (825 MB) | 876,765,184 B (836 MB) |
| TOAST | 1,040,384 B (1 MB) | 1,040,384 B (1 MB) | 1,114,112 B (1 MB) | 1,040,384 B (1 MB) |
| Total | 558,153,728 B (532 MB) | 983,982,080 B (938 MB) | 1,274,920,960 B (1,216 MB) | 1,286,766,592 B (1,227 MB) |
| Live row bytes (`sum(pg_column_size)`) | 193,038,136 B | 217,709,208 B | 222,630,712 B | 223,972,040 B |
| Rows (`count(*)`) | 152,234 | 184,383 | 186,627 | 187,380 (+753) |
| Heap / live bytes | 1.07 | 1.34 | 1.84 | **1.82** (limit 2.0) |
| Index / constraint / user trigger count | 46 / 8 / 25 | 46 / 8 / 26 | 46 / 8 / 26 | 46 / 8 / 26 |
| ACL | `{postgres=arwdDxtm/postgres,anon=…,authenticated=…,service_role=…}` | identical | identical | identical |
| Database size | 29,910,423,219 B | 32,806,188,723 B | 36,625,225,395 B | 36,683,749,043 B |

Dead tuples 35,763; last autovacuum 4:21 AM EST Nov 13. Updates since stats reset 661,155
(HOT 608), so about 76k updates in the 78 h since the 9:51 PM Nov 12 reading (~975/h — well
below the ~3,900/h seen the week before).

**The ~24 MB/day heap growth stopped.** Heap is byte-identical to the Nov 12 reading
(408,748,032 B) three days later, while live bytes grew 1.3 MB and rows +753; the heap/live
ratio improved 1.84 → 1.82. Indexes grew only 11 MB (825 → 836 MB) versus +167 MB in the
previous 24 h. The ratio stays under the 2.0 threshold, so **no repack is proposed** this
week and the governed repack route is not triggered. The 6:00 AM EST Mon Nov 16 slot of the
weekly health check is this reading.

Step 3 index re-check remains due on or after 2026-11-18 EST (index growth 335 → 836 MB since
the repack; 28 zero-scan candidates recorded in `../20261105T2345Z/index-audit.md`).
