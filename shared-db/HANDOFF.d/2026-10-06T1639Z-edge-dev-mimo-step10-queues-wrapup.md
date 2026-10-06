---
issue: 3781
status: OPEN
owner: mimo/3781-step10-wiring (MiMo chat, edge-dev)
---

# Step 10 — preview/production target queues (#3781)

## 1. Goal
Implement and prove Step 10 of parent #3306 (non-orchestrator work): preview and production have separate target queues with intact interlocks. This session held sole accountable ownership after explicit ACCEPTANCE on #3781.

## 2. What is already done (verified at wrap-up)
| Item | Evidence |
|---|---|
| PR #3822 MERGED | `7f42f6cb375e9b01ad6e6860b34ff077b4f29bb2` — `scripts/target-queue-identity.mjs`, 21 tests, design doc. Muse APPROVE. Guarded Merge 37059218752. |
| PR #3937 MERGED | `53fd0bea085b90f039ae4fa2a7005652867d5ce3` — closed two-branch concurrency in `shared-supabase-migrations.yml`, `dispatchConcurrencyGroup`, 23/23 tests, Python serialization-contract test updated. Gemini APPROVE (after Muse REVISE). Guarded Merge 37253685201. |
| Work contracts | gen 1 `refs/db-contracts/3781/1`; gen 4 `refs/db-contracts/3781/4` (lineage 2→3→4). |
| Orphan leases | Deleted two `refs/db-review-active-v2/stepfun-step-5-preview/*` refs that blocked all reviewer draws. |

Live concurrency now:
- PR / `merge_group` → per-ref group (unchanged).
- `workflow_dispatch` → `shared-supabase-migrations-production` if `inputs.target == 'production'`, else `shared-supabase-migrations-preview` (closed map; unknown collapses to preview). `cancel-in-progress: false` retained.

## 3. What is NOT done
1. **Lock-manager compatibility-matrix assertions** — wire `evaluatePairCompatibility` into exclusive-lock paths in `scripts/manage-migration-author-lanes.mjs` / `scripts/orchestrator-flow/runner-lanes.mjs`.
2. **Unified production freshness** — point `acquireExclusive('production')` at `evaluateProductionFreshness` (still independent "must be current main" checks).
3. **Live proof** on #3781: show one quota-limited preview preparation does not stop an approved production run; verify job start / lock acquire / release times; same-target races still refuse. Use sandbox/fake-lock first; real production only on an independently authorized genuine release.
4. Do **not** mark Step 10 complete until 1–3 pass. #3781 stays OPEN/Partial.

## 4. Exact next action
When `scripts/manage-migration-author-lanes.mjs` is free of open-PR owners, open a worktree from `origin/main`, publish a work contract generation under issue 3781, implement the matrix as lock-manager assertions + freshness unification, run `node --test scripts/target-queue-identity.test.mjs scripts/manage-migration-author-lanes.test.mjs`, open PR, assign reviewer (`SHARED_DB_AUTHOR_ENGINE` must be one of claude|codex|glm|zcode), governed review, Guarded Merge. Then live proof comment on #3781.

## 5. What must not be touched
- Do not weaken object claims, exclusive production locks, exact-head approval, freeze interlock, or required checks.
- Do not take over an owned PR. At wrap-up these still owned `manage-migration-author-lanes.mjs`: #3930, #3727, #3666, #3636, #3627, #3626, #3622, #3593.
- Another session's worktree `C:/repos/shared-db-worktrees/401-step10-acceptance-report` (branch `codex/401-step10-acceptance-report`) — do not take it over.
- Shared checkout `C:\repos\shared-db` untracked files (tmp-*.mjs, other HANDOFF.d/) belong to other sessions — leave them.

## 6. Tried and failed (do not repeat)
- Reviewer assign without a checked-in work-contract pair → Agent work contract CI fail.
- Relative `--worktree` for `run-governed-review` → `local source identity is unavailable`. Use absolute path (`C:/repos/...`).
- Interpolating `inputs.target` into `concurrency.group` → Muse REVISE: API/CLI bypasses `type: choice`. Closed two-branch map is the accepted form.
- DeepSeek `insufficient_quota`, Grok `turn_limit_cancelled` — terminal non-verdicts; use `--replace-failed-reviewer --confirm-no-verdict --confirm-no-artifact`.
- `SHARED_DB_AUTHOR_ENGINE=mimo` is refused.
- Unknown reviewer names in lease refs (stepfun) make the entire lease snapshot unreadable; delete the orphan ref.

## 7. Branches / worktrees this session
- `mimo/3781-step10-target-queues` + `.ai/worktrees/step10-target-queues-mimo` — PR #3822 merged; safe to clean via `scripts/reap-merged-worktrees.mjs` / `cleanup-worktree`.
- `mimo/3781-step10-wiring` + `.ai/worktrees/step10-wiring-mimo` — PR #3937 merged; clean, safe to clean.
- No open PR of this session. No database claim.

## 8. Moving facts (checked at wrap-up)
- `origin/main` = `af106caa2de7db697ecfaf5845d36a8328230446` at 2026-10-06T20:23:20Z.
- PR #3822 merge `7f42f6cb…`, PR #3937 merge `53fd0bea…` (squash SHAs).
- #3781 OPEN. Parent #3306 OPEN. #3779 (Step 9) parked.

## 9. Secrets
None appeared in this session (GitHub tokens stayed tool-masked). Swept: no credential written to files or chat.
