---
issue: 6493
status: OPEN
owner: claude/6493-step5-handoff (Claude chat 75af8cdf-3bd5-4be0-8fac-869b4b56203d, edge-dev3)
summary: Steps 0–4b of #6493 are done; Step 5 (bounded-parallel production apply, off by default) is the only plan step left and is gated on evidence the queue still backs up.
kind: handoff
read-when: starting #6493 Step 5, or deciding whether Step 5 is needed.
---

# #6493 Step 5 — bounded-parallel apply (deferred, not started)

Written 2026-11-18 5:30 PM EST. Predecessor (finished, deleted in PR #6746): the Step 4b proof handoff.
Other open #6493 handoff, not covered here: [coordinator closeout](https://github.com/popcre/shared-db/blob/main/HANDOFF.d/20261118T0322Z-edge-dev3-claude-6493-coordinator-closeout.md) (live-proof of #6599/#6614).

## 0. BUSINESS DECISIONS ONLY THE OWNER CAN MAKE
None.

## 1. What this application is
The shared-db migration promotion pipeline: [automatic-production-trigger.yml](https://github.com/popcre/shared-db/blob/main/.github/workflows/automatic-production-trigger.yml) → selector [automatic_promotion_candidates.py](https://github.com/popcre/shared-db/blob/main/scripts/automatic_promotion_candidates.py) → preview rehearsal → production apply in [shared-supabase-migrations.yml](https://github.com/popcre/shared-db/blob/main/.github/workflows/shared-supabase-migrations.yml). Applies are serial today.

## 2. Goal
Plan Step 5 (issue #6493 body, "Phase 2 (deferred): Bounded-parallel apply"): allow up to 3 production applies at once for migrations on disjoint objects, behind a flag that is OFF by default, without weakening any safety guarantee.

## 3. Current state
- STATUS rows 0–4b are ✅. Row 4b closed 2026-11-18: hold-clear wake (runs 44374307315, 44375102105) and recheck hop (44361110759 → 44363577253); [proof comment](https://github.com/popcre/shared-db/issues/6493#issuecomment-6993188355).
- Row 5 is ⬜ deferred. No Step 5 code, branch, or claim exists.
- Plan gate: implement only if Steps 1–4 still leave the queue backing up under normal load (2–4 migration PRs/hour, bursts of 4). Latest measures: SLO_A ~2 min, SLO_B ~7 min on bursts (row 4 evidence) — inside SLO B (p95 < 15 min), so the gate currently says **do not build**.

## 4. What did NOT work
Nothing tried for Step 5 yet.

## 5. Key findings
- Collision checks (`check-dispatch-collision.mjs`) see direct table access only; FK dependencies, schema locks and extension locks are not covered, so disjoint tables can still deadlock. This is the main risk.
- The selector already has per-PR dispatch leases (`refs/dispatch-claims/pr-N`) and a fail-closed ledger (Step 2); reuse them.

## 6. Exact next steps
1. Decide the gate with evidence: from the last 20 `SLO_B` notices in trigger/apply runs, compute p95. **Done when** posted on #6493. If p95 < 15 min and no queue backlog, set row 5 to "⬜ not needed (evidence link)" and stop.
2. Only if the gate fails: claim the exact workflow/script objects on #6493, then build per the plan: env/config flag OFF by default; object sets including FK/schema/extension locks, fail closed → serial; `lock_timeout` + `statement_timeout` on every apply, retry once on deadlock then serial; a real semaphore (max 3).
3. Prove: flag off → serial unchanged; flag on + disjoint → parallel; flag on + overlap → waits; 3 disjoint + 1 overlapping under load, no deadlocks in 100 runs (preview only).

## 7. Constraints
Production is read-only for the AI; migrations reach production only through the automatic promotion workflow. Do not weaken the main-moved refusal for gate code or workflows. Wait on PRs with `ai-pr-wait <pr> --repo popcre/shared-db --timeout-minutes 9 --fit-tool-call`.

## 8. Access
`gh` as `u2giants`. No secrets needed.

## 9. Risks
Turning the flag on without complete lock metadata can deadlock production applies; keep it off until step 3 proof passes.

## Self-audit
1–3 yes (background, state, gated steps). 4 yes: nothing needs Albert.
