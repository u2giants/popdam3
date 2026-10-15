---
issue: 2530
status: OPEN
owner: mimo/ffe5ec4d8a438ffeMsuIzWTbV4
---

# Handoff — popcre/shared-db #2530 merge-queue Steps 8–10 (edge-dev)

**Session:** MiMo chat `ffe5ec4d8a438ffeMsuIzWTbV4` on `edge-dev`
**When:** 2026-10-15, closed ~7:10 AM EDT
**Repo:** https://github.com/popcre/shared-db
**Plan:** https://github.com/popcre/shared-db/blob/main/plan_shared_db_popcre_transfer_merge_queue.md
**Issue:** https://github.com/popcre/shared-db/issues/2530
**Prior handoff:** https://github.com/popcre/shared-db/blob/main/HANDOFF.d/2026-10-14T2048Z-edge-dev-mimo-2530-merge-queue-closeout.md

This is a **repository-maintenance** handoff (merge-queue program). No structural claim, no migration author lease, no preview/production write. Claim-first does not apply.

---

## 0. Business decisions only the owner can make

**None — nothing in this workstream needs the owner.** Technical merge-queue activation is already authorized by Albert on #2530 ("I approve turning on the GitHub merge queue for popcre/shared-db as the plan describes"). Remaining work is mechanical repair and proof, gated by AI reviewers, not by Albert.

**Already settled — do NOT re-ask:**
- 2026-09-27/28: turn on the GitHub merge queue for popcre/shared-db as the plan describes (owner comment on #2530).
- 2026-09-28: never ask a human to approve technical actions; assigned AI reviewers gate them.

---

## 1. What this application is

`popcre/shared-db` is the canonical shared Supabase backend repo (schema, migrations, CI/controls) for POP Creations apps. This workstream is **not** a database change: it activates GitHub's native **merge queue** on `main` so approved PRs serialize one-at-a-time and cannot lose merge races, without interrupting the existing Guarded Merge lane.

## 2. What we set out to do this session

Resume plan #2530 **Steps 8–10** on edge-dev (same goal as the prior closeout handoff): fix and merge the dispatch-hardening PR, apply the dual-rule queue ruleset, prove GitHub actually starts `merge_group` Actions runs (the canary that failed on 2026-10-14), complete the Step 9 canary through GitHub merges, then Step 10 only with a genuine reviewed migration.

## 3. Current state — what is true right now

Checked **2026-10-15 7:04 AM EDT**.

| Item | State | Evidence |
|---|---|---|
| `main` tip | `d0c99556fe5364d5ce67066cc206c66ec2619ba2` | https://github.com/popcre/shared-db/commit/d0c99556fe5364d5ce67066cc206c66ec2619ba2 |
| Max migration | `20261014043757_render_z_nas_password_vault.sql` | https://github.com/popcre/shared-db/tree/main/supabase/migrations |
| Step 8 dispatch hardening | **MERGED** as PR #4305 | https://github.com/popcre/shared-db/pull/4305 merge `d0c99556fe` |
| Queue ruleset | **ACTIVE** id `25146118` — `merge_queue` (one-PR MERGE/ALLGREEN) + `required_status_checks` (14 contexts) | https://github.com/popcre/shared-db/rules/25146118 ; read-back https://github.com/popcre/shared-db/blob/main/docs/verification/merge-queue-ruleset-readback-20261015.json |
| Live dispatch probe | **PASS** | 8 `merge_group` workflow runs on synthetic SHAs `6ff65dda…` and `cbc6af11…` within seconds of enqueue. https://github.com/popcre/shared-db/blob/main/docs/verification/merge-queue-live-dispatch-probe-20261015.json |
| Step 9 canary | **PARTIAL** — PR #4321 enqueued, dispatch proven, **not merged** | https://github.com/popcre/shared-db/pull/4321 head `e844a091fd83d78ee1fd09e46acfae8fb8ceed2d` |
| Step 10 migration-ordering proof | **NOT STARTED** | needs a genuine reviewed migration PR (#4206 / #4221, owned by other sessions) |
| Preview / production | **Nothing applied.** No migration authored this session. | |

### What works (verified)

- Bare `on: merge_group:` (no `types: [checks_requested]`) makes GitHub start Actions on merge groups. This was the root cause of the 2026-10-14 rollback (zero runs for 18 minutes). Proven live twice this session.
- Dual-rule ruleset shape (`merge_queue` + `required_status_checks`) applies and reads back cleanly via `scripts/configure-merge-queue.mjs --apply`.

### What is half-done

- **Canary PR #4321** (docs-only + gen-7 evidence pair) is in the merge queue (`AWAITING_CHECKS`). `merge_group` workflows **do start**, but `Merge Queue Gate` refuses: `merge group cbc6af11… does not contain the exact authorized PR head e844a091…`. PR Guards also failed on that group. See §4.
- Uncommitted evidence JSON files were copied into this closeout branch (see §5).

## 4. Everything we tried that did NOT work (MANDATORY)

1. **Guarded Merge on PR #4305 with the original gen-1 evidence pair** — refused: `completion report is missing stop_conditions_hit`. The pair also had wrong `files_changed` (included the evidence files themselves), a `contract_sha256` that did not match the local contract, and `contract_ref` pointed at `refs/db-contracts/2530/1` which is a **different** old Claude contract. Repair required a new generation, not an edit.
2. **Merging `origin/main` into #4305 to fix the 1684 EOL guard** — pulled in unrelated migrations (`20261013130102_licensing_support_forward.sql`, types dump, other sessions' worktrees). Aborted. Later a **targeted** `types/database.types.ts` sync + a clean main merge once evidence was rebuilt was the right shape.
3. **Adding the disposition catalogue on a branch based on old main** (`2530-disposition-catalogue-unblock` / PR #4312) — locally `discover()` found no PATTERN hits (old `check-exact-head-approval.mjs`) so the catalogue looked orphaned; CI tests the **merge with current main**, which has the hits. Main landed the same catalogue independently; #4312 closed as superseded.
4. **`gh run rerun` for Tools Offline Tests** — reuses the **old** merge commit; does not re-merge with current main. An **empty commit** on the PR branch is what forces a fresh `pull_request` merge SHA without changing tree bytes (and without breaking the evidence-tail rule).
5. **`SHARED_DB_AUTHOR_ENGINE=mimo` from the PR worktree** — that worktree's roster was pre-`mimo`. Must run assign/review tooling from a worktree at current `main` (e.g. `2530-catalogue-unblock`).
6. **GLM assignment sequence 6537** — silent lease reclaimed mid-flight (`silent_worker_observed`). Replacement drew Muse (6538); Muse recorded APPROVE. DeepSeek (6539) later APPROVEd the gen-6 head and that verdict is the one durable on `213857c7d`.
7. **`ai-review` from the wrong worktree** — `source-head-mismatch` because the worktree HEAD was the catalogue branch, not the PR head. Always assert-head from the PR's own worktree.
8. **Pushing canary evidence while #4321 was queued** — `GH006: queued for merging cannot be updated`. Must `dequeuePullRequest` (GraphQL, PullRequest node id) first, push, then re-enqueue.
9. **Canary without an evidence pair** — Queue interlock: `one current keyed canonical evidence pair is required`. Docs-only is not enough for the merge_group path.
10. **`configure-merge-queue.mjs --apply` with an author-acquisition mutex held** — refused in a prior session. This session the mutex was free (or recovered via `recover-author-mutex.yml`) and apply succeeded.
11. **Long `ai-review` / assign runs killed by the tool timeout** — leaves `refs/db-coordination/author-acquisition` stranded. Recover with workflow `Recover Stranded Author Mutex` (`recover-author-mutex.yml`) and the exact held SHA + `RECOVER <sha>` confirmation. Local `--recover-author-mutex` is refused outside that serialized workflow.

## 5. Root causes and key findings

- **`types: [checks_requested]` under `on.merge_group` is a known GitHub dispatch footgun.** Official example is bare `merge_group:`. Confirmed by canary #4298 (zero runs) vs this session (8+ runs).
- **Evidence pair shape (critical):** `report.head_sha` = implementation commit; only the two `.agent/work/<issue>/<gen>/{contract,completion}.json` files may follow it; `files_changed` must be the implementation files **without** the evidence pair; `contract_ref` must be a **published immutable** ref matching `contractHash(contract)`; `stop_conditions_hit` is required (use `[]`). Publish with `node scripts/agent-work-contract.mjs --publish-contract --contract-file …` (create-if-absent). Generation must be unique per issue (`2530/1`–`2530/7` now exist).
- **CI `pull_request` runs the merge with current `main`**, not the PR tree alone. A PR based on an old main can fail checks that pass locally (disposition catalogues, 1684 EOL deltas on `types/database.types.ts`).
- **Branch freshness:** Guarded Merge / reviewer draw refuses if `origin/main` has moved past the dispatched commit with non-documentation changes. Merge main into the PR branch and rebuild the evidence pair (new generation) when that happens.
- **Review verdict recording:** a review file alone is not authority. Post findings as a PR comment, then `recordReviewVerdict({issue,pr,slot,headSha,verdict,replacementSequence?,findingsRef})` from a worktree at current main. The assignment must hold an active lease.
- **`dequeuePullRequest` GraphQL** takes the **PullRequest node id** (`PR_…`), not the merge-queue entry id (`MQE_…`).

Key code (on `main` after #4305):
- https://github.com/popcre/shared-db/blob/main/scripts/merge-queue-contract.mjs — `REQUIRED_STATUS_CHECK_CONTEXTS` (14), `queueRulesetMatches`
- https://github.com/popcre/shared-db/blob/main/scripts/configure-merge-queue.mjs — `desiredRuleset()` dual-rule shape
- https://github.com/popcre/shared-db/blob/main/scripts/agent-work-contract.mjs — `publishContract`, `validateCompletionReport`, `reconcileReportWithContract`
- https://github.com/popcre/shared-db/blob/main/scripts/agent-work-contract-git-evidence.mjs — `verifyGitEvidence` tail rule

## 6. Exact next steps

1. **Fix Merge Queue Gate exact-head containment vs the evidence-tail pattern** on canary #4321 (or a successor canary).
   - Failure: https://github.com/popcre/shared-db/actions/runs/38705284801 — `merge group cbc6af11… does not contain the exact authorized PR head e844a091…`.
   - Likely cause: the gate reads the evidence `head_sha` (`944ff07fd…`, implementation) or an authorized-head snapshot, while the live PR head is `e844a091f…` (implementation + gen-7 pair). Align the gate's "authorized PR head" with the live PR tip (or accept ancestor + evidence-tail the way `verifyGitEvidence` does).
   - You'll know it worked when Merge Queue Gate is green on a `merge_group` synthetic SHA and the canary PR reaches `MERGED` via the queue (not Guarded Merge direct path).
2. **Complete Step 9 canary** — docs-only canary merges through GitHub's queue; all 14 required contexts green on the synthetic SHA. Update plan STATUS row 9.
3. **Step 10 only** when a genuine migration PR has exact-head review. Re-list open migration PRs; #4206 (version `20261013130102`) and #4221 (version `20261013144638`) may have moved to main. Never create a migration for the test.
4. **Do not roll back ruleset 25146118** unless dispatch dies again (zero `merge_group` runs in 5 minutes). Rollback = delete/revert that ruleset by id.

## 7. Constraints and gotchas in force

- Never `--admin` / bypass merges. Never touch PR #3998, claims #4152/#4204, or landing-only `C:\repos\shared-db` except landing.
- Worktrees to **KEEP**: `D:/repos/shared-db-worktrees/2530-canary-20261015` (canary #4321), `D:/repos/shared-db-worktrees/2530-steps910-prep`, `C:/repos/shared-db-wt-2530-mqdispatch-20261014` (uncommitted evidence was copied out; branch merged).
- Repositories: `popcre/shared-db` branch-and-PR; Albert does not merge. Sign every GitHub post: `Posted by MiMo chat <id> on <machine>`.
- Reviewer assignment from a **main-current** worktree; `SHARED_DB_AUTHOR_ENGINE=mimo`. Draw/replace via `--assign-reviewer` / `--replace-failed-reviewer`. Durable verdict via `recordReviewVerdict`.
- Author-acquisition mutex: if stranded, workflow `recover-author-mutex.yml` with exact SHA. Do not steal a live lock.
- Required status contexts (14) live in `REQUIRED_STATUS_CHECK_CONTEXTS` — do not widen branch protection beyond that list in this workstream.

## 8. Access and environment

- Host: `edge-dev`. Session id `ffe5ec4d8a438ffeMsuIzWTbV4`.
- `gh` authenticated to `popcre/shared-db`. Make GitHub calls through `bin/ai-gh` when in ai-devops; watch rate limits (this session exhausted the REST budget once).
- Reviewers in rotation (shared-db allocator): `glm-5.3`, `muse-spark-1.3-contributor`, `deepseek-v4.1-flash`, `stepfun-step-5-preview`. `ai-review` wrappers under `~/.local/bin`. Secrets in 1Password vault `vibe_coding` only — never values in this file.
- Worktrees listed in §7. Tooling: `scripts/manage-migration-author-lanes.mjs`, `scripts/agent-work-contract.mjs`, `scripts/configure-merge-queue.mjs`.

## 9. Open questions and risks

- **(2026-10-15) Merge Queue Gate head-containment vs evidence-tail** — unresolved; blocks Step 9 canary completion. Not a business question; fix the gate or the authorized-head source.
- **(2026-10-15) PR #4321 is still queued** — if the gate stays red the queue will keep it `AWAITING_CHECKS`. Dequeue before pushing; consider a fresh canary PR after the gate fix rather than fighting this one.
- **(2026-10-15) Ruleset 25146118 is live** — a regression that stops `merge_group` dispatch should roll back that ruleset by id within the 5-minute probe rule.
- Stale-ish: prior handoff claimed GLM APPROVE on `f79c560ab`; that head is gone (evidence rewritten through gens 3→6). Durable APPROVE is DeepSeek on `213857c7d` / Muse on `885966923`.

---

## Part (b) — sub-agent / parallel work this session

### Agent: general-1 (DeepSeek review attempt on PR #4312)
- **Asked to do:** exact-head final-check for catalogue unblock PR #4312.
- **Actually did:** DeepSeek unusable (`ChildProcess.kill`); GLM returned a cached pass bound to `578a006b3`.
- **Found:** DeepSeek `final-check` can die with `ChildProcess.kill` on this host; GLM is a working fallback and reuses prior exact-head passes.
- **PR / branch:** #4312 later closed as superseded.
- **Worktree:** `2530-catalogue-unblock` — kept (useful for main-current tooling).
- **Deliberately did NOT do:** re-run DeepSeek after the process kill.

### Agent: general-2 / general-3 (assign + review loops on #4305)
- **Asked to do:** assign reviewer and obtain APPROVE at the PR head.
- **Actually did:** hung/timeout; left author-acquisition mutex stranded twice; one `silent_worker_observed` reclaim on GLM 6537.
- **Found:** long reviewer CLI runs must not be killed; recover mutex via workflow; record verdicts explicitly with `recordReviewVerdict`.
- **PR / branch:** #4305 — MERGED `d0c99556fe`.
- **Worktree:** `C:/repos/shared-db-wt-2530-mqdispatch-20261014` — finished (branch merged); evidence JSONs copied to closeout branch.
- **Deliberately did NOT do:** invent a verdict without a durable ref; force-push.

---

## Self-audit (handoff-writer)

1. **Comprehensive for a brand-new developer?** Yes — §3 current state with SHAs/URLs, §4 dead ends, §6 exact next steps with verification gates.
2. **As effective as this session?** Yes — evidence-pair shape, CI-merge behavior, reviewer/verdict recording, mutex recovery, dequeue API are all in §4–§5.
3. **Every relevant detail?** Yes — business goal, live proof artifacts as GitHub URLs, failures, constraints, access, risks. Preview/production explicitly "nothing".
4. **Section 0 only?** Yes — no owner decisions remain; only settled rulings listed so they are not re-asked.

Posted by MiMo chat ffe5ec4d8a438ffeMsuIzWTbV4 on edge-dev
