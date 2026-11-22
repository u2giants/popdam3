---
summary: AI reviews are advice only and never gate a merge or production step (owner ruling 2026-10-29).
kind: decision
status: current
read-when: tempted to wait on, request, or gate on a review before merging
---

# Reviews are advisory only

**Decided by:** owner ruling, 2026-10-29 (recorded in the plan's rejected-approaches table as "Reviews are advisory only (owner ruling Oct 29, 2026)").

**Decision:** CI runs one advisory AI review per code or plan PR and it never blocks a merge. Findings become `review-finding` issues handled by an automatic fixer. Never wait on a reviewer before merging.

**Why:** reviewer gates repeatedly stalled work (quota, credit, no verdict).

**Rejected:** "Waiting on a reviewer before merging anything."

See also [PopDAM needs no reviewers](2026-10-14-popdam-needs-no-reviewers.md).

## Source

- [plan_vector_consolidation.md section 7, rejected approaches](../../plan_vector_consolidation.md)
