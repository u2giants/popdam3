---
summary: "There is no orchestrator role; any session needing a structural change claims the exact objects on the existing issue and executes it."
kind: decision
status: current
read-when: starting structural database work or checking whether an orchestrator dispatch is required
---

# Structural work is claim-first; orchestrator role is retired (§0.0-D)

**Decided by:** Albert Hazan, 2026-10-02

## Decision

The orchestrator role is retired. Any session needing a database shape change claims the exact objects on the existing issue in its own worktree and performs the work directly.

Recorded in AGENTS.md §0.0-D (2026-10-02): there is no orchestrator; structural work is claim-first.

## Why

Eliminates multi-hop dispatch bottlenecks while preserving exact-object collision locks.

## Rejected

Opening HANDOVER-and-stop tickets for an orchestrator session or using retired dispatch markers.

## Source

Original record (left in place): [`docs/agents/orchestrator.md`](../agents/orchestrator.md) and [`docs/agents/current-workflow.md`](../agents/current-workflow.md)
