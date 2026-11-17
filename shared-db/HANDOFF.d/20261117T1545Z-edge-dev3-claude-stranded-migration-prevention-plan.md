---
issue: 6574
status: OPEN
owner: next implementing session (claim-first on #6574)
summary: Open plan to stop migrations stranding (pre-merge high-risk preview, early park, unreadable post-apply check).
kind: handoff
read-when: picking up #6574, or before editing the claim-lane preview step, decide() attempt counting, or the catalog-verification CI checks.
---

# Stranded-migration prevention — plan open, unimplemented

- **Plan:** [plan_stranded_migration_prevention.md](../plan_stranded_migration_prevention.md) — read its STATUS table first.
- **Card:** issue #6574. Origin evidence: #6568 (PR #6433 strand), #6493.
- **Next exact action:** Step A of the plan in a fresh worktree from `origin/main`, class `code`.
- **Coordinate with** plan_promotion_stranding_watch.md (#6561): both edit `scripts/automatic_promotion_candidates.py`.

Posted by Claude chat 1ef24f88-4104-457f-bbad-cb690f419367 on edge-dev3


## Status update (2026-11-17, Claude session 06d8b8dc)

- Fix A merged `4a022243` (PR #6585); Fix B merged (PR #6586); Fix C merged `249527aa` (PR #6588).
- Doc line PR #6598 queued to merge. Live proof A run `44149841592` refused in validate; live proof C run `44144185872`.
- Still open: live proof B (no real park observed), and the signed comment on #6574 with these run ids (not yet posted).
- Watching run `44149841592` was denied by the permission prompt, so it was checked by one status read.
