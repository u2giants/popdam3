---
summary: "Albert is a business owner, not a technical reviewer; never ask him for technical approval or risk-class sign-off."
kind: decision
status: current
read-when: deciding whether to ask Albert for approval, merge sign-off, or production risk acceptance
---

# Never ask Albert for technical approval or risk sign-off (§6.18, §6.23)

**Decided by:** Albert Hazan, 2026-08-18, 2026-09-28, and 2026-09-30

## Decision

Never ask Albert to approve technical changes, merges, or production risk classes. Production risk classes are accepted by the automatic promotion workflow; ask Albert only genuine business-meaning questions.

Recorded in §6.18 (2026-08-18), 2026-09-28, and §6.23 (2026-09-30): Albert does not sign off on technical risk; never gate on a judgement he cannot make.

## Why

Technical sign-off gates on a non-programmer owner stall delivery without adding safety.

## Rejected

Blocking PRs, merges, or production promotions on human technical approval.

## Source

Original record (left in place): [`docs/owner-rulings-part-3.md` §6.18](../owner-rulings-part-3.md#618-owner-ruling--albert-does-not-sign-off-on-technical-risk-never-gate-on-a-judgement-he-cannot-make-albert-hazan-2026-08-18) and [§6.23](../owner-rulings-part-3.md#623-owner-ruling--albert-is-not-a-technical-reviewer-production-risk-classes-are-accepted-by-the-ai-reviewer-albert-hazan-2026-09-30)
