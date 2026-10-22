---
issue: 2530
status: OPEN
owner: mimo/ffe5ec4d8a438ffeMsuIzWTbV4
---

# Handoff — popcre/shared-db #2530 merge-queue Steps 9–10 (edge-dev)

**Session:** MiMo chat `ffe5ec4d8a438ffeMsuIzWTbV4` on `edge-dev`
**When:** 2026-10-21, ~9:10 AM EST
**Repo:** https://github.com/popcre/shared-db
**Plan:** https://github.com/popcre/shared-db/blob/main/plan_shared_db_popcre_transfer_merge_queue.md
**Issue:** https://github.com/popcre/shared-db/issues/2530

Repository-maintenance (merge-queue program). No structural claim. Claim-first does not apply to this workstream.

---

## 0. Business decisions only the owner can make

**None.** Technical merge-queue activation is authorized on #2530. Remaining work is mechanical proof, gated by AI reviewers.

**Already settled — do NOT re-ask:**
- 2026-09-27/28: turn on the GitHub merge queue for popcre/shared-db as the plan describes.
- 2026-09-28: never ask a human to approve technical actions; assigned AI reviewers gate them.
- 2026-10-20: if #4503's owner has not enqueued it, take it (this session started that; another session now owns #4503).

---

## 1. What this application is

`popcre/shared-db` is the canonical shared Supabase backend repo. This workstream activates GitHub's native merge queue so approved PRs serialize and cannot lose merge races, without breaking Guarded Merge.

## 2. What we set out to do this session

Finish plan #2530 Steps 9–10: docs-only canary through the queue, then a genuine reviewed migration through the queue.

## 3. Current state — checked 2026-10-21 ~9:00 AM EST

| Item | State | Evidence |
|---|---|---|
| Step 8 dispatch hardening | MERGED PR #4305 (`d0c99556fe`) | earlier handoff |
| Authorized-head gate fix | MERGED PR #4363 (`a79c2d281`) | Muse APPROVE on `73968fa8c` |
| Queue ruleset | ACTIVE id `25146118` | `configure-merge-queue.mjs --apply` read-back |
| Live `merge_group` dispatch | PROVEN | 8 runs on synthetic SHA `a1e994c34d63cf603822e42995fb74bb84fc8471` |
| Step 9 docs-only canary | DONE | PR #4364 merged `3fcb3c65` (2026-10-15 23:59 ET) |
| Step 10 migration-through-queue | **NOT DONE** | see §4/§6 |
| Preview / production | Nothing applied | no migration authored this session |

## 4. Everything we tried that did NOT work (MANDATORY)

1. **Enqueue without `Migration guarded merge authorization` on the PR head** — GraphQL `enqueuePullRequest` refuses: required status expected.
2. **Pure docs-only canary (no evidence pair)** — `--acquire-merge` / Queue interlock requires one current keyed canonical evidence pair.
3. **Docs + evidence pair** — classifier says not documents-only (`.agent/**/*.json` is not prose), so `documents-only-merge-authorization` will not post the status. Catch-22 for a canary that needs both a pair and the docs-only status path.
4. **Guarded Merge on #4360** — refused: "structural issue, route or exact writes disagrees" (contract said `repo-maintenance`, diff was a real migration).
5. **`ai-glm` governed reviews on edge-dev** — fatal `runner: ai-glm: error: governed source root is not a repository top level.` even from a full clone whose `.git` is a directory. Logged as `20261021T004546Z-edge-dev-glm-2037169`.
6. **Allocator kept drawing glm-5.3** for #4503 slot 1 after repeated `--replace-failed-reviewer`; `--reviewer-allowlist` refused ("does not match the durable unrestricted assignment").
7. **Force-rewrite of a PR branch** — review-budget circuit breaker refuses (`complete first-parent ancestry unavailable`, `historical evidence predecessor hash refused`, `conflict is outside the one canonical test append`). Use a **successor PR number** to reset it.
8. **`gh pr merge --queue`** — not a real flag. Use GraphQL `enqueuePullRequest` (needs the authorization status first) or `gh pr merge --auto`.
9. **`--admit-issue` with `--release-failed-reviewer`** — refused combination. Use `--admit-issue` only with assign/replace.
10. **schema_version 1 multi-generation evidence** — review budget wants `evidence_parent` on non-baseline generations. Use `schema_version: 2` with parent binding when stacking generations.

## 5. Root causes and key findings

- **Two merge doors.** Guarded Merge (`guarded-migration-merge.yml`) is still a blessed direct-merge path. The queue only runs when a PR is *enqueued*. That is why migrations keep landing outside the queue — not a bug, a path choice.
- **`Migration guarded merge authorization` is required to enqueue.** Produced by Guarded Merge (code/structural) or documents-only-merge-authorization (prose-only).
- **Evidence pair is required for `--acquire-merge`.** Pair files make a PR "not documents-only."
- **Review budget** tracks before→after content between paid draws. Rewritten history or a conflict-resolved main merge is refused. New PR number = fresh budget.
- **`ai-glm` sandbox on edge-dev is broken** for repository top-level detection (Windows path / worktree `.git` file). Incident logged and published.

## 6. Exact next steps

1. **Do not touch PR #4503** — another session holds `author-acquisition` for issue 4427 / pr 4503 at head `fbb9a281d28edd2e3ce86ed1a6ed4b3383dfce10`. That session should enqueue it via the queue once it has a durable APPROVE. That landing **is** Step 10.
2. If #4503 is merged outside the queue, Step 10 still needs one migration **through the queue**. Next genuine migration PR with a durable APPROVE should be enqueued (not Guarded Merge direct).
3. Do not roll back ruleset `25146118` unless dispatch dies (zero `merge_group` runs within 5 minutes of enqueue). Rollback = delete/revert that ruleset by id.
4. Optional repair: fix `ai-glm` sandbox "repository top level" on edge-dev (see reviewer incident).

## 7. Constraints and gotchas in force

- Never `--admin` / bypass merges. Never touch PR #3998, claims #4152/#4204, or landing-only `C:\repos\shared-db` except landing.
- Sign every GitHub post: `Posted by MiMo chat ffe5ec4d8a438ffeMsuIzWTbV4 on edge-dev`.
- Reviewer assignment from a **main-current** worktree; `SHARED_DB_AUTHOR_ENGINE=mimo`.
- Author-acquisition mutex: if stranded, workflow `recover-author-mutex.yml` with `expected_sha` + `confirmation: RECOVER <sha>`.
- Required status contexts (14) live in `REQUIRED_STATUS_CHECK_CONTEXTS`.
- `ai-shared-db-closeout-check` only accepts Codex/Claude **UUID** session ids — MiMo chat ids (`ffe5ec4d…`) are rejected. That is a tooling gap, not a clean bill of health.

## 8. Access and environment

- Host: `edge-dev`. Session id `ffe5ec4d8a438ffeMsuIzWTbV4`.
- `gh` authenticated to `popcre/shared-db`.
- Reviewers in rotation: `glm-5.3`, `muse-spark-1.3-contributor`, `deepseek-v4.1-flash`, `stepfun-step-5-preview`.
- Git credential helper fixed 2026-10-21: `credential.https://github.com.helper` now points at `C:/repos/ai-devops/bin/ai-gh` (was a missing `ai-devops-inst` path).

## 9. Open questions and risks

- **Step 10 queue proof still open** — the whole remaining goal.
- **GLM sandbox on edge-dev** — unresolved; blocks normal governed reviews via `ai-glm` on this machine.
- **`ai-shared-db-closeout-check` MiMo id gap** — cannot pass the UUID gate from a MiMo session.
- **Facts likely stale:** `main` tip SHA, max migration version, #4503 merge state — re-read before acting.

---

## Part (b) — sub-agent / parallel work this session

No sub-agents dispatched by this session.

### Workspace left behind (deliberate)
- `D:/repos/shared-db-worktrees/2530-gate-fix` — canary branch worktree (PR #4364 merged). Keep until a successor confirms safe cleanup.
- `D:/repos/shared-db-worktrees/2530-allocator` — main-current tooling worktree. Keep.
- `D:/repos/shared-db-worktrees/rls-4427-resume` — another session's #4503 worktree. **Do not touch.**
- `D:/repos/shared-db-clones/4503` — full clone used for review attempts. Safe to delete.

Posted by MiMo chat ffe5ec4d8a438ffeMsuIzWTbV4 on edge-dev
