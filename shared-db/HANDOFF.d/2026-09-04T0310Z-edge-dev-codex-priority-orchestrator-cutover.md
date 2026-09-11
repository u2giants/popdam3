---
issue: 2267
status: OPEN
owner: codex/orchestrator-2249-handoff
---

# Orchestrator #2249 cutover — priority structural queue

Moving facts in this document were re-derived from GitHub and Git at **2026-09-04T03:09–03:10Z**. Recheck them before acting.

## 0. ⚠️ DECISIONS ONLY THE OWNER CAN MAKE

None — nothing in this workstream currently needs Albert. The successor must not ask Albert to choose reviewers, merge PRs, or override safety gates.

Already settled — do not re-ask:

- Albert's priority set is #2136, #2126, #2054, #1966, #2212, #2202, #2203, #2204, #2169. Live classification: #2136, #2126, #2054 and #2169 are closed; #2169 was repository maintenance and never orchestrator work; #1966 is structural but intentionally frozen until **2026-09-17**; #2202 is the first active priority because it unlocks #2203 and #2204; #2212 is ready but shares lane 3 objects with #2159.
- Maximize safe parallel work. The repository supports eight author lanes, while this Codex runtime exposed four collaboration slots including the coordinator. Fill every genuinely free lane/worker immediately, but never create an object collision or bypass a dependency/reviewer/preview gate.

## 1. What this application is

`u2giants/shared-db` is the governed source of truth for the structure of POP Creations' shared Supabase database. One orchestrator owns the live queue and dispatches migrations to isolated worktrees. It serializes preview, merge, and production while permitting up to eight non-overlapping authors.

Local canonical checkout: `C:\repos\shared-db`. This handoff was authored in isolated worktree `C:\repos\shared-db-worktrees\orchestrator-2249-handoff`, branch `codex/orchestrator-2249-handoff`.

## 2. What this session set out to do, and why

The owner asked this session to pull current repository truth, open the single orchestrator, prioritize issues that unblock the most downstream work, then elevate #2136, #2126, #2054, #1966, #2212, #2202, #2203, #2204 and #2169. The session was also told to parallelize as much as safely possible.

The working objective became: finish #2202 first because it unlocks #2203/#2204; clear lane 3's existing #2159 work so #2212 can start; preserve #1966's observation freeze; exclude closed and non-orchestrator issues.

## 3. Current state — what is true right now

### Coordinator and repository

- Current orchestrator marker is issue **#2249**, route id `01a069d8-3c1a-7d03-bc9f-fd0e1c0577a2`, session `shared-db.orch EDGE-DEV priority queue`. It must be closed only after the successor handshake.
- `origin/main` at 2026-09-04T03:10Z: `46f281ace3c0c38e89f3746f45cc34f109fa6eeb`.
- Highest migration filename on that main: `20260903200951_coldlion_division_reference_table.sql`.
- Queue audit at 03:09Z: **8/8 author lanes occupied**, no dispatchable empty lane, and four expired-but-still-protected claims (#2195, #2184, #2182, #2198). Expiry releases neither protection nor capacity.
- The shared checkout is behind `origin/main` and contains two untracked handoff files owned by other sessions. Preserve them: `HANDOFF.d/2026-08-30T1915Z-edge-dev-codex-non-orchestrator-sweep-continuation.md` and `HANDOFF.d/2026-08-31T1051Z-edge-dev-codex-maintenance-sweep-fa05.md`.

### Priority issue #2202 — active, first

- Issue #2202 is structural and active under claim **#2257**, lane 1.
- PR **#2259**, branch `codex/issue-2202-canonical-workflow`, worktree `C:\repos\shared-db-worktrees\issue-2202-canonical-workflow`.
- Exact head at 03:09Z: `53c380f17fe12317c6169ebbbd6ed7438e4040b6`; base/current main `46f281ace3c0c38e89f3746f45cc34f109fa6eeb`.
- All current-head GitHub checks passed, including ephemeral database; local SQL guards passed. Worktree was reported clean.
- It implements the canonical DesignFlow workflow/notification contract while preserving legacy rows. It adds canonical workflow action and assignment structures plus atomic notification linkage/idempotency.
- Missing gate: independent exact-head approval. At 03:09Z Grok was reviewing #2159, GLM #2207, Muse #2172; Codex was correctly excluded from reviewing a Codex-orchestrated change. Earlier Grok reviews of #2202 hit their turn limit and were durably released with terminal evidence.
- No preview, merge, or production action occurred.

### Lane-3 blocker before priority #2212

- #2212 is valid, ready structural work, but queue grouping places it behind active claim **#2226** because both touch `public.style_guide_crawl_runs` and related PopSG objects.
- Claim #2226 belongs to issue **#2159**, PR **#2228**, branch `claude/issue-2159-warner-empty-namespace`, worktree `C:\repos\shared-db\.claude\worktrees\issue-2159-warner`.
- Current PR head at 03:09Z: `7898c909c4790dba716f8817f64df96f720166db`; base main `46f281ace3c0c38e89f3746f45cc34f109fa6eeb`.
- Most checks had passed; the ephemeral database check was still running. Governed Grok review sequence **1245** was live with no verdict.
- An earlier exact-head approval became stale when main advanced. A guarded merge run correctly refused the stale base; the branch was updated and must receive fresh exact-head evidence.
- No preview, merge, or production action occurred.

### #2212 prepared next

- #2212 has no GitHub dependency and is ready as soon as lane 3 is legitimately released.
- Correct an issue-body naming error before claim expansion: the existing aggregate function is `public.refresh_style_guide_matviews()`, not `public.refresh_style_guide_aggregates()`.
- Preserve legacy compatibility and rows; no bulk backfill/full rebuild in the migration. Replace the stale-file/PDF/search contracts with bounded, resumable, least-privilege behavior. The legacy `public.deactivate_stale_sg_files(text,uuid)` is SECURITY DEFINER and executable by `authenticated`; replacement must revoke that access and be service-role-only.

### #2203 and #2204 after #2202

- Both are structural but currently `status: blocked` on #2202.
- They can be authored concurrently from the same fresh post-#2202 main because their write scopes are disjoint.
- #2204 writes only `app.user_notification` timestamp/index/constraint objects and reads workflow structures. Merge #2204 first.
- #2203 writes only `dflow.item_workflow_action` plus `dflow.record_item_workflow_action` and reads notification structures. After #2204 merges, refresh and retest #2203 against final notification schema before its review/merge.

### Other requested priorities

- #1966 remains blocked until its planned 2026-09-17 observation reading. Do not drop indexes before then.
- #2136, #2126, #2054 are closed. #2169 is closed and was repository maintenance, so it was never an orchestrator assignment.

### #2173 work advanced incidentally to release reviewer capacity

- Issue #2173, PR **#2186**, branch `claude/2173-coldlion-sales-history`, worktree `C:\repos\shared-db\.claude\worktrees\coldlion-2173-hist`.
- Head `9f5a64251bf3d10c625a17c4aa8b5b4a6bf5ce52`; base is stale (`da927063...`), so update from current main before any merge.
- All CI passed at that head and a governed GLM exact-head APPROVE was durably recorded. That approval will become stale after updating from main.
- No preview, merge, production, or claim release occurred.

### Preview and production

- This session applied **nothing** to protected preview and wrote **no preview data rows**.
- This session applied **nothing** to production.
- Shared preview was not asserted clean. Before any preview, resolve the successor marker, run `--prepare-preview-dispatch <issue>`, rerun the fresh selector/ledger check, and follow only its stored instruction.

## 4. Everything tried that did NOT work

1. Direct reviewer wrappers were initially used for #2173/#2202. They produced useful findings but not durable governed verdicts. Only `scripts/run-governed-review.mjs` satisfies the assignment/verdict lifecycle; do not repeat direct-wrapper reviews.
2. Grok reviewed #2202 twice and reached its turn limit without a verdict. Each failure was recorded and released through the governed terminal-failure path. Re-running unchanged Grok wastes capacity; draw the next eligible reviewer through the durable rotation.
3. `--replace-failed-reviewer` for #2202 repeatedly refused while the originally failed Grok reviewer held an unrelated newer lease. This is the repository-maintenance defect described by issue #2106; do not hand-edit refs or bypass it. Wait for the conflicting lease to release, then retry under the mutex.
4. An attempt to prepare preview for #2159 initially omitted `ORCHESTRATOR_ROUTE_ID` and correctly refused the marker check. The coordinator command must export its own resolved route id.
5. Guarded merge run `33829979983` for PR #2228 refused because `main` had advanced with non-document changes. This was correct. Update the branch, rerun exact-head tests and review, then dispatch again.
6. The main checkout was dirty/stale and therefore was not pulled in place. A clean detached coordinator worktree was created at `C:\repos\shared-db-orch-01a069d8`; preserve the user's untracked files in the main checkout.
7. #2231 was dispatched, but its requested duplicate-resolution change contradicted current canonical `plm.source_resolution`. The claim was safely released and the issue closed with no migration rather than adding conflicting structure.
8. The coordinator initially failed to saturate parallel capacity. The orchestrator skill already says to refill every free lane in the same turn; the successor must audit first and immediately use `min(free safe work, available runtime workers)` while distinguishing eight author lanes from four Codex collaboration slots.

## 5. Root causes and key findings

- #2202 is the best first priority because it unlocks two requested successors (#2203/#2204). #2212 is separately ready but blocked by object overlap, not by a logical dependency.
- Reviewer availability, not failed CI, is the active #2202 bottleneck. All three eligible external reviewers were live-held at the last reading; Codex cannot independently review work orchestrated by Codex.
- Main moves frequently. A green suite and approval become stale for guarded merge when non-document changes land on main. Always refresh before spending another reviewer draw.
- #2203 and #2204 have no write/write overlap after #2202. They should consume separate author lanes concurrently, but preview/merge remain serialized; #2204 merges first.
- Queue reports must distinguish durable marked-busy capacity from an actually running worker. An expired claim with an open PR remains protected and is not a free lane.

## 6. Exact next steps

1. Open the successor marker with its own new route id immediately after #2249 closes, then run `node scripts/check-orchestrator-marker.mjs --resolve`. Success means exactly one live marker prints the successor's route id.
2. Fetch live `main`, run `--audit`, `--queue-audit`, and `--reviewer-capacity`; do not trust the 03:09Z snapshots. Success means every lane, reviewer, PR head and dependency has a current classification.
3. Resume #2202/PR #2259 first. If main moved, update the branch and let CI finish before reviewer assignment. Draw/run only the governed assigned reviewer. Success means a durable APPROVE exists for the exact current head and every required check is green.
4. In parallel, resume #2159/PR #2228. Finish its current exact-head reviewer/checks, then use the guarded preview/merge path and release claim #2226 only after completion evidence. Success means #2159 is completed, #2228 merged, and lane 3 is reported free/reassignable.
5. Claim and dispatch #2212 immediately into lane 3 using the prepared constraints in §3. Success means an isolated worktree, reserved version, exact expanded object scope, active worker and no collision.
6. Drive #2202 through preview and guarded merge, release claim #2257, and record completion. Success means #2202 is closed with completion evidence and queue audit no longer reports #2203/#2204 blocked on it.
7. Change only #2203/#2204 status/dependency truth that live completion justifies, then claim separate lanes and dispatch both concurrently. Merge #2204 first; refresh/retest #2203, then merge it. Success means both exact scopes remain disjoint and each has its own current-head evidence.
8. Leave #1966 blocked until 2026-09-17. Success means no premature index decision or mutation.
9. At the end of each phase, re-read **all downstream steps through plan-end** (#2212, #2202, #2204, #2203, #1966) and report any assumption, object name, dependency or merge-order drift. Carry corrections into the issue/next handoff before cutting over again.

## 7. Constraints and gotchas in force

- Coordinate only; implementations run in isolated worktrees.
- Eight author lanes are independent from this runtime's four collaboration slots. Fill all safe available capacity immediately, but never invent work merely to show activity.
- Exact object claims, unique reserved migration versions, and current live marker are mandatory.
- Preview, merge and production are single-file lanes. Production remains a separate governed action; never infer production authorization from this handoff.
- Do not edit an already previewed/applied migration version. Use governed supersession/new forward migration.
- Do not clean the shared checkout or other sessions' worktrees. The two untracked handoff files named in §3 are not ours.
- Do not route repository maintenance such as #2106 to the orchestrator.
- Do not weaken reviewer guards, fabricate verdicts, hand-delete refs, or substitute direct wrapper output for a governed verdict.
- Before the first commit, committer identity was verified as `Albert Hazan <u2giants@users.noreply.github.com>`.

## 8. Access and environment

- Machine: EDGE-DEV; shell: PowerShell; repository: `C:\repos\shared-db`.
- GitHub CLI is authenticated for `u2giants/shared-db`.
- No database credentials or secrets were needed or exposed in this session.
- Secrets sweep: checked session commands, clean handoff worktree, diff, and known untracked files; **nothing new to store**. Existing secrets remain in 1Password vault `vibe_coding`; values are never copied into handoffs.
- Docs pass: nothing outside this handoff became false. The orchestrator skill already required immediate lane refill; the earlier under-parallelization was execution error, not missing policy.

## 9. Open questions and risks

- No owner question is open.
- Every SHA, reviewer lease, lane count and check state is moving and must be re-read.
- #2202 can remain starved while all eligible reviewers are occupied. Wait boundedly and retry the governed assignment; do not bypass.
- #2159 may finish while the cutover is in progress. Re-read PR #2228 before repeating any check or review.
- Queue audit remains `fullyAudited: false` because several open issues are unclassified. Do not treat that as permission to ignore them; classify them from their own requested work as capacity permits.

## Part B — dispatched sub-agents

### Agent: issue_2231_wb_resolution / `C:\repos\shared-db-worktrees\issue-2231-wb-resolution`
- **Asked to do:** implement Warner resolution storage requested by #2231.
- **Actually did:** audited current schema and found the request conflicted with canonical `plm.source_resolution`; wrote no migration. Claim #2250 was released and #2231 closed.
- **Found:** landing-table resolution fields are deprecated; canonical source values support `warner:<namespace>`.
- **PR / branch:** no PR; abandoned safely.
- **Worktree:** finished; do not remove during live orchestrator cleanup without the cleanup skill.
- **Deliberately did NOT do, and why:** did not duplicate resolution fields because that would contradict current canonical design.

### Agent: issue_2173_refresh / `C:\repos\shared-db\.claude\worktrees\coldlion-2173-hist`
- **Asked to do:** complete #2173 sales-history/page-ledger integrity work.
- **Actually did:** produced PR #2186 at `9f5a642...`, passed CI, and incorporated reviewer repairs for immutable page evidence, reparent locking, parent scope freeze, indexes and regression tests.
- **Found:** reparent operations required locking/checking both source and destination parents.
- **PR / branch:** #2186 / `claude/2173-coldlion-sales-history`, open.
- **Worktree:** live/resumable.
- **Deliberately did NOT do, and why:** no preview/merge/production; current main advanced and evidence must be refreshed.

### Agent: issue_2202_canonical_workflow / `C:\repos\shared-db-worktrees\issue-2202-canonical-workflow`
- **Asked to do:** implement canonical workflow/action/notification structure for #2202.
- **Actually did:** opened PR #2259; expanded claim #2257; current head `53c380f...`; all CI and local SQL guards green.
- **Found:** `app.user_notification` exists in live/generated contract but not migration history, requiring replay-safe legacy-compatible creation; legacy rows must be preserved.
- **PR / branch:** #2259 / `codex/issue-2202-canonical-workflow`, open.
- **Worktree:** live/resumable and last reported clean.
- **Deliberately did NOT do, and why:** no preview/merge/production because exact-head independent review is still missing.

### Agent: close_2173
- **Asked to do:** obtain #2173's governed exact-head review and analyze #2203/#2204 concurrency.
- **Actually did:** recorded durable GLM APPROVE for `9f5a642...`; proved #2203/#2204 write scopes can be disjoint; produced implementation briefs.
- **Found:** merge #2204 first, then refresh/retest #2203 against final notification schema.
- **PR / branch:** no owned PR.
- **Worktree:** finished.
- **Deliberately did NOT do, and why:** no preview/merge; delegated authority was review/preparation only.

### Agent: advance_2202 / resume_2202
- **Asked to do:** advance #2202 through current-head CI and governed review.
- **Actually did:** repeatedly refreshed onto moving main, verified green CI, recorded/released terminal Grok failures, and left PR #2259 current at `53c380f...`.
- **Found:** replacement starvation defect #2106 can block a free reviewer draw while the failed reviewer holds unrelated work.
- **PR / branch:** worked on #2259; no separate branch.
- **Worktree:** same live #2202 worktree.
- **Deliberately did NOT do, and why:** did not bypass refs/guards or preview/merge without a durable approval.

### Agent: audit_priority_lanes / resume_2159
- **Asked to do:** audit priority eligibility, repair the older lane-3 PR, and free the path for #2212.
- **Actually did:** identified #2159/PR #2228 as the real lane occupant, repaired its migration-version/check state, updated it through moving main, and restarted current-head governed review/checks.
- **Found:** #2212 cannot claim until #2226 releases; #2203/#2204 cannot start until #2202 completes.
- **PR / branch:** #2228 / `claude/issue-2159-warner-empty-namespace`, open at `7898c909...`.
- **Worktree:** live/resumable.
- **Deliberately did NOT do, and why:** no preview/merge because the current-head review/check cycle was still active.

### Agent: prepare_2212
- **Asked to do:** prepare #2212 without mutating the queue.
- **Actually did:** corrected the aggregate function name, identified privilege risk, and produced the bounded crawl/PDF/search implementation brief and test requirements.
- **Found:** legacy `deactivate_stale_sg_files` privilege must be reduced; no bulk rebuild/backfill belongs in migration.
- **PR / branch:** none.
- **Worktree:** finished.
- **Deliberately did NOT do, and why:** did not claim or edit because lane 3 remained protected.

### Agent: live_priority_audit
- **Asked to do:** reclassify the owner's priority list and measure real capacity.
- **Actually did:** confirmed eight occupied author lanes, four runtime collaboration slots, and the classifications recorded in §§0 and 3.
- **Found:** no safe fifth runtime worker or empty author lane existed at the audit time.
- **PR / branch:** none.
- **Worktree:** finished.
- **Deliberately did NOT do, and why:** read-only audit only.

## Fresh-developer self-audit

1. **Yes, a newcomer can continue without asking a question.** §§1–3 define the system and exact live work; §6 gives ordered commands/outcomes; Part B accounts for every dispatched agent.
2. **Yes, the newcomer has this session's useful knowledge.** §§4–5 preserve failed approaches and non-obvious findings; §§7–9 preserve constraints, environment and moving risks.
3. **Yes, every execution dimension is covered.** Background/goals (§§1–2), state/evidence (§3), failures (§4), findings (§5), next actions and verification (§6), constraints (§7), access/secrets/docs (§8), risks (§9), per-agent state (Part B).
4. **Yes, section 0 contains every owner decision.** A line-by-line sweep of §§1–9 and Part B found no unresolved owner judgement; settled priority/concurrency rulings are consolidated in §0 and explicitly marked not to re-ask.

