---
issue: 706
status: OPEN
owner: claude/vector-strategy-review-2c428b (closed); next session takes over at plan Step 0
---
# Handoff: vector consolidation plan written, nothing executed

Written November 4, 2026, 5:12 PM EST on `hetz`. The plan is
[plan_vector_consolidation.md](../plan_vector_consolidation.md). Read its
STATUS table first; do not re-derive the review.

## 0. Business decisions only the owner can make
None pending. Albert already ruled (Nov 3, 2026) "Keep picture guesses" for
code-shaped searches not in the catalog; the plan honours it.

## 1. What this session did
- Reviewed every vector effort (DAM hybrid search, PopSG semantic search,
  image similarity) across `u2giants/popdam3` and `popcre/shared-db`, the
  plans, handoffs, issues and live production counts.
- Told Albert why they fail (pipeline never durable, picture model for text
  queries, 8 s ceiling firefighting, process overhead) and, on his yes, wrote
  the consolidation plan.
- Changed no code, no database, no config.

## 2. Live facts at write time (Nov 4, 2026, 4:58 PM EST)
DAM: 11,237/11,247 groups and 132,708/136,236 assets embedded, 2,414 pending,
1,114 errored, GPU poller heartbeat fresh. PopSG: 140,227/234,795 embedded,
94,568 pending, backfill restarted 4:46 PM EST by the `popsg-indexing`
session (shared-db PR #5588). Re-derive SQL is in plan §5.

## 3. In flight elsewhere — do not duplicate
- shared-db PR #5588 (PopSG claim autovacuum) — session `popsg-indexing`
  for popdam3 #706.
- shared-db PR #5585 (DAM claim waits for thumbnail) — session
  `excluded-search-docs` for popdam3 #663.

## 4. Next session
Start at plan Step 0, then Step 1 (watchdog). Context cut point after
Phase 1.
