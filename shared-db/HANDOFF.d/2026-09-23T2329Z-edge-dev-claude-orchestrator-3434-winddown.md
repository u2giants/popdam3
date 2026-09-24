---
issue: 2995
status: OPEN
owner: next shared-db orchestrator (successor of marker #3434)
---

# Orchestrator marker #3434 wind-down (edge-dev, Claude) — 2026-09-23 7:29 PM EDT

## 1. Goal
Hand the shared-db orchestrator role to a fresh session. Albert ordered a full wind-down ("do not start anything new. just wind down everything you're doing"). Marker #3434 is CLOSED by this handoff; the successor opens its own marker with its own route_id and `authorization:` (AGENTS.md §11c/§11d).

## 2. Current state (verified 2026-09-23 ~7:25 PM EDT)
- All nine helper agents were stopped. No lane, preview, merge, or production lease was acquired or released by the wind-down. Author worktrees, reviewer locks and private evidence were preserved untouched.
- Albert's production approvals were posted under his account (u2giants) in the exact `production-owner-decision` fence form:
  - #2995 — comment 5804624371: main_sha `c0bbed551d1b747bcf12f0b6ba4c8027a1781bf4`, allowlist `["20260920202755"]`, source_pr 3382, source_merge_sha `c384c26cc7865419c37f6b1520028e1053f65c23`.
  - #3282 — comment 5804624732: same main_sha, allowlist `["20260923173715"]`, source_pr 3301, source_merge_sha `064736836b55cd431a6adda7ed2972118ba985e0`.
  - Both: accepted_risks material_access_change, permanent_data_rewrite_or_loss, expected_downtime; target_workflow `.github/workflows/shared-supabase-migrations.yml`.
  - Older #2995 approval comment 5800482327 is VOID (stale main_sha). Never edit these comments; the gate rejects edited or signed bodies.

## 3. Next steps (in order)
1. Production dispatch for #2995 then #3282 (serial lane). The gate requires main_sha == current main at dispatch. **This handoff PR itself moves main**, so the posted approvals are already stale: the successor must ask Albert to re-approve (Albert said he is non-technical; the approval text is posted under his account only on his explicit chat instruction) at the new main SHA, then dispatch immediately under a merge freeze (§12.1 item 14). Gate code: `scripts/production_owner_decision_evidence.py`.
2. Resume paused structural streams, each from its own worktree/claim (re-resolve state first, nothing is running):
   - #3418 (PR #3436): Gemini APPROVED; guarded merge not yet dispatched — re-check exact-head approval still matches head, then dispatch guarded merge.
   - #2357 (PR #2835): checks were queued, reviewers not yet drawn — `--assign-reviewer`.
   - #3309: reviewer precheck was slow; re-run and diagnose rather than wait.
   - #3391, #3304, #3441/#2478: paused mid-work; read each issue's latest comment and its claim.
3. Reviewer repairs (repo-maintenance, NOT orchestrator work — hand to a repo session): Muse PR being rescoped to config-driven model (Albert: use Muse 1.3 Contributor, else 1.3; never 1.2); Qwen stale tests expecting the 30-minute limit; Grok wrapper/allocator repair helper finished its last turn referencing PR #3441 — verify that PR's state before assuming anything.

## 4. Verification
- `node scripts/check-orchestrator-marker.mjs --resolve` must show the successor's own route_id.
- Production: shared-supabase-migrations run green plus post-apply ledger/catalog check for 20260920202755 and 20260923173715.

## 5. Failed / do-not-repeat
- An approval with any main_sha other than current main is refused; re-post, never edit.
- Do not ask Albert technical questions; route them to Muse or Grok reviewers (Albert's instruction).

## 6. Decisions & authority
Production requires Albert's fresh owner-decision comment per dispatch. Nothing in this handoff authorizes production.

## 7. Open questions
None beyond re-approval timing.

## 8. Files touched
Only this handoff file.

## 9. Self-audit
A cold session can: find every paused item by issue/PR number, know the exact approval format and why it is stale, and know what not to touch. Pass.

Posted by Claude chat aa4791e3-535d-47ad-ac32-a4d0b9323273 on edge-dev
