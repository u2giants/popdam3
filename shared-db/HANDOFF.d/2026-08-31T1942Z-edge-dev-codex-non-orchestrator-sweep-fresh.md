---
issue: 1789
status: OPEN
owner: codex/non-orchestrator-sweep-fresh
---

# 0. DECISIONS ONLY THE OWNER CAN MAKE

None. This workstream needs no new owner decision.

Already settled — do not re-ask:

- Repository-maintenance and documentation work is outside the structural orchestrator. Do not absorb structural, curated Master Data, application/source-data, or owner-only work.
- Issue #1703 remains open and its production freeze remains active. Branch-only work and tests may continue, but do not merge or otherwise move `main` until the exact release is recorded.
- Never manually release reviewer assignments, leases, verdict refs, claims, or coordination refs. Use only their governed lifecycle.
- Albert does not need to merge or choose queue order. Resume the lawful maintenance sweep and use live evidence.

# 1. What this application is

`u2giants/shared-db` is the governed source of truth for the company’s shared Supabase structure and for the repository safety tooling that coordinates migrations, reviews, preview, merge, and production promotion. This workstream is the separate non-orchestrator maintenance sweep: it repairs and renews repository tooling and documentation without changing database structure or application rows.

The structural orchestrator is a different live Codex task. Resolve it only with `node scripts/check-orchestrator-marker.mjs --resolve`; never use an old handoff or chat route as authority.

# 2. What we set out to do this session, and why

Resume issue #1789’s sweep after repeated structural promotions moved `main` and invalidated base-bound maintenance evidence. The immediate goals were to explain the real freeze boundary, repair the malformed queue classification on issue #1984, route a newly arrived mixed structural/data request safely, and advance the next maintenance pull request without merging or touching reviewer leases.

The broader goal remains unchanged: renew eligible maintenance/documentation PRs one at a time from live `main`, prove each exact head, obtain governed review only when the head is stable, and hold it for lawful serialized merge after the freeze releases.

# 3. Current state — what is true right now

Live facts at 2026-08-31 19:42Z (all must be re-derived on entry):

- `origin/main` was `68080423297efdbf6770ac8bc55a1ebdb4264b25`, merge of structural PR #2003 for #1703 forward #5.
- Open marker #2000 declared Codex route `01a058e1-1004-79b1-a31d-9705c5c38fab`. This session successfully sent it a message and received a substantive reply, despite an older marker comment saying another sender got “Session not found.” Re-resolve and confirm delivery every time.
- #1703 remains OPEN. Its 2026-08-31 18:44Z production acceptance says forward #5 applied and correctness passed, but response times remained above the acceptance target; it explicitly says the production freeze remains active.
- The root checkout `C:\repos\shared-db` is heavily dirty/untracked and 235+ commits behind its remote tracking state. Do not update, clean, stage, or use it for branch work.
- This handoff lives in isolated worktree `C:\repos\shared-db-worktrees\handoff-1789-fresh-20260831`, branch `codex/handoff-1789-fresh-20260831`, based on `68080423`.

Completed coordination work:

- Issue #1984’s malformed documentation scope was repaired. Its `db-work-scope` now has `work_type: documentation`, `route: repo-maintenance`, and empty database `writes`/`reads`. Queue audit classifies it correctly outside orchestrator work.
- Repair handover #1996 was commented with proof and closed.
- Newly opened #2007 mixed two structural RPCs with a private licensed-source row load. The live orchestrator acknowledged the message, created structural shared-db #2008 with dependency on #1999, guarded-forwarded the row load to private `u2giants/licensor-source-data` #61, and closed #2007. No licensed rows were copied.

PR #1935 / issue #1690 (`Centralize pending migration classification`):

- Remote PR remains OPEN at old head `dcd2112f21a5900f26a1f978d861bc4985c041c3`, old base `fa05c9ee67217f5914276c81691a0ec8f7f78808`, OPEN/MERGEABLE/CLEAN. All its hosted checks and prior reviews are stale because `main` moved.
- Isolated worktree: `C:\repos\shared-db-worktrees\issue-1690-pending-classifier`.
- Local branch was cleanly rebased onto then-current `8af57f76f1c5827902dd894bfc777d6c6434d87c`; local head became `8dca618c22681186e6d1985ecda6106c284dce4b`.
- That rebased head was deliberately NOT pushed because `main` moved first to `38592f0d...` and then `68080423...` while tests ran. It is stale again.
- Verification on local `8dca618c`: focused Node 25/25; focused production guard Python 225/225; full Python discovery 832 passed with 8 expected skips; SQL static check passed; diff check passed. Full Node ran successfully through its large suite; preserve the terminal evidence locally, but all evidence is base-stale and cannot authorize review or merge.
- The worktree contains pre-existing untracked `.ai/` reviewer evidence. Preserve it; never stage it wholesale.

PR #1990 / issue #1997 (`Prioritize orchestrator work by blocker impact and age`):

- Worktree `C:\repos\shared-db-priority`, head `4e141a792b8eb2f5875bccf7930ce17f71072bf7`, old base `3037bf6f...`.
- It is correctly BLOCKED by Cross-PR Object Collision because earlier open PRs #1931, #1933, and #1948 also edit `scripts/manage-migration-author-lanes.mjs`. Do not weaken or bypass the guard. #1990 waits until those earlier protected-source PRs are merged or otherwise lawfully resolved, then it must be rebased and rerun.

Other dependency facts carried forward from the prior sweep:

- PR #1931 / issue #1824 is an earlier maintenance prerequisite with approved old-base evidence; every review is stale after main movement.
- PR #1933 / issue #1867 collides with and waits behind #1931.
- PR #1946 / issue #1689 is another independent maintenance PR but its base and reviews are stale.
- PR #1948 / issue #1688 edits the same protected lane manager as #1990 and precedes it.
- PR #1989 / issue #1987 is structural DesignFlow work; it belongs to the orchestrator and must not be absorbed by this session.
- Issue #1789 remains OPEN. Do not close it until a final fresh queue audit reconciles every eligible maintenance/documentation issue and all exclusions.

# 4. Everything we tried that did NOT work

- Treating the old handoff’s `fa05c9ee...` base as current was invalid: structural forward PRs moved `main` repeatedly. Live GitHub always supersedes handoff SHAs.
- A first PowerShell regex edit of #1984 used dot-all greedily and temporarily removed more of the issue body than intended, making it unclassified rather than malformed. The full original text was immediately restored with a checked file and a valid empty object scope; the fresh audit then classified it correctly. Do not use a greedy multiline replacement on fenced issue metadata.
- Running each `scripts/test_*.py` directly produced one false failure: `test_check_production_verification_sidecars.py` expects package discovery and failed with `ModuleNotFoundError: scripts`. The correct full gate is `python -m unittest discover -s scripts -p "test_*.py"`; it passed 832 with 8 expected skips. Do not install pytest.
- Renewing #1935 against `8af57f76...` completed technically, but `main` moved during testing. Pushing would have published immediately stale evidence, so it was correctly withheld.
- PR #1990’s collision failure is not a code defect in #1990. The hosted log names #1931, #1933, and #1948 as earlier contenders for the protected lane-manager source. Rebasing alone cannot lawfully clear it while those PRs remain open.
- The marker resolver proves only the declared route. One earlier sender recorded “Session not found,” while this session later reached the same route and got a detailed reply. Delivery must be confirmed, never inferred.

# 5. Root causes and key findings

- Exact-head evidence is bound to both branch bytes and the current base. Every `main` movement invalidates reviews and checks for merge authorization, even when GitHub still displays them green.
- The #1703 freeze blocks unrelated `main` movement and merges, not isolated implementation, tests, issue classification, or branch preparation. Useful work can continue, but expensive review should wait until the base is likely stable.
- Queue-audit completeness and maintenance execution are separate. A malformed/unclassified issue prevents `fullyAudited`, but it does not prohibit unrelated maintenance branch work.
- Protected-source collision is intentional serialization. The remedy is to finish earlier contenders in order, not change the guard or split equivalent edits to evade it.
- Mixed work must be split by ownership: structural RPC definitions stayed in shared-db #2008; private licensed-source row loading went to licensor-source-data #61.

# 6. Exact next steps

1. In a fresh session, read `AGENTS.md` and this file completely. Run marker resolve, `git fetch origin --prune`, record exact `origin/main`, inspect #1703’s latest comment for the freeze, and run `node scripts/manage-migration-author-lanes.mjs --queue-audit`. You’ll know it worked when the marker, main SHA, freeze state, malformed/unclassified lists, and maintenance exclusions are all current and explicit.
2. Reconcile the live open-PR list before choosing work. Treat PR #1935, #1931, #1933, #1946, #1948, #1990, and any newer maintenance PR as candidates, not as automatically valid. You’ll know it worked when each has a current base/head, collision state, and dependency classification.
3. If `main` is still actively moving for #1703, prioritize independent issue repairs, tests, or implementation that do not require final exact-base review. Avoid repeated review churn. You’ll know it worked when useful branch/issue work advances without a merge or reviewer assignment.
4. When `main` is stable enough, resume PR #1935 in `C:\repos\shared-db-worktrees\issue-1690-pending-classifier`. Verify remote head is still `dcd2112f...`, preserve untracked `.ai/`, rebase the local three-commit change onto exact current `origin/main`, and record the new head. You’ll know it worked when the branch is clean except preserved `.ai/`, contains current main, and no unexpected remote head was overwritten.
5. Run `node --test scripts/*.test.mjs`, `python -m unittest discover -s scripts -p "test_*.py"`, `C:\Program Files\Git\bin\bash.exe scripts/check-sql.sh`, and `git diff --check origin/main...HEAD`. You’ll know it worked when Node is fully green, Python reports its expected skips only, SQL static checks pass, and diff check is silent.
6. Re-fetch immediately. If `origin/main` changed during tests, do not push or commission review; return to step 4 later. If unchanged, push with `--force-with-lease=refs/heads/codex/issue-1690-pending-classifier:dcd2112f21a5900f26a1f978d861bc4985c041c3` (or the newly re-read exact remote head). You’ll know it worked when GitHub’s head equals local HEAD and the lease did not overwrite an unexpected commit.
7. Wait for every hosted check, including ephemeral database and collision. Only after a stable exact head is green, read reviewer capacity and use the governed allocator/wrapper. Never manually release a lease. You’ll know it worked when the durable exact-head verdict exists and the shipped verifier reports the required approval and pinned assignment.
8. Hold the renewed PR while the freeze is active. After an explicit release, re-derive all gates and follow the one-PR serialized merge protocol. You’ll know it worked when the merge commit is on `main` and no unrelated main movement occurred during its protected window.
9. Then process dependencies in lawful order: #1931 before #1933; #1948 before #1990 where their protected-source ordering requires it; renew independent PRs only from live main. You’ll know it worked when collision checks clear without weakening and each PR has fresh exact-head evidence.
10. At the end of every completed maintenance item, re-read every downstream step here and the remaining queue through plan-end. Report any assumption drift caused by what was changed or learned before continuing. This reciprocal check is mandatory; it prevents a completed phase from silently invalidating later phases.
11. Keep #1789 open until a final live audit proves the entire eligible maintenance/documentation sweep is reconciled. You’ll know it worked when `fullyAudited` is true, all eligible issues are finished or truthfully blocked, every exclusion has the correct owner/route, and no stale handoff obligation remains uncaptured.

# 7. Constraints and gotchas in force

- Do not merge, move `main`, run preview/production, or manually release reviewer leases while the #1703 freeze remains active.
- Re-resolve the marker before every coordination message; confirm an actual reply.
- Work only in isolated worktrees. The root checkout is shared, dirty, and stale.
- Before any commit, run `git var GIT_COMMITTER_IDENT`; it must be `Albert Hazan <u2giants@users.noreply.github.com>`.
- Use exact old-head force leases. Never use an unqualified force push.
- Stage only owned files. Preserve all untracked `.ai` evidence and other sessions’ changes.
- On Windows use `C:\Program Files\Git\bin\bash.exe`, not bare `bash`.
- Never install pytest merely because direct invocation failed; use unittest discovery.
- Structural issues, curated Master Data, application/source data, and owner-only security settings are excluded from this maintenance session.
- Never interpret a green old check or old reviewer comment as current authorization.

# 8. Access and environment

- Machine: EDGE-DEV, Windows PowerShell.
- GitHub CLI is authenticated for `u2giants/shared-db`.
- Codex task messaging successfully reached the marker-declared route during this session.
- Reviewer wrappers and governed allocator were previously available, but must be rechecked before use.
- Secrets live in 1Password vault `vibe_coding`; no secret is needed for branch-only tests and none is recorded here.
- No database access, preview mutation, production mutation, or licensed row inspection is authorized by this handoff.

# 9. Open questions and risks

- #1703 forward #5 still missed the performance acceptance target even though correctness passed. Further structural forward work may keep moving `main`; this is the main source of maintenance rebase churn.
- Marker route availability has produced contradictory observations. Treat every message as undelivered until a reply arrives.
- A new unclassified issue can appear between audits, as #2007 did. Always rerun the full queue audit immediately before claiming completeness.
- PR #1935’s local `8dca618c...` head is useful only as a conflict-resolution checkpoint; it is not current evidence and must not be pushed without another live-base reconciliation.
- PR #1990 cannot advance through its collision gate until earlier protected-source contenders are resolved. Do not misreport that as a defect in its blocker-impact implementation.

## Self-audit

1. Yes. Sections 1–9 define the repository, purpose, exact live state, worktrees, SHAs, failures, and executable continuation for a newcomer.
2. Yes. Sections 3–6 preserve all material knowledge from this session, including #1984/#1996, the #2007 split, #1935’s unpushed stale rebase, and #1990’s exact collision chain.
3. Yes. Background, goals, outcomes, verification, constraints, environment, risks, and every remaining phase through final #1789 audit are explicit; every next step has a success gate.
4. Yes. A line-by-line owner-decision sweep found no new owner choice. Section 0 explicitly records none and lists settled decisions that must not be re-asked.
