---
summary: PopDAM repo needs no AI reviewer approval before production actions (Albert, 2026-10-14).
kind: decision
status: current
read-when: about to wait on or request a reviewer approval before a PopDAM production step
---

# This repo no longer needs reviewers

**Decided by:** Albert, 2026-10-14: "the rules have changed, this repo no longer needs reviewers".

**Decision:** In `u2giants/popdam3`, do agent updates, live proofs and other production steps directly. Do not block on, or request, an AI reviewer APPROVE. Other safety rules (secrets, shared-db structure through `popcre/shared-db`) still apply.

**Why:** a reviewer gate stalled getting Indra OCR live; Albert wants work driven to production without waiting.

**Rejected / superseded:** the earlier "use Muse as the reviewer" instruction (2026-10-14, "Switch to muse as the reviewer") and the earlier "drop qwen completely" (2026-10-13) are superseded for this repo. See also [reviews are advisory only](2026-10-29-reviews-advisory-only.md).

## Source

- [plan_mockup_auto_match.md ("Reviews: not required in this repo (owner ruling 2026-10-15)")](../../plan_mockup_auto_match.md)
- private memory notes feedback_popdam_no_reviewers and feedback_muse_reviewer (outside this repo)
