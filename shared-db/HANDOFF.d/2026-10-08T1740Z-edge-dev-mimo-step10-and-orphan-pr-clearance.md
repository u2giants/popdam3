---
issue: 3781
status: OPEN
owner: mimo/3781-step10-locks (MiMo chat ses_ffe5eecd82dedffe7RhHlWNjmi, edge-dev)
---

# Step 10 policy slice + orphaned protected-file PR clearance (#3781 / #3622 / #3666 / #3627 / #3636 / #3626)

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

None. All remaining work is technical: finish reviews/merges when reviewer capacity allows.

## 1. What this application is

`popcre/shared-db` — shared Supabase coordination and migration-author lane tooling. This session did repo-maintenance work (scripts, docs, workflow tooling). **No database structure or data change.** Preview/production: nothing applied.

## 2. What we set out to do this session, and why

Two jobs, both authorized:

1. **Resume Step 10 on #3781** (from handoff `2026-10-06T1639Z-edge-dev-mimo-step10-queues-wrapup.md`): lock-manager compatibility-matrix assertions, unify production freshness with `acquireExclusive('production')`, then live proof. Contested file `scripts/manage-migration-author-lanes.mjs` was off-limits until PRs #3622/#3666/#3627/#3636/#3626 release it.
2. **Adopt and clear five orphaned PRs** (#3622/#3666/#3627/#3636/#3626) after Albert said Codex has no open sessions on edge-dev3.

## 3. Current state — what is true right now

Checked **2026-10-08 13:39 EDT** (`64f1edb5c737c91e7dc75f9195f235b39358b0ef` = origin/main). Max migration version: `20261006170117`.

### Landed

| Item | Evidence |
|---|---|
| **PR #4018 MERGED** (`2ccebea0`, 2026-10-07) | Step 10 policy slice: `scripts/lib/lanes/exclusive-policy.mjs` (fail-closed matrix + freshness), unified `evaluateProductionFreshness` → `isProductionInertPath`, fake-lock tests, disposition catalogue. Muse APPROVE + DeepSeek APPROVE. Proof comment on #3781. |
| **PR #3622 MERGED** (`349018dc`, 2026-10-08) | Historical preview terminalization accepts normal review artifact. Landed in `scripts/lib/lanes/preview-admission.mjs`. Muse APPROVE at `6387f449`. 777 tests. |

### Open / prepped (protected-file queue — ONE ready at a time for manage-migration-author-lanes.mjs)

| PR | Head | Issue | State |
|---|---|---|---|
| **#3666** | `1bca5004` | #3617 | Ready, CI green. **BLOCKED on GLM quota until 2026-10-09 04:35:21 EDT.** Slot allowlist locked to `glm-5.3` only. |
| **#3636** | `89525ac7` | #3634 | Ready for review (impl `3df6a99b`, evidence gen 2). No reviewer drawn. |
| **#3626** | `f09cd471` | #3624 | Ready for review (impl `315f3fc5`, evidence gen 5). No reviewer drawn. |
| **#3627** | `dd64ac91` | #3563 | Ready for review (impl `553248fa`, evidence gen 3). No reviewer drawn. |

### #3781 Step 10 — OPEN / Partial

- Compatibility-matrix assertions: **done** (policy-level).
- Production freshness unified: **done** (`evaluateProductionFreshness` uses `isProductionInertPath`).
- `acquireExclusive('production')` call-site wiring: **NOT done** — contested file still owned by the four open PRs above.
- Live queue proof: **policy-level only** (fake-lock). Real live proof not done.

### Preview / production

Nothing applied to preview or production this session. Pure repo-maintenance.

## 4. Everything we tried that did NOT work

**MANDATORY — do not re-walk these.**

1. **`SHARED_DB_AUTHOR_ENGINE=mimo` is refused.** Use `claude` (keeps GLM eligible) or `zcode` (excludes GLM via `ENGINE_REVIEWER_EXCLUSION`).
2. **Single-name `--reviewer-allowlist` locks the slot forever.** `#3666` got `allowlist=['glm-5.3']` and every replacement/draw inherits it. Omit the flag entirely.
3. **StepFun fails on Windows** (`ChildProcess.spawn` / shell dead). Exclude with `--exclude-reviewer --reason terminal-unavailable`.
4. **Qwen often returns silence** (exit 4, 0 output). Replace: `--replace-failed-reviewer --failure-code wrapper_terminal_failure --confirm-no-verdict --confirm-no-artifact`.
5. **DeepSeek can return `review-blocked`** without a recordable VERDICT. Same replace path.
6. **Evidence pair MUST be two commits**: implementation first, then ONLY the two `.agent/work/...` files. `completion.head_sha` = implementation commit (not PR tip). A single squash fails `verifyGitEvidence`.
7. **Contract refs are immutable.** New generation + `evidence_parent` to widen `allowed_paths`.
8. **Only ONE evidence pair in a PR's changed-file set.** Keep the latest generation; historical gens already on main must not be deleted in the same PR.
9. **PowerShell corrupts backticks in `gh issue edit --body`.** Use `--body-file`.
10. **Issue bodies need ` ```db-work-scope ` fence with `status: ready`** or reviewer assignment refuses.
11. **`ai-pr-wait` must run FROM the worktree** with `--repo popcre/shared-db` via git-bash. Shared checkout's dirty tree escalates task class and refuses.
12. **Author-acquisition mutex** is often occupied by another live session. Wait and retry; `--reap-abandoned-review-leases --apply-recovery` needs the mutex.
13. **`ai-review-preflight clear <provider>`** can clear an `out-of-credit` quarantine before the epoch expires. GLM then drew, but the provider still returned HTTP 429 until the real weekly reset.
14. **`manage-migration-author-lanes-surface.test.mjs`** imports every `*.mjs` under `scripts/lib/lanes/` — a new `*.test.mjs` there gets `cancelledByParent` in CI. Filter test files out of that scan (landed in #4018).
15. **Throughput truth audit** requires a disposition catalogue for any new source with tracked-pattern call sites (`docs/verification/throughput-dispositions/<path~with~tildes>.json`).
16. **`#2998 CLI` readiness tests** die at the new preflight gate unless wrapped with `withRegisteredPreflight` (pass `--delivery-preflight-record --evidence-bundle --changed-files-file`).
17. **Guarded Merge can fail** on `core.properties_and_characters` reference-count guard when main-side sidecars appear via a stale merge-base. Merge latest `origin/main` and re-dispatch (#2758 carries APPROVE if the PR's own diff is unchanged ignoring `.agent/`).
18. **`refresh-code-pr-branch.mjs`** refuses if it cannot re-run the completion's check commands. Refresh `base_sha` by hand and re-run tests.

## 5. Root causes and key findings

- **Protected-file serialization is real**: only ONE ready PR at a time for `scripts/manage-migration-author-lanes.mjs`, else reviewer draws refuse. Clear serially.
- **Post-#3726 split**: exclusive lock policy belongs in `scripts/lib/lanes/exclusive-policy.mjs` / `exclusive-locks.mjs` / `queue-routing.mjs` / `preview-admission.mjs` / `retirement.mjs` — not the entrypoint (entrypoint re-exports).
- **`evaluatePairCompatibility` ALLOWs merge+production without freeze** when locks are disjoint; live lock manager is stricter. Consumers must layer `CROSS_REF_INTERLOCKS` on top (done in `assertExclusiveAcquisitionPolicy`).
- **`EXCLUSIVE_REFS`**: preview / preview-recovery / preview-rehearsal share one ref. Pair-kind mapping must collapse them or same-lane races are invisible to the matrix.
- **Production-inert path policy** (`isProductionInertPath`) is the single freshness rule for tip-check and manifest-reuse. Deliberate widening from docs-only; substantive scripts/SQL/workflows always refuse.
- **GLM weekly quota** resets `2026-10-09 04:35:21` (EDT per prior note; provider message has no TZ). Until then `#3666` cannot be reviewed.

## 6. Exact next steps

**Ordered. Do not parallelize protected-file PRs.**

1. **Wait for GLM quota (2026-10-09 04:35 EDT).** Then clear **#3666**:
   - `ai-review-preflight clear glm` if quarantined
   - Worktree: `C:/repos/shared-db/.ai/worktrees/3666-clear-mimo` (branch `mimo/3666-clear-request-cost`, head `1bca5004`)
   - `SHARED_DB_AUTHOR_ENGINE=claude node scripts/manage-migration-author-lanes.mjs --assign-reviewer --issue 3617 --pr 3666 --head-sha 1bca5004a96940132883d77e0f51de0f3f6c94d4`
   - Governed review with `ai-glm` (`AI_GLM_CALLER=claude`), prompt-file brief ending `VERDICT: APPROVE <head>`
   - `gh workflow run guarded-migration-merge.yml -f pull_request=3666 -f head_sha=1bca5004a96940132883d77e0f51de0f3f6c94d4`
   - Wait: `ai-pr-wait 3666 --repo popcre/shared-db` from the worktree
   - Comment outcome on #3617
2. **Clear #3636** (head `89525ac7`, issue #3634, worktree `3636-prep-mimo`). Assign reviewer **without** `--reviewer-allowlist`. Review, guarded merge, comment on #3634.
3. **Clear #3626** (head `f09cd471`, issue #3624, worktree `3626-prep-mimo`). Same path.
4. **Clear #3627** (head `dd64ac91`, issue #3563, worktree `3627-prep-mimo`). Same path.
5. **#3781 follow-up** (after the four land): one-line wire-up of `assertExclusiveAcquisitionPolicy` into `acquireExclusive('production')` in the now-free `manage-migration-author-lanes.mjs`, then live queue proof. Keep #3781 OPEN until that lands.

## 7. Constraints and gotchas in force

- Never weaken object claims, exclusive production locks, exact-head approval, freeze interlock, or required checks.
- Never use `--admin` or skip checks. Never force-push over another session's work.
- Omit `--reviewer-allowlist` unless the full eligible rotation is intended.
- `SHARED_DB_AUTHOR_ENGINE=claude` (not mimo/zcode) to keep GLM in rotation.
- Evidence: two commits, `head_sha` = impl commit, one pair per PR, new generation to change scope.
- Signature on GitHub: `Posted by MiMo chat ses_ffe5eecd82dedffe7RhHlWNjmi on edge-dev`.
- Do not take worktree `C:/repos/shared-db-worktrees/401-step10-acceptance-report` (Codex, separate).
- Shared checkout `C:/repos/shared-db` untracked files belong to other sessions — leave them.

## 8. Access and environment

- Machine: **edge-dev** (Windows). Session: MiMo chat `ses_ffe5eecd82dedffe7RhHlWNjmi`.
- Repo: `popcre/shared-db`. Tooling: `ai-task-gates`, `ai-pr-wait` (`C:/repos/ai-devops/bin/`), wrappers `ai-glm` / `ai-muse` / `ai-deepseek-agent` / `ai-grok-review` / `ai-gemini` / `ai-qwen` / `ai-stepfun`.
- GitHub identity: `u2giants`. Reviewer preflight: `ai-review-preflight`.
- No new credentials appeared this session (tokens stayed tool-masked).

## 9. Open questions and risks

- **GLM weekly quota** is the hard gate on #3666. If the reset slips or GLM is quarantined again, the slot cannot be reviewed (allowlist locked).
- **#3781 remains Partial** until acquireExclusive wiring + live proof. Do not mark Step 10 complete from this policy slice alone.
- **Protected-file queue** can stall if another session readies a competing `manage-migration-author-lanes.mjs` PR. Only one ready at a time.

---

### Sub-agent blocks (this session dispatched several)

### Agent: general-1 — Step 10 lock policy implementation
- **Asked to do:** exclusive-policy matrix + freshness unification + fake-lock tests.
- **Actually did:** landed in PR #4018 (merged `2ccebea0`). `exclusive-policy.mjs`, `exclusive-locks.mjs` re-exports, `target-queue-identity.mjs` freshness, tests (99+26+6+47).
- **Found:** surface-test `*.test.mjs` import cancelled children in CI; throughput disposition catalogue required for new sources.
- **PR / branch:** #4018 / `mimo/3781-step10-locks` — MERGED.
- **Worktree:** `step10-locks-mimo` — finished (safe to clean after #3781 follow-up if no further use).
- **Deliberately did NOT do:** `acquireExclusive` call-site wire-up (contested file).

### Agent: general-2 — DeepSeek REVISE fixes on #4018
- **Asked to do:** fail-closed gaps, fixture, proof honesty, handoff restore.
- **Actually did:** pushed fixes; gen 7 evidence; PR body `Closes #4022` then reverted to house-pattern `Closes #3781` + reopen note.
- **Found:** published contracts immutable; one pair per PR; surface-test filter.
- **PR / branch:** #4018 — MERGED.
- **Worktree:** same as above.
- **Deliberately did NOT do:** nothing outstanding.

### Agent: general-3 — Clear PR #3622
- **Asked to do:** rebase, fix CI, review, merge.
- **Actually did:** reapplied into `preview-admission.mjs`; 777 tests; evidence gen 2. Blocker: all reviewers exhausted.
- **Found:** 47 stale reviewer leases reclaimable; mutex often busy; evidence squash broke binding.
- **PR / branch:** #3622 / `codex/3621-terminalizer` — MERGED `349018dc`.
- **Worktree:** `3622-clear-mimo` — finished (safe to clean; branch merged).
- **Deliberately did NOT do:** nothing outstanding.

### Agent: general-4 — Clear PR #3666
- **Asked to do:** rebase, fix CI, review, merge.
- **Actually did:** feature in `scripts/lib/github-transport.mjs`; 781+ tests; evidence gen 4; head `1bca5004`. CI green. Review blocked.
- **Found:** single-name allowlist locks slot forever; GLM quota until 2026-10-09 04:35.
- **PR / branch:** #3666 / `fix/3617-request-cost` — OPEN, ready, blocked on GLM.
- **Worktree:** `3666-clear-mimo` — live (resumable).
- **Deliberately did NOT do:** did not force a non-GLM reviewer (allowlist forbids it).

### Agent: general-5 — Prep PR #3636
- **Asked to do:** code prep only, no reviewer.
- **Actually did:** reapplied into `scripts/lib/lanes/retirement.mjs`; 782 tests; evidence gen 2; head `89525ac7`.
- **Found:** live-proof matching lives in `retirement.mjs`; identity-conformance allowlist counts.
- **PR / branch:** #3636 / `codex/3634-live-proof-provenance` — OPEN, ready.
- **Worktree:** `3636-prep-mimo` — live (resumable).
- **Deliberately did NOT do:** reviewer draw (serialized behind #3666).

### Agent: general-6 / general-7 — Prep PR #3626
- **Asked to do:** code prep only.
- **Actually did:** (g6 cancelled mid-edit) (g7 finished) preflight + evidence-bundle feature reapplied; 777+44 tests; evidence gen 5; head `f09cd471`.
- **Found:** `#2998 CLI` tests need `withRegisteredPreflight` wrapper.
- **PR / branch:** #3626 / `codex/3624-mandatory-review-preflight` — OPEN, ready.
- **Worktree:** `3626-prep-mimo` — live (resumable).
- **Deliberately did NOT do:** reviewer draw.

### Agent: general-8 — Prep PR #3627
- **Asked to do:** code prep only.
- **Actually did:** curated Master Data routing reapplied into `queue-routing.mjs`; 800 tests; evidence gen 3; head `dd64ac91`.
- **Found:** exits live in `queue-routing.mjs`; `security-settings` exits `repo-session` (#3675).
- **PR / branch:** #3627 / `codex/3563-curated-data-recovery` — OPEN, ready.
- **Worktree:** `3627-prep-mimo` — live (resumable).
- **Deliberately did NOT do:** reviewer draw.
