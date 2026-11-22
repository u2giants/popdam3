---
summary: "AI review is advisory only and never blocks a merge or production promotion; findings become issues for the auto-fixer."
kind: decision
status: current
read-when: merging a PR, running CI, or promoting migrations to production
---

# AI review is advisory and never a merge gate

**Decided by:** Albert Hazan, 2026-10-29

## Decision

No workflow, ruleset, or helper requires an AI review verdict before merge or production promotion. Advisory reviews may still run, and findings become `review-finding` issues. Lease, migration ordering, collision checks, tests, preview rehearsal, and production guards still bind.

Owner ruling (Albert Hazan, 2026-10-29): review is advisory and never a merge gate, shared-db included.

## Why

Reviewer tooling failures repeatedly stalled merges and promotions; making review advisory keeps delivery moving while preserving automated findings.

## Rejected

Gating PR merges or production promotion on an exact-head AI `APPROVE` verdict (supersedes 2026-10-14 review-slot rules).

## Source

Original record (left in place): [`docs/agents/merge-protocol.md`](../agents/merge-protocol.md#review-is-advisory-owner-2026-10-29)
