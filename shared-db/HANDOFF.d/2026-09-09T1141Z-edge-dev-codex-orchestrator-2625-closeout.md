---
issue: 2580
status: OPEN
owner: shared-db.orch EDGE-DEV 2403-first
---

# Orchestrator marker #2625 closeout and live #2580 transfer

## 0. Decisions only the owner can make

None. Nothing in this handoff requires an owner decision. The successor should not re-ask the settled decision that Sample Tracking customer shipment is a separate shipping action/path while the sample retains its original Flow 1-4 identity.

## 1. What this application is

`u2giants/shared-db` is the governed source of shared database structure used by the company's applications. Issue #2580 supplies the durable email-outbox structure needed by the DesignFlow Sample Tracking application to record an NY office shipment to a customer and automatically notify named Sales and Design recipients.

## 2. What this session set out to do, and why

This session held orchestrator marker #2625 for an hourly check on issue #2580. A separately started successor was explicitly requested with PR #2425 as first priority. The closeout goal is therefore to stop dispatching, preserve every live claim and unfinished mutation, publish exact continuation state, and close only marker #2625 after the successor confirms it can open its own marker immediately.

## 3. Current state - verified 2026-09-09T11:41Z

- `origin/main` was `9c0af7669d3672438856845b6c73661fcafd21a1`. The maximum migration filename on that tip was `20260909005945_chain_style_group_counts_to_rebuild_completion.sql`.
- Marker #2625 was the sole open orchestrator marker and resolved to the outgoing route `01a0817b-a071-75d2-90b1-6fa74b295f09`.
- The incoming session confirmed readiness to claim immediately: session `shared-db.orch EDGE-DEV 2403-first`, route `01a085f2-a84f-7963-b474-e5770b149ecd`. It explicitly accepted preservation of claim #2626 and PR #2627 without another assignment.
- The author-lane audit reported 6/8 active author leases, 6 protected claims, no relinquished claims, and four expired leases that remain locked. Open claims are #2418, #2524, #2525, #2574, #2578, and #2626. None was changed during this closeout.
- Issue #2580 is open. Its protected claim is #2626, version `20260909084253`, branch `codex/issue-2580-sample-shipment-notice`, worktree `C:/repos/shared-db-worktrees/issue-2580-sample-shipment-notice`.
- That worktree was clean at head `a3edf6104cf239483037931f692334e2028f00db`. PR #2627 is open and mergeable. It contains the migration, its verification sidecar, and the agent contract artifacts.
- PR #2627 has all reported checks green except `SQL migration guards`. The failure is exact: `scripts/production-verification-sidecars/20260909084253.json` exists but is absent from the individually pinned producer set. Preview, production dry-run, preview apply, merge, and production apply have not run for this migration.
- `refs/db-coordination/preview`, `refs/db-coordination/merge`, and `refs/db-coordination/mutex` were absent when checked. No preview or merge lease was held by this session.
- Preview was not mutated by this session. It must not be described as clean: the repository carries many durable preview-ready records from other workstreams, and this closeout did not perform a live database-ledger census.
- The shared checkout has unrelated user/session files and was left untouched. This closeout uses `C:/repos/shared-db-worktrees/orchestrator-2625-closeout` from current `origin/main`.

## 4. Everything tried that did not work

- The first queue audit exceeded the bounded command wait and returned no usable report. It was not rerun unchanged. Open `db-work` issues and all six open `db-claim` issues were instead read directly from GitHub, while the lane audit supplied the authoritative capacity summary.
- A broad remote-ref query for `refs/db-preview-*` produced historical ready/outcome records rather than active lock state. The active lease check was corrected to the exact coordination refs: `refs/db-coordination/preview`, `refs/db-coordination/merge`, and `refs/db-coordination/mutex`; all were absent.
- PR #2627's existing CI attempt cannot advance because the new verification sidecar was not added to the pinned producer list. Re-running the unchanged commit would repeat the deterministic failure.

## 5. Root causes and key findings

- This route became the marker target even though its business purpose was monitoring Flow 5 completion. Closing the marker is necessary so future structural requests stop resolving to the wrong task.
- Claim #2626 is healthy protected work, not abandoned work. Its migration and sidecar are committed, its worktree is clean, and its PR is open; the claim must stay open until the PR lands or is explicitly abandoned.
- The blocker is a repository contract update associated with the new sidecar, not a SQL or ephemeral-database failure. The database contract suite passed and the pull request is mergeable.
- There are no live collaboration sub-agents owned by this session. No new work was dispatched during closeout.

## 6. Exact next steps

1. Open a new orchestrator marker for `shared-db.orch EDGE-DEV 2403-first` using route `01a085f2-a84f-7963-b474-e5770b149ecd`, naming marker #2625 as the handover issue. Verification: `node scripts/check-orchestrator-marker.mjs --resolve` returns exactly that new route and no unsafe-marker warning.
2. Take PR #2425 first as explicitly requested, while preserving every listed open claim. Verification: no second agent or claim is assigned to issue #2580 or PR #2627.
3. Resume the existing #2580 author through claim #2626, not a replacement worktree. Add `20260909084253`'s sidecar to the required pinned producer list and run the relevant local guard before pushing. Verification: the exact failing producer-set test passes and PR #2627 reports a new exact head.
4. Complete the governed #2580 path: required checks, exact-head reviews, guarded merge, merged-main preview rehearsal, production promotion in an authorized window, and post-apply catalog/behavior verification. Verification: issue #2580 and claim #2626 close only with merged PR and successful preview/production evidence linked.
5. Notify the waiting DesignFlow application task after production verification so it can push its prepared application branches, open the DesignFlow PRs, deploy, and perform authenticated live Sample Tracking verification. Verification: a real customer-shipment notice shows tracked samples, recipient snapshots, carrier/tracking data, delivery outcome, and retry behavior.
6. Delete this handoff file in the same finishing change when issue #2580 is genuinely complete and all obligations above are carried forward. Verification: issue #2580 is closed with evidence and this file is absent from the finishing pull request's resulting tree.

## 7. Constraints and gotchas in force

- One orchestrator marker only. Route from the live marker, never this handoff or conversation history.
- Do not close or release claim #2626 because its lease time passes; expiry never releases protected objects or the reserved version.
- Do not create another migration version or another worktree for #2580. Continue the committed branch and exact reserved version.
- Preview, merge, and production operations remain serialized. Prove the connection target immediately before any database mutation.
- Do not re-run the unchanged failing CI attempt. Correct the producer pin first.
- Do not edit already-applied migrations, reuse a migration timestamp, bypass review, or self-approve exact-head evidence.
- All local worktrees not named as owned here were preserved. In particular, the `.claude/worktrees` entries `cleanup-worktree-f356f1`, `closeout-20260909`, `disney-creative-unmapped-titles-7b4149`, `exciting-hawking-a3ff11`, `fix-pr2447`, `fix-pr2584`, `github-issues-albert-0d573b`, `issue-2449-single-resolution-ledger`, `lane-main`, `recursing-poincare-85d3a9`, `review-2425`, `review-2447`, and `shared-db-orchestrator-issues-b3dd88` belong to other or prior sessions and were deliberately not cleaned or mutated.

## 8. Access and environment

- GitHub CLI reads and git fetches succeeded for `u2giants/shared-db` from EDGE-DEV.
- No database credential or secret was read, and no database connection was opened. If promotion later needs credentials, use the canonical entries in the `vibe_coding` 1Password vault without exposing values.
- Closeout branch: `codex/orchestrator-2625-closeout`; worktree: `C:/repos/shared-db-worktrees/orchestrator-2625-closeout`.
- Secrets sweep: no new secret, credential, email address, licensed row, or private source artifact was introduced by this handoff.

## 9. Open questions and risks

- Moving facts above were checked at 2026-09-09T11:41Z and must be refreshed before action. PR heads, main, claims, locks, and migration order can change within minutes.
- Preview's complete applied ledger was not queried, so no claim of preview cleanliness or full migration inventory is made. The only exact statement is that this session made no preview write and no active preview coordination ref existed at the recorded time.
- The waiting DesignFlow changes are built and tested locally but are not deployed; issue #2580 production completion is a dependency, not application acceptance.
- No owner decision is outstanding. The operational risk is duplicate assignment or premature claim closure; both are avoided by preserving #2626 and continuing its exact branch.

## Coordination state transferred

- Live structural work for this stream: issue #2580, claim #2626, PR #2627, clean worktree `C:/repos/shared-db-worktrees/issue-2580-sample-shipment-notice`.
- Other protected claims observed: #2418, #2524, #2525, #2574, and #2578. The successor must re-audit before changing any lane.
- Merge order: the incoming session was explicitly told to handle PR #2425 first. PR #2627 remains blocked on its producer-pin repair and has no preview or merge lease.
- Queue seed: every outstanding item named here already has an open GitHub issue or claim; no new issue was required.

## Agent: #2580 author / C:/repos/shared-db-worktrees/issue-2580-sample-shipment-notice

- **Asked to do:** Implement the durable Sample Tracking customer-shipment email outbox for issue #2580.
- **Actually did:** Committed migration `20260909084253`, its production verification sidecar, and agent contract artifacts at `a3edf6104cf239483037931f692334e2028f00db`; opened PR #2627.
- **Found:** SQL and ephemeral database checks passed; the sidecar needs an individually pinned producer entry.
- **PR / branch:** PR #2627, branch `codex/issue-2580-sample-shipment-notice`, both open.
- **Worktree:** live and clean; resumable through claim #2626.
- **Deliberately did not do, and why:** No preview apply, merge, or production apply because the required SQL migration guard is red.

## Agent: outgoing marker route / 01a0817b-a071-75d2-90b1-6fa74b295f09

- **Asked to do:** Monitor issue #2580 hourly and dispatch it only when capacity was genuinely available.
- **Actually did:** Preserved the resulting live claim and PR, audited current ownership and locks, and prepared this exact handoff after a replacement orchestrator was requested.
- **Found:** No active preview or merge coordination lease and no live collaboration sub-agent owned by this session.
- **PR / branch:** This documents-only closeout branch and its pull request; marker #2625 is closed only after the document lands and the successor is ready.
- **Worktree:** closeout worktree is clean apart from this owned handoff before commit; safe to reap only after its PR merges and GitHub confirms that merge.
- **Deliberately did not do, and why:** Dispatched no new work and changed none of the six open claims, because ownership is transferring to the explicitly requested successor.

## Self-audit

1. Yes: sections 1-9 define the repository, business purpose, exact state, failures, findings, actions, constraints, access, and risks for a newcomer.
2. Yes: section 3 records current SHAs, claims, locks, PR checks, and mutation state; the coordination and per-agent blocks preserve the working context.
3. Yes: section 4 records failed approaches; section 6 gives ordered actions with verification gates; sections 7-9 preserve safety rules, environment, stale-fact boundaries, and risks.
4. Yes: a line-by-line owner-decision sweep found no required owner choice. Section 0 says so explicitly and records the only settled product decision that must not be re-asked.
