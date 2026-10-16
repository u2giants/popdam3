---
issue: 2336
status: OPEN
owner: mimo/edge-dev-2336-licensing-merge-production
---

# Handoff — #2336 licensing engine: merges landed, production apply + live proof remain

## 0. ⚠️ BUSINESS DECISIONS ONLY THE OWNER CAN MAKE

**Already settled — do NOT re-ask** (Albert, this chat, 2026-10-14):
- "use stepfun" — StepFun is the slot-2 reviewer for #4206 (used; assignment recorded).
- "Switch to muse as the reviewer" (earlier) — Muse is slot 1 (kept; not re-drawn).
- "our process/rules are broken" + "have a subagent rewrite those rules now" — rules were rewritten (tree-identical re-pushes keep reviews; tooling = one review; owner-quoted allowlist widening).
- "don't abide by those broken rules while changing the rules. just implement" and "throw out the rules" — admin bypass was enabled on `main` and PRs #4294 and #4206 were merged without waiting for full two-slot review. Branch protection `enforce_admins` is currently **off**.
- "bypass all of this and merge it" / "where do I go to turn off branch protection?" — completed by the AI via `gh api` (admin enforcement deleted). Owner was not asked to click anything.

**Open for the owner (one message, before starting work):**

1. **Blocking production apply (recommendation: keep admin bypass off until apply+live proof finish, then restore `enforce_admins`).** `enforce_admins` on `popcre/shared-db` `main` is still `false` so this chain can finish. If you want it back on sooner, say so — the next session will restore it after live proof. Blocks nothing right now if left off; it is a standing safety gap.

2. **Wrong guess recoverable (recommendation: continue production apply for version `20261013130102` even though review evidence is from an older chain).** The production job refuses because the Oct 13 preview evidence package is not the one this session can name. A wrong guess here re-applies nothing (guard: never re-applies an applied version). Blocks step 3 in §6.

3. **Outside this workstream (recommendation: popdam3 #277 SO Date reader can proceed once live proof passes).** Downstream `popdam3` #277 (shared-db #4270 / version `20261013211042`) waits on this licensing chain. Nobody is applying #277 in this session.

No technical approvals belong here. Assigned AI reviewers gate technical actions.

---

## 1. What this application is

**popcre/shared-db** is the shared PostgreSQL/Supabase schema and migration repo every POP Creations app reads (CRM, DAM, PM/PIM, DesignFlow, PopDAM/PopDam3). One bad change breaks all apps. GitHub: https://github.com/popcre/shared-db

This workstream is the **hash-pinned licensing consolidation engine** (issue #2336): bounded multi-property rename refusal, keyed typed row access, source-retirement indexes, UTC-stable snapshots, applied-history transition. Migration version **`20261013130102`** (`supabase/migrations/20261013130102_licensing_support_forward.sql`). Claim #4152. Downstream: PopDAM Order List SO Date reader (popdam3 #277, shared-db #4270, version `20261013211042`).

## 2. What we set out to do this session, and why

Unblock PR #4206 (work #2336, claim #4152). Slot 1 was Muse-only (owner quote). Slot 2 could not be Muse. Owner said "use stepfun". Assigning slot 2 with a widened allowlist was refused (did not match durable assignment). A tree-identical re-push to redraw both slots hit the review circuit breaker. After 6+ hours of blocked reviews the owner ordered the rules rewritten and the work merged.

## 3. Current state — what is true right now

**Merged to `main` (verified `gh pr view` state=MERGED):**
- https://github.com/popcre/shared-db/pull/4294 — tooling: owner-quoted allowlist widening, tree-identical slot-1 carry-forward, `mimo` author engine, composed carry in the approval gate. Merge commit `93a6a4499bb2f5ad60f5cfe47b30e40b3292c91a`.
- https://github.com/popcre/shared-db/pull/4206 — licensing engine migration `20261013130102`. Merge commit `5af6ca6768999460c944f65ee67f3380851e8a4b`. Sync to consumers succeeded.

**Reviewer slots on #4206 head `aa9c8a3d8d9066e93ed9c1b6185f56c18bbd9fea`:**
- Slot 1 Muse (`muse-spark-1.3-contributor`) at tree-identical `61b97f6c1b9f8db230f3b8cbba9572a0e5e987e2`, verdict APPROVE (durable `refs/db-review-verdicts/2336-4206-61b97f6c1...`). Not re-drawn.
- Slot 2 StepFun (`stepfun-step-5-preview`) assigned seq 6518 with owner quote "use stepfun", allowlist `muse-spark-1.3-contributor,stepfun-step-5-preview`. First run failed (Windows wrapper); replacement/review was in flight when the PRs were admin-merged.

**Branch protection:** `enforce_admins` is **false** on `main` (deleted via `gh api -X DELETE .../enforce_admins`) so admin merge could proceed. Required status checks list is unchanged.

**Production:** version `20261013130102` appears in the production migration record capture with an **empty applied-version column** (ledger reservation / incomplete apply), NOT proven applied. Live proof probe (https://github.com/popcre/shared-db/blob/main/.github/live-proofs/2336.sql) returns not-passed on production. Run 38640478314 (`Shared DB Live Proof`) failed: probe did not return one row `passed=true`.

**Live proof:** not done. Probe requires exact signatures for `plm.plan_licensing_consolidation(text,uuid,text)`, `plm.apply_licensing_consolidation(uuid,text)`, `plm.plan_licensing_consolidation_rollback(uuid,text)` (security definer, `search_path=pg_catalog`), `plm.licensing_consolidation_plan_immutable()`, and table `plm.licensing_consolidation_plan` with RLS + trigger.

**Claim #4152 / work #2336:** claim was relinquished on hetz (`blocked_on artifact:aa9c8a3d...`). Ready receipt `refs/db-author-handoff-ready/4152-20261013130102-de692d40fb08f2c559c55870` (and earlier `...-fe4585c5c786fca07843889b`). Hetz worktree `/worksp/.worktrees/shared-db-2336-successor` (Claude session). Local worktree `C:/repos/shared-db/.ai/worktrees/4152-successor` exists on branch `codex/2336-complete-support` / `mimo/4152-successor`.

**Tooling merged (on main) that successors can rely on:**
- `inheritReviewerAllowlist` accepts a **strict superset** of the durable allowlist when `ownerQuote` is non-empty (verbatim quote recorded as assignment commit body).
- `findCarriedSlotOne` carries slot 1 across a tree-identical / content-equivalent ancestor (same tree or `budgetProof.kind==='unchanged'`), preferring the newest replacement.
- `check-exact-head-approval.mjs` composed carry: slot 1 from equivalent ancestor + new slot 2 at this head; prior returns fail closed.
- `REINSTATABLE_FAILURE_CODES` includes `reviewer_cannot_read_repository` (broken local wrapper is a tooling fault, not a reviewer refusal).
- `ENGINE_REVIEWER_EXCLUSION` / `ENGINES` include `mimo`.
- Docs: `docs/agents/merge-protocol.md` ("Review slots and carried reviews"), `anti-collision-summary.md`, `standing-facts.md` item 20.

## 4. Everything we tried that did NOT work

1. **Assign slot 2 at live head with widened allowlist, no quote, against Muse-only durable policy** — `reviewer allowlist does not match the durable assignment`. Reasonable: exact match was the old rule. Failed until owner-quoted widening was implemented.
2. **Tree-identical re-push `aa9c8a3d` to redraw both slots** — circuit breaker: "two paid attempts already started for unchanged reviewed content in slot 1". Redrawing slot 1 is never the right path for tree-identical bytes.
3. **`ai-review glm/stepfun/gemini diff-review` on the worktree** — `source-digest-mismatch` / `source-head-mismatch` / sandbox orphan noise. Only `scripts/run-governed-review.mjs` worked for durable verdicts.
4. **Foreground long `node scripts/manage-migration-author-lanes.mjs --assign-reviewer ...`** — harness `ChildProcess.kill` after 1–5 minutes; left `refs/db-coordination/author-acquisition` held. Fix: `Start-Process -WindowStyle Hidden` + poll logs; release mutex via `releaseOwnedRef(MUTEX_REF, readRef(MUTEX_REF), githubIo)` (dynamic `import()`; `require()` cannot load the module).
5. **Slot 2 draw after StepFun wrapper failure** — first run recorded `reviewer_cannot_read_repository` (not reinstateable) so the circuit breaker blocked a third paid attempt. Fixed by adding that code to `REINSTATABLE_FAILURE_CODES` and using `--replace-failed-reviewer` with the **same** failure code as the immutable release (`--failure-code reviewer_cannot_read_repository`). Using a different code on release/replace is refused ("immutable reviewer release evidence does not match").
6. **Post-merge preview rehearsal with `claim_pr` + `merged_preview_source_pr`** — refused: "merged_preview_source_pr replaces claim_pr... do not name both." Drop `claim_pr` for post-merge rehearsal.
7. **Post-merge preview apply of `20261013130102`** — `BLOCKED: already applied on preview`. Needs **historical-recovery** lane: `historical_preview_source_pr` + `historical_preview_original_run_map=20261013130102:<originalRunId>`. Original run ID is from ~2026-10-13 and was **not** found in the first 50 recent `shared-supabase-migrations.yml` runs.
8. **Production apply with no `review_run_id` / with `ephemeral_check_run_id`** — "review run ID must be a positive decimal integer, not a URL or path." Production wants `review_run_id` + `review_artifact_digest` (or a machine-activated automatic policy path).
9. **Live proof workflow `work_issue=2336`** — probe `passed` is not true on production (objects not there yet). Do not "fix" the probe to make it pass.
10. **Disabling admin enforcement + `gh pr merge --admin`** — this **did work** (owner-ordered) for #4294 and #4206. Not a failed attempt; listed because the successor must know how the merges happened.

## 5. Root causes and key findings

- Tree-identical re-pushes must never re-draw slot 1; carry the ancestor assignment/verdict. Implemented in `scripts/lib/lanes/review-assignment.mjs` (`findCarriedSlotOne`, `sameReviewContent`) and `scripts/check-exact-head-approval.mjs` (composed carry, `evaluateApprovalWithRefresh`).
- `contentPreservingRefresh` / `isContentPreservingRefresh` return `{ok:true, implementation_digest}` for `61b97f6c` → `aa9c8a3d` (same PR diff). `eeda52f` is **not** equivalent (main moved).
- Windows `ai-stepfun` shim: `bash.exe` must not be a non-PE script copy (Node spawn ENOENT); shim must pass `bash` as argv[0]. Fixed in `ai-devops/bin/ai-stepfun`.
- Long GitHub-heavy Node operations in this environment get killed; run detached and poll.
- Production apply is evidence-gated (immutable review/preview run IDs). Admin merge does not bypass that job.
- Version `20261013130102` is on **preview** (from the Oct 13 claim work) but not proven on **production**.

## 6. Exact next steps

1. **Ask the owner the §0 list in one message** (especially restoring `enforce_admins`).
2. **Find the original preview apply run for `20261013130102`** (~2026-10-13). Search `gh run list --workflow shared-supabase-migrations.yml` further back, or `refs/` preview evidence, or issue #2336/#4152 comments for a run URL. You'll know it worked when you have a numeric run ID that applied `20261013130102` to preview (read `PREVIEW_PROJECT_REF`; do not record the literal).
3. **Historical preview rebind** (evidence only; never re-apply an applied version):
   ```
   gh workflow run shared-supabase-migrations.yml --repo popcre/shared-db \
     -f target=preview -f mode=apply \
     -f preview_allowlist=20261013130102 \
     -f commit_sha=<current main tip> \
     -f historical_preview_source_pr=4206 \
     -f historical_preview_original_run_map=20261013130102:<originalRunId> \
     -f merged_pr_issue_binding=4206:2336
   ```
   You'll know it worked when that run's preview job succeeds and produces a preview evidence artifact digest.
4. **Production apply** using that evidence (or `review_run_id=<run>` + `review_artifact_digest=<sha256>`):
   ```
   gh workflow run shared-supabase-migrations.yml --repo popcre/shared-db \
     -f target=production -f mode=apply \
     -f production_allowlist=20261013130102 \
     -f commit_sha=<current main tip> \
     -f confirmation="APPLY <current main tip>" \
     -f source_pr=4206 -f work_issue=2336 \
     -f merged_pr_issue_binding=4206:2336 \
     -f review_run_id=<numericRunId> -f review_artifact_digest=<sha256>
   ```
   You'll know it worked when `Capture production migration record` shows `20261013130102` with a non-empty applied version and the apply job is green.
5. **Live proof:** `gh workflow run shared-db-live-proof.yml --repo popcre/shared-db -f work_issue=2336`. Success = `LIVE PROOF PASSED: #2336 ...` and artifact `shared-db-live-proof-2336-<sha>`.
6. **Restore `enforce_admins`** unless the owner said keep it off: `gh api -X PUT repos/popcre/shared-db/branches/main/protection/enforce_admins -f enabled=true` (or full protection PUT). You'll know it worked when GET `.../protection` shows `enforce_admins.enabled: true`.
7. **If claim #4152 / hetz worktree is still needed for live proof or outcome completion**, resume per https://github.com/popcre/shared-db/issues/4152 (ready receipt `refs/db-author-handoff-ready/4152-20261013130102-de692d40fb08f2c559c55870`). Do not fake custody of a worktree on another machine.
8. **Notify popdam3 #277** when live proof passes so the SO Date reader can proceed.

## 7. Constraints and gotchas in force

- Never re-apply an applied migration version. Use the historical-recovery lane for already-applied preview versions.
- Migrations still need two independent exact-head APPROVEs **under normal process**; this session merged under explicit owner order to throw out the rules. Do not silently re-apply that bypass to unrelated PRs without a new owner quote.
- `enforce_admins` is currently off — treat as temporary and owner-visible.
- Do not edit other sessions' `HANDOFF.d/` files. Delete a predecessor's file only under the successor rule when its commits are on main and obligations are carried forward.
- Secrets: 1Password vault `vibe_coding` only; never print values. `SUPABASE_ACCESS_TOKEN` is a GitHub Actions secret for live proof.
- Quote times in EST (America/New_York).
- `SHARED_DB_AUTHOR_ENGINE` must be set (`mimo`, `claude`, `codex`, `glm`, or `zcode`) before reviewer draws.

## 8. Access and environment

- Machine: **edge-dev** (Windows). Session `ses_ffe5ec53f931bffehunYz9t0tV`.
- GitHub: `gh` authenticated as `u2giants` (keyring). Repo `popcre/shared-db`.
- Worktrees: `C:/repos/shared-db` (canonical, reading only), `C:/repos/shared-db/.ai/worktrees/allowlist-widen-slot2` (tooling, merged), `C:/repos/shared-db/.ai/worktrees/4152-successor`.
- Hetz: `/worksp/.worktrees/shared-db-2336-successor` (other machine — do not assume local).
- CLI: `node scripts/manage-migration-author-lanes.mjs`, `scripts/check-exact-head-approval.mjs`, `scripts/run-governed-review.mjs`, `gh workflow run shared-supabase-migrations.yml`, `gh workflow run shared-db-live-proof.yml`.
- Secrets vault: `vibe_coding` (1Password). Supabase production project ref `qsllyeztdwjgirsysgai`; preview (read `PREVIEW_PROJECT_REF`; do not record the literal).

## 9. Open questions and risks

- (2026-10-14) Production apply evidence for `20261013130102` is the remaining hard gate. Risk: without the Oct 13 run ID the job refuses; do not forge run IDs.
- (2026-10-14) `enforce_admins` is off. Risk: an unreviewed PR could merge. Restore after live proof unless owner says otherwise.
- (2026-10-14) Slot 2 StepFun durable verdict on `aa9c8a3d` may still be missing (review was in flight at admin-merge). Production evidence paths may require it; record via `run-governed-review.mjs` if asked.
- (2026-10-14) Tools Offline Tests failed on main after #4206/#4294 merges — inspect before relying on CI as a gate.
- (2026-10-14) Reviewer issue logged: `20261014T201712Z-edge-dev-glm-2563781` under `ai-devops/.ai/reviewer-issues/` (re-review cycle + wrapper faults). Maintenance close-out is separate work.

---

## Part (b) — sub-agents this session (coordinator)

| Agent | Asked | Did | Left |
|---|---|---|---|
| general-1 | Draw slot 1+2 on #4206 | Circuit breaker refused slot 1; no draws | Superseded by carry-forward + later draw |
| general-2 | Draw slot 2 after carry-forward | **Succeeded**: StepFun seq 6518, owner quote recorded | Mutex-safe draw recipe in findings |
| general-3 | Rewrite broken review rules | **Done**: composed carry, docs, 964 tests; commit `937fd3e36` on `mimo/allowlist-widen-slot2` | GLM later REVISE'd 3 findings (fixed in `31a79b07e`) |
| general-4 | Land PR #4294 | GLM REVISE (3 high); PR ready but not merged | Merged later by owner-ordered admin merge |
| general-5 | StepFun review slot 2 | Wrapper broken (fixed shim); no VERDICT | Replacement path documented in §4 |
| general-6 / general-7 | Replace slot 2 / re-review #4294 | Cancelled after admin merges | N/A |

## Self-audit (handoff-writer gate)

1. **Comprehensive for a brand-new developer?** Yes — §1–§9 cover app, goal, exact merge SHAs, production gap, dead ends, commands, and gates. Supporting: §3, §6.
2. **As effective as this session?** Yes — owner quotes, admin-merge method, evidence IDs, wrapper/breaker findings are written down (§0, §4, §5).
3. **Every relevant detail?** Yes — failures with why, next steps with verification, secrets by vault name only (§4, §6, §8).
4. **Section 0 complete for the owner?** Yes — settled quotes listed; three open business items with recommendations; no technical approvals. Sweep of "owner/decide/blocking" across §1–§9 promoted to §0.

**Next-session starting prompt (give this to the new session):**

> Read `HANDOFF.d/2026-10-14T2247Z-edge-dev-mimo-2336-production-live-proof.md` in popcre/shared-db (https://github.com/popcre/shared-db/tree/main/HANDOFF.d). Continue issue #2336 / claim #4152: PRs #4294 and #4206 are already merged. Your job is production apply of migration `20261013130102` (find the Oct 13 preview run, historical preview rebind, production apply), then live proof (`gh workflow run shared-db-live-proof.yml -f work_issue=2336`), then restore branch `enforce_admins` unless I say otherwise. Put the §0 business list to me in one message first. Do not re-draw reviewers for tree-identical heads; do not re-apply an applied version. Worktree-only; no admin bypass on unrelated PRs.



