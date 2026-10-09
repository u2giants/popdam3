---
issue: 770
status: OPEN
owner: mimo / edge-dev
---

# Windows install-gates plan — handoff link

This handoff registers the implementation plan for unblocking the ai-devops toolkit installation on edge-dev (Windows).

**Plan file:** [`plan_windows-install-gates.md`](../plan_windows-install-gates.md)

**Context:** PR #1533 (fixture repair) is merged at `b904689` on `popcre/ai-devops` main. The installation of that release on edge-dev fails at multiple Windows-specific gates in `update.sh` and `ai-task-gates`. The plan documents each failure, root cause, rejected approaches, and a three-phase fix.

**Where a fresh session starts:** Phase 1 of the plan (path normalization, lock fallback, PROGRAMFILES detection). Re-read the plan's STATUS table first.

**Related:** shared-db #770 (production cutover, blocked on this installation). Predecessor handoff: `HANDOFF.d/2026-10-09T0400Z-edge-dev3-codex-770-recovery-continuation.md`.
