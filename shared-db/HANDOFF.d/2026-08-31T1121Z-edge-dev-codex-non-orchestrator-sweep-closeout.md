---
issue: 1789
status: OPEN
owner: codex/handoff-1789-20260831-1121
---

# Non-orchestrator repository-maintenance sweep closeout

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

### Blocking this workstream

None. Albert has already directed the repo-maintenance session to complete every eligible non-orchestrator maintenance/documentation issue, exclude structural, curated Master Data, application/source-data, and owner-only work, and keep #1789 open until a fresh fully audited queue proves the sweep complete. Do not re-ask those settled decisions.

The current production freeze is an execution gate controlled by the live structural orchestrator, not a new owner decision. Wait for the exact phrase `PRODUCTION FREEZE RELEASE`, then obtain a specific one-PR quiet release before any maintenance merge.

### Outside this workstream and still needing Albert

- Open owner-only security/settings issues #1693, #1353, #870, #718, and #696 remain outside this sweep. Recommendation: leave them routed `owner-only`; do not absorb or close them as maintenance. They do not block branch-only maintenance.

### Already settled — do NOT re-ask

- 2026-08-30/31: complete all eligible non-orchestrator maintenance/documentation issues; keep #1789 open until a fresh audit proves the whole sweep complete.
- 2026-08-30/31: never absorb structural, curated Master Data, application/source-data, or owner-only work.
- 2026-08-31: no shared-db main movement without the live orchestrator's specific one-PR release; current production freeze is absolute.

## 1. What this application is

`u2giants/shared-db` is the governed source of truth for the shared database structure and the repository tooling that safely coordinates migrations, reviews, preview, merge, and production promotion. This workstream is deliberately **not** the structural orchestrator. It owns repository-maintenance and documentation issues listed by the queue audit so that structural production work remains serialized and protected.

Repository: `C:\repos\shared-db` / https://github.com/u2giants/shared-db. GitHub issues are the authoritative queue. The live structural orchestrator is resolved only through `node scripts/check-orchestrator-marker.mjs --resolve`.

## 2. What we set out to do this session, and why

Continue issue #1789 and finish every eligible non-orchestrator repository-maintenance/documentation issue through tested merge and direct verification where applicable. The sweep began with failing PR #1804 and expanded as live structural work exposed additional maintenance blockers. Each implementation stays on an isolated branch, preserves refusal guards, receives full checks and an independent exact-head governed review, and merges only through a serialized one-PR release.

The business purpose is to remove maintenance defects without allowing tooling work to invalidate exact-main production evidence or bypass database governance.

## 3. Current state — what is true right now

Snapshot verified 2026-08-31 11:21 UTC:

- Live marker #1869 resolves to route `01a052f3-c9a9-7bf1-a5b0-ea5cd663b6c0` on EDGE-DEV.
- Exact `origin/main`: `fa05c9ee67217f5914276c81691a0ec8f7f78808`.
- Production freeze is active for structural issue #1703 after guarded PR #1980. No maintenance PR may merge or otherwise move main until exact `PRODUCTION FREEZE RELEASE`, followed by a specific one-PR quiet release.
- Maximum migration on main: `20260831093107_popdam_ranked_search_keyed_visibility.sql`.
- Fresh queue audit exited 0 with `fullyAudited:true`; `unclassified`, `malformed`, `unlabelled`, and `dependencyCycles` are empty. Structural lanes 1–2 are active for #1938/#1912; six lanes are empty. This is audit cleanliness, **not** sweep completion: many repo-session issues remain open.
- #1789 is OPEN and must remain open.

### Held maintenance pull requests

1. **PR #1931 / issue #1824 — READY/HELD.** Exact base `fa05c9ee67217f5914276c81691a0ec8f7f78808`, head `f3377f84045e12d1114abbd60b819bba68f119d6`, OPEN/MERGEABLE/CLEAN. Focused 349/349, Node 932/932, Python passed with expected skips, Git-Bash SQL/diff gates green, all hosted checks green. Kimi sequence 747 full-range APPROVE; durable verdict SHA `1673f990deac4b19e422746c51ff9667579d0f5e`; shipped verifier: 1 approval/1 pinned assignment. Active Kimi lease remains exact assignment owner `d065cee36db7140761f3e4a167f2fe36b459eda8`; do not manually release it.
2. **PR #1933 / issue #1867 — STALE and dependency-blocked.** Remote base `07f80dfcf9fbc20d0a8f0c935518cc71a603b4f1`, head `d16417f0232da067632626183544e67b9e8c713c`. Local gates passed on that old base, but hosted Cross-PR object collision correctly blocks because #1931 edits the same protected manager script. Preserve it; merge #1931 first, then rebase/recheck/re-review #1933.
3. **PR #1935 / issue #1690 — IN PROGRESS, local-only new head.** Remote remains old base/head `07f80dfc…` / `5916d42e58a88b93b596bbdbf850d3f0aeec990e`. Its isolated worktree is cleanly rebased onto `fa05c9ee…` at **unpushed** head `dcd2112f21a5900f26a1f978d861bc4985c041c3`. Focused Node 25/25 and direct Python 225/225 pass. Full Node/Python/Git-Bash/diff, push, hosted checks, fresh review, and verifier remain undone. This is the immediate continuation item.
4. **PR #1946 / issue #1689 — stale.** Remote old base `07f80dfc…`, head `d2fd48fa78dbdc684887f8cbed434d525172490a`. Old-base checks and GLM sequence 746 approval are evidence only. Rebase/recheck/re-review after earlier dependencies permit.
5. **PRs #1948/#1950/#1951/#1954/#1956/#1957 — stale.** Their bases range from `a0f46b99…` to `f1006740…`; exact heads respectively: `d0f66a701da841799fb31616c5cc2c55e560b473`, `3792a9688da076923d38c34c32f395ac097e61a4` (currently conflicting), `a454276b029be59f4cef4215d405f79616b095df`, `d527759e0e69eec9a360e91282c418cb28b60df8`, `eb04488edfce11b066cc55fd7009c6ae61640193`, `a1ee43fc95f92208ced1a4fa066b870d04d5826a`. Every prior review/check is non-authorizing after main movement.

The root checkout is 224 commits behind and contains extensive untracked material owned by other sessions. It was deliberately untouched. Work only in isolated worktrees from current `origin/main`.

No preview or production database mutation was performed by this repo-maintenance coordinator. Production verification described in the chat belonged to the structural orchestrator.

## 4. Everything we tried that did NOT work

- Reusing exact-head reviews after rebases/main movement: correctly invalid. Every head/base change required full checks and a fresh governed review.
- Manual reviewer-ref cleanup: deliberately refused. Terminal leases were released only through exact-owner governed cleanup, and several active leases remain for normal allocator cleanup.
- Reviewer replacement with the original linear historical reread: exceeded the strict 22-request budget. Issue #1962/PR #1963 repaired this with bounded batching and later merged.
- Passing full review evidence in Windows command arguments: exceeded the Windows argument-list limit. Issue #1977/PR #1978 replaced it with a durable digest-bound evidence bundle and merged.
- Treating documentation as enough to forbid manual verdict recording: Grok sequence 739 found the CLI still exposed the route. PR #1931 removed only that manual CLI surface, preserved the governed adapter recorder, added a real CLI refusal regression, then obtained fresh Kimi approval after rebase.
- Chained replacement verdict lookup using one batched ref: Kimi sequence 735 showed this could inspect the wrong predecessor and falsely claim no verdict. PR #1931 now matches each predecessor to its exact verdict ref with production-shaped artifact-only regression coverage.
- Advancing #1933 before #1931: the Cross-PR collision check correctly blocks their shared protected file. Do not bypass it.
- Running from the root checkout: unsafe because it is far behind and dirty with other sessions' files. All useful work used isolated worktrees.
- Assuming an open/mergeable stale PR is ready: false. Base SHA, hosted checks, and reviewer evidence must all match current main immediately before release.

## 5. Root causes and key findings

- The repo's safety model is content- and exact-head-bound. A green old head is not readiness after main moves.
- Reviewer evidence must be durable, provider-independent, exact-head-bound, trusted by author association, and discoverable within a bounded GitHub request budget. PR #1931 is the remaining ready repair that makes terminal verdict artifacts and lease cleanup reliable.
- Cross-PR protected-object collisions are lawful dependencies, not CI noise. #1933 must wait for #1931.
- The production freeze is doing real work: structural #1703 moved main twice during maintenance preparation. Immediate maintenance merges would have invalidated production qualification.
- Queue `fullyAudited:true` means classification metadata is sound; it does not mean the non-orchestrator sweep is complete. #1789 closes only after eligible repo-session work is completed or truthfully excluded/blocked and a fresh audit proves no remaining actionable sweep work.
- Issue #1286 is time-bound monitoring: its owner-defined two-week observation window from 2026-08-19 ends 2026-09-02. Do not claim it complete early.
- Issue #1322 cannot be safely implemented as mere app maintenance on current architecture: the required write needs a structural authorization API. Preserve the licensing guard and route the structural prerequisite rather than bypassing it.

## 6. Exact next steps

1. Start in a fresh isolated session/worktree. Read `AGENTS.md`, `HANDOFF.md`, and this file. Run marker resolve, fetch, verify exact `origin/main`, and rerun queue audit. **Gate:** marker resolves live, audit exits 0/fully audited, and the exact freeze/main state is freshly known.
2. If production freeze remains active, make no merge/main movement. Resume PR #1935's isolated worktree at local head `dcd2112f21a5900f26a1f978d861bc4985c041c3`; verify the worktree/branch identity and that no other session changed it. Run full Node, full Python, Git-Bash SQL/static gates, and diff check. **Gate:** all local suites pass on exact current base with a clean owned diff.
3. Push #1935 only after confirming its base is still current. Wait for every hosted check, including ephemeral DB and collision checks. Then allocate a fresh governed exact-head full-range review; run the shipped authorization verifier. **Gate:** OPEN/MERGEABLE/CLEAN, all required checks green, durable approval, verifier passes, and any active reviewer lease is handled only by normal governed cleanup.
4. Keep #1931 stable and held. On exact `PRODUCTION FREEZE RELEASE`, do not infer a merge release. Ask/await the live orchestrator's specific one-PR quiet release. Immediately before any merge re-resolve marker, exact main/base/head, checks, authorization, and preview/merge/production exclusive refs. **Gate:** every fact remains exact and the named PR alone merges; otherwise stop and report drift.
5. Expected merge order starts with #1931, because it unlocks #1933 and repairs governed verdict cleanup. After its exact merge SHA, rebase/recheck/re-review #1933. Rebase every other held PR one at a time in dependency/age order; never carry old approvals. **Gate:** each PR has current-base evidence and a specific release before main moves.
6. Continue every eligible open repo-maintenance/documentation issue. Exclude structural, curated Master Data, application/source-data, and owner-only routes. Treat blocked issues truthfully; do not close them merely to empty the list. **Gate:** each completed issue has merged evidence and any required direct verification; each excluded/blocked item has a live scope reason.
7. After every main movement rerun marker resolve and queue audit, then re-anchor remaining branches. **Gate:** no stale evidence is presented as ready.
8. Close #1789 only after a fresh audit is fully audited and a separate review of the repo-session list proves the entire eligible sweep completed, with no actionable maintenance/documentation issue merely skipped. **Gate:** issue #1789 closing comment names the merged/verified disposition of the full sweep.

## 7. Constraints and gotchas in force

- Current `PRODUCTION FREEZE` at exact main `fa05c9ee…` is absolute. No docs-only exception and no maintenance merge.
- Main movement is serialized one PR at a time by the live orchestrator. Notify before every intended movement and obey the named sole executor.
- Re-resolve marker #1869 immediately before delegation and immediately before merge; conversation history is not routing proof.
- Never manually edit/delete coordination, reviewer, verdict, claim, ledger, preview, or production refs. Use only governed exact-owner paths.
- Never replay an applied migration, fabricate evidence, increase request budgets, weaken refusal guards, or use an ordinary dry run as historical apply proof.
- Preserve legitimate legacy test setup and unauthorized-by-default guard tests.
- Use isolated branches/worktrees. Do not stage or clean the dirty root checkout or another session's files.
- On Windows use `C:\Program Files\Git\bin\bash.exe` for Git-Bash gates.
- Before committing, `git var GIT_COMMITTER_IDENT` must be `Albert Hazan <u2giants@users.noreply.github.com>`.
- Reviewer evidence is invalid after any head change. Provider terminal failures require governed replacement; findings require repair and a new exact-head review.
- #1789 remains open until the whole sweep is proven complete.

## 8. Access and environment

- Machine: EDGE-DEV (Windows PowerShell), repository `C:\repos\shared-db`.
- GitHub CLI is authenticated for `u2giants/shared-db`; live read-only marker/queue/PR calls succeeded at closeout.
- Secrets, if needed by later production-capable workflows, live in 1Password vault `vibe_coding`; no values belong in chat, files, arguments, logs, or commits.
- Root checkout is intentionally unsafe for implementation because it is behind/dirty. Use existing issue worktrees under `C:\repos\shared-db-worktrees\` only after proving ownership, or create a new isolated worktree from fresh `origin/main`.
- Protected preview and production are owned by the structural orchestrator during the freeze. This maintenance session performed no database writes.

## 9. Open questions and risks

- Main and freeze state can change within minutes. Every SHA and readiness claim in this handoff is a 2026-08-31 11:21 UTC snapshot except the delegated worker's final PR evidence, which was re-read during closeout. Re-derive before acting.
- PR #1935 has an unpushed local commit. It is the highest loss risk: prove its worktree path and clean status before doing anything else; do not recreate it from the stale remote branch.
- PR #1931's Kimi active lease remains present at its exact assignment owner. Normal governed cleanup may release it during the next lawful allocation; manual cleanup is forbidden.
- Existing open PRs can become conflicting after structural merges. Rebase in controlled order and rerun collision checks rather than force-resolving protected overlaps.
- The root contains an earlier untracked handoff `HANDOFF.d/2026-08-31T1051Z-edge-dev-codex-maintenance-sweep-fa05.md` written by the delegated maintenance task. It is uncommitted and must not be silently deleted or treated as canonical. This committed handoff supersedes it operationally, but a successor should inspect ownership before cleanup.
- Owner-only issues listed in §0 remain outside this workstream. Do not let their continued presence prevent completion of eligible maintenance, and do not close them as sweep cleanup.

## Delegated task: `01a05418-0283-7342-b985-6d74ce1ae15f`

- **Asked to do:** continuously execute the non-orchestrator repository-maintenance/documentation sweep on isolated branches, obtain full checks and governed exact-head reviews, and perform only specifically authorized serialized merges.
- **Actually did:** prepared and merged numerous maintenance repairs through orchestrator releases; in the final segment made #1931 current-base ready, identified #1933's lawful dependency, made #1935 ready on an earlier base, and began its new-base rebase at local unpushed head `dcd2112f21a5900f26a1f978d861bc4985c041c3`.
- **Found:** exact-head evidence repeatedly becomes stale after structural movements; #1931 is the dependency for #1933; #1935 is the only item actively mid-renewal at closeout.
- **PR / branch:** PRs and heads are enumerated in §3. The task itself made no post-closeout mutation.
- **Worktree:** live/resumable. Preserve every worktree; the task explicitly stopped after its final snapshot.
- **Deliberately did NOT do, and why:** no merge during production freezes; no manual reviewer-ref cleanup; no guard bypass; no structural/curated/application/owner-only work; no root cleanup because ownership is ambiguous.

## Final self-audit

1. **Yes — a newcomer can continue without chat context.** Sections 1–3 define the repository, goal, exact freeze/main/queue state, and every held PR; §6 gives ordered executable steps and gates.
2. **Yes — the session's non-obvious knowledge is preserved.** Sections 4–5 record failed approaches, review failures, dependency behavior, and the exact reasons old evidence cannot be reused; the delegated-task block preserves worker state.
3. **Yes — execution detail is complete.** Sections 3, 6, 7, 8, and 9 cover SHAs, checks, routes, access, constraints, risks, ownership, merge rules, and verification conditions. No secret value is present.
4. **Yes — the owner-decision sweep passed.** A line-by-line review of §§1–9 and the delegated-task block found only the already-settled sweep/merge/freeze instructions plus the five explicitly owner-only security/settings issues; all appear in §0 with recommendations. No hidden owner judgment remains elsewhere.
