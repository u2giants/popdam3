---
issue: 3306
status: OPEN
owner: claude/a3b25ec9-4d49-4ba1-9623-9db18ddacfa4
---
# Handoff: gate cutback and stuck-work watchdog plans (unstarted)

Written 2026-09-28 4:00 PM EDT by Claude chat a3b25ec9-4d49-4ba1-9623-9db18ddacfa4 on edge-dev3.

Two plans were written and reviewed; no implementation has started.

- [docs/plans/plan_gate_cutback.md](../docs/plans/plan_gate_cutback.md) — start at its STATUS table, Step 1.
- [docs/plans/plan_stuck_work_watchdog.md](../docs/plans/plan_stuck_work_watchdog.md) — start after the gate plan's Steps 1–2.

Parent issue: popcre/ai-devops#1014 (children ordered GitHub-usage reduction first, per Albert).

Next exact action: gate-plan Step 1 — extend shared-db #3617 with per-gate Actions-token spend (after PR #3742 for #3743 lands). Neither plan changes database structure (non-orchestrator work).
